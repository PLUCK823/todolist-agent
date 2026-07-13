import type {
  AgentClientControl,
  AgentFailure,
  AgentHandlers,
  AgentHistoryApi,
  AgentMessageRequest,
  AgentStreamClient,
} from './agent.types'
import { parseAgentEvent } from './agent.schema'

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
    send(input: AgentMessageRequest, handlers: AgentHandlers): () => void {
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

      const report = (failure: AgentFailure) => {
        if (cancelled || finished) return
        finished = true
        clearTimers()
        handlers.onFailure?.(failure)
      }

      const retryOrReport = (failure: AgentFailure) => {
        if (cancelled || finished) return
        generation++
        if (!requestSent && failure.retryable && retries < maxRetries) {
          const delay = retryBaseDelayMs * 2 ** retries
          retries++
          retryTimer = setTimeout(connect, delay)
          return
        }
        report(failure)
      }

      const sendControl = (control: AgentClientControl): boolean => {
        if (!cancelled && !finished && socket?.readyState === SOCKET_OPEN) {
          try {
            socket.send(JSON.stringify(control))
            return true
          } catch {
            report({ code: 'SOCKET_ERROR', message: failureMessage.SOCKET_ERROR, retryable: false })
          }
        }
        return false
      }

      function connect() {
        if (cancelled || finished) return
        const currentGeneration = ++generation
        const current = socketFactory(endpoint)
        socket = current

        connectionTimer = setTimeout(() => {
          if (currentGeneration !== generation || current.readyState === SOCKET_OPEN) return
          current.close(4000, 'connection_timeout')
          retryOrReport({
            code: 'CONNECTION_TIMEOUT',
            message: failureMessage.CONNECTION_TIMEOUT,
            retryable: true,
          })
        }, connectionTimeoutMs)

        current.onopen = () => {
          if (currentGeneration !== generation || cancelled || finished) return
          if (connectionTimer) clearTimeout(connectionTimer)
          connectionTimer = undefined
          current.send(JSON.stringify(input))
          requestSent = true
          handlers.onControlReady?.(sendControl)
          handlers.onOpen?.()
        }

        current.onmessage = (message) => {
          if (currentGeneration !== generation || cancelled || finished) return
          try {
            const raw: unknown = JSON.parse(String(message.data))
            const event = parseAgentEvent(raw)
            handlers.onEvent(event)
            if (event.type === 'done') {
              finished = true
              clearTimers()
              current.close(1000, 'agent_done')
            }
          } catch (error) {
            current.close(1003, 'invalid_agent_event')
            report({
              code: 'INVALID_EVENT',
              message: error instanceof Error ? error.message : failureMessage.INVALID_EVENT,
              retryable: false,
            })
          }
        }

        current.onerror = () => {
          if (currentGeneration !== generation || cancelled || finished) return
          current.close(1011, 'socket_error')
          retryOrReport({ code: 'SOCKET_ERROR', message: failureMessage.SOCKET_ERROR, retryable: true })
        }

        current.onclose = (event) => {
          if (currentGeneration !== generation || cancelled || finished) return
          retryOrReport({
            code: 'CONNECTION_CLOSED',
            message: failureMessage.CONNECTION_CLOSED,
            retryable: event.code !== 1008,
            closeCode: event.code,
            reason: event.reason,
          })
        }
      }

      connect()

      return () => {
        if (cancelled) return
        cancelled = true
        generation++
        clearTimers()
        if (socket && socket.readyState < SOCKET_CLOSING) {
          socket.close(1000, 'client_cancelled')
        }
      }
    },
  }
}

export const agentHistoryApi: AgentHistoryApi = {
  async clear(sessionId: string): Promise<void> {
    const response = await fetch(`/api/agent/history?session_id=${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    })
    if (!response.ok && response.status !== 404) {
      throw new Error('清空对话记录失败，请稍后重试')
    }
  },
}

export const agentStreamClient = createAgentStreamClient()
