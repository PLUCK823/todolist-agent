import type {
  AgentClientControl,
  AgentFailure,
  AgentHandlers,
  AgentHistoryApi,
  AgentClientRequest,
  AgentStreamClient,
} from './agent.types'
import { parseAgentEvent } from './agent.schema'
import { ApiError, authenticatedFetch } from '../../shared/api/authenticated-fetch'

export { AgentContractError, parseAgentEvent } from './agent.schema'

export type WebSocketFactory = (url: string) => WebSocket

export interface AgentStreamClientOptions {
  endpoint?: string
  socketFactory?: WebSocketFactory
  connectionTimeoutMs?: number
  maxRetries?: number
  retryBaseDelayMs?: number
}

const SOCKET_OPEN = 1
const SOCKET_CLOSING = 2

function resolveWebSocketUrl(endpoint: string): string {
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.href
  const url = new URL(endpoint, base)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Agent WebSocket URL must use ws, wss, http, or https')
  }
  return url.toString()
}

const failureMessage: Record<AgentFailure['code'], string> = {
  CONNECTION_TIMEOUT: '连接智能助手超时，请重试',
  CONNECTION_CLOSED: '智能助手连接已断开',
  SOCKET_ERROR: '智能助手连接异常',
  INVALID_EVENT: '智能助手返回了无法识别的数据',
}

export function createAgentStreamClient(options: AgentStreamClientOptions = {}): AgentStreamClient {
  const configuredEndpoint = options.endpoint
    ?? import.meta.env.VITE_AGENT_WS_URL
    ?? '/api/agent/stream'
  const endpoint = resolveWebSocketUrl(configuredEndpoint)
  const socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url))
  const connectionTimeoutMs = options.connectionTimeoutMs ?? 5000
  const maxRetries = options.maxRetries ?? 2
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 250

  return {
    send(input: AgentClientRequest, handlers: AgentHandlers): () => void {
      let socket: WebSocket | undefined
      let connectionTimer: ReturnType<typeof setTimeout> | undefined
      let retryTimer: ReturnType<typeof setTimeout> | undefined
      let generation = 0
      let retries = 0
      let cancelled = false
      let finished = false
      let requestSent = false

      const clearTimers = () => {
        if (connectionTimer) clearTimeout(connectionTimer)
        if (retryTimer) clearTimeout(retryTimer)
        connectionTimer = undefined
        retryTimer = undefined
      }

      const closeSocket = (code: number, reason: string) => {
        if (!socket || socket.readyState >= SOCKET_CLOSING) return
        try {
          socket.close(code, reason)
        } catch {
          // Closing is best-effort; terminal state still prevents callbacks.
        }
      }

      const terminate = (
        failure: AgentFailure | undefined,
        code: number,
        reason: string,
      ): boolean => {
        if (cancelled || finished) return false
        finished = true
        generation++
        clearTimers()
        closeSocket(code, reason)
        if (failure) handlers.onFailure?.(failure)
        return true
      }

      const retryOrTerminate = (
        failure: AgentFailure,
        code: number,
        reason: string,
      ) => {
        if (cancelled || finished) return
        if (!requestSent && failure.retryable && retries < maxRetries) {
          generation++
          if (connectionTimer) clearTimeout(connectionTimer)
          connectionTimer = undefined
          closeSocket(code, reason)
          const delay = retryBaseDelayMs * 2 ** retries
          retries++
          retryTimer = setTimeout(connect, delay)
          return
        }
        terminate(failure, code, reason)
      }

      const sendControl = (control: AgentClientControl): boolean => {
        if (!cancelled && !finished && socket?.readyState === SOCKET_OPEN) {
          try {
            socket.send(JSON.stringify(control))
            return true
          } catch {
            terminate(
              { code: 'SOCKET_ERROR', message: failureMessage.SOCKET_ERROR, retryable: false },
              1011,
              'control_send_failed',
            )
          }
        }
        return false
      }

      function connect() {
        if (cancelled || finished) return
        const currentGeneration = ++generation
        let current: WebSocket
        try {
          current = socketFactory(endpoint)
        } catch {
          retryOrTerminate(
            { code: 'SOCKET_ERROR', message: failureMessage.SOCKET_ERROR, retryable: true },
            1011,
            'socket_factory_failed',
          )
          return
        }
        socket = current

        connectionTimer = setTimeout(() => {
          if (currentGeneration !== generation || current.readyState === SOCKET_OPEN) return
          retryOrTerminate(
            {
              code: 'CONNECTION_TIMEOUT',
              message: failureMessage.CONNECTION_TIMEOUT,
              retryable: true,
            },
            4000,
            'connection_timeout',
          )
        }, connectionTimeoutMs)

        current.onopen = () => {
          if (currentGeneration !== generation || cancelled || finished) return
          if (connectionTimer) clearTimeout(connectionTimer)
          connectionTimer = undefined
          try {
            current.send(JSON.stringify(input))
          } catch {
            terminate(
              { code: 'SOCKET_ERROR', message: failureMessage.SOCKET_ERROR, retryable: false },
              1011,
              'initial_send_failed',
            )
            return
          }
          requestSent = true
          handlers.onControlReady?.(sendControl)
          handlers.onOpen?.()
        }

        current.onmessage = (message) => {
          if (currentGeneration !== generation || cancelled || finished) return
          let event
          try {
            const raw: unknown = JSON.parse(String(message.data))
            event = parseAgentEvent(raw)
          } catch (error) {
            terminate(
              {
                code: 'INVALID_EVENT',
                message: error instanceof Error ? error.message : failureMessage.INVALID_EVENT,
                retryable: false,
              },
              1003,
              'invalid_agent_event',
            )
            return
          }
          if (event.type === 'done') {
            terminate(undefined, 1000, 'agent_done')
          }
          handlers.onEvent(event)
        }

        current.onerror = () => {
          if (currentGeneration !== generation || cancelled || finished) return
          retryOrTerminate(
            { code: 'SOCKET_ERROR', message: failureMessage.SOCKET_ERROR, retryable: true },
            1011,
            'socket_error',
          )
        }

        current.onclose = (event) => {
          if (currentGeneration !== generation || cancelled || finished) return
          retryOrTerminate(
            {
              code: 'CONNECTION_CLOSED',
              message: failureMessage.CONNECTION_CLOSED,
              retryable: event.code !== 1008,
              closeCode: event.code,
              reason: event.reason,
            },
            event.code || 1006,
            event.reason || 'connection_closed',
          )
        }
      }

      connect()

      return () => {
        if (cancelled || finished) return
        cancelled = true
        generation++
        clearTimers()
        closeSocket(1000, 'client_cancelled')
      }
    },
  }
}

export const agentHistoryApi: AgentHistoryApi = {
  async clear(sessionId: string): Promise<void> {
    try {
      await authenticatedFetch(`/api/agent/history?session_id=${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return
      throw new Error('清空对话记录失败，请稍后重试', { cause: error })
    }
  },
}

export const agentStreamClient = createAgentStreamClient()
