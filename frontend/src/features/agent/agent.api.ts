import type {
  AgentClientControl,
  AgentEvent,
  AgentFailure,
  AgentHandlers,
  AgentHistoryApi,
  AgentMessageRequest,
  AgentStreamClient,
} from './agent.types'

export class AgentContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentContractError'
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentContractError('Agent event must be an object')
  }
  return value as Record<string, unknown>
}

function stringField(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== 'string') throw new AgentContractError(`Invalid ${field}`)
  return value[field]
}

function durationField(value: Record<string, unknown>): number {
  const duration = value.duration_ms
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    throw new AgentContractError('Invalid duration_ms')
  }
  return duration
}

export function parseAgentEvent(value: unknown): AgentEvent {
  const event = record(value)
  switch (event.type) {
    case 'step_started': {
      const parsed: Extract<AgentEvent, { type: 'step_started' }> = {
        type: 'step_started',
        step_id: stringField(event, 'step_id'),
        label: stringField(event, 'label'),
      }
      if (event.tool !== undefined) parsed.tool = stringField(event, 'tool')
      if (event.started_at !== undefined) parsed.started_at = stringField(event, 'started_at')
      if (event.args !== undefined) parsed.args = record(event.args)
      return parsed
    }
    case 'step_completed':
      return { type: 'step_completed', step_id: stringField(event, 'step_id'), duration_ms: durationField(event) }
    case 'step_failed':
      if (typeof event.retryable !== 'boolean') throw new AgentContractError('Invalid retryable')
      return {
        type: 'step_failed',
        step_id: stringField(event, 'step_id'),
        error_code: stringField(event, 'error_code'),
        message: stringField(event, 'message'),
        retryable: event.retryable,
        duration_ms: durationField(event),
      }
    case 'confirmation_required':
      return {
        type: 'confirmation_required',
        step_id: stringField(event, 'step_id'),
        message: stringField(event, 'message'),
        confirmation_id: stringField(event, 'confirmation_id'),
      }
    case 'action_completed':
      return {
        type: 'action_completed',
        step_id: stringField(event, 'step_id'),
        action: stringField(event, 'action'),
        result: record(event.result),
        duration_ms: durationField(event),
      }
    case 'reply':
      return { type: 'reply', content: stringField(event, 'content') }
    case 'done':
      return { type: 'done' }
    default:
      throw new AgentContractError('Unknown Agent event type')
  }
}

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
        if (failure.retryable && retries < maxRetries) {
          const delay = retryBaseDelayMs * 2 ** retries
          retries++
          retryTimer = setTimeout(connect, delay)
          return
        }
        report(failure)
      }

      const sendControl = (control: AgentClientControl) => {
        if (!cancelled && !finished && socket?.readyState === SOCKET_OPEN) {
          socket.send(JSON.stringify(control))
        }
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
