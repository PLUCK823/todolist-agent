import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentContractError, agentHistoryApi, createAgentStreamClient, parseAgentEvent } from '../agent.api'
import type {
  AgentClientControl,
  AgentEvent,
  AgentHandlers,
  AgentMessageRequest,
  AgentStreamClient,
} from '../agent.types'
import { useAgentSession } from '../useAgentSession'

class FakeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = FakeSocket.CONNECTING
  sent: string[] = []
  closeCalls: Array<[number | undefined, string | undefined]> = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  send(data: string) { this.sent.push(data) }
  close(code?: number, reason?: string) {
    this.closeCalls.push([code, reason])
    this.readyState = FakeSocket.CLOSED
  }
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.(new Event('open'))
  }
  message(value: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) }))
  }
  abnormalClose(code = 1006, reason = 'offline') {
    this.readyState = FakeSocket.CLOSED
    this.onclose?.(new CloseEvent('close', { code, reason }))
  }
}

function createSocketFactory() {
  const sockets: FakeSocket[] = []
  const factory = vi.fn(() => {
    const socket = new FakeSocket()
    sockets.push(socket)
    return socket as unknown as WebSocket
  })
  return { factory, sockets }
}

describe('agent event contract', () => {
  it('parses every target event and rejects unknown or malformed payloads', () => {
    const events: AgentEvent[] = [
      { type: 'step_started', step_id: 's', label: '理解请求' },
      { type: 'step_completed', step_id: 's', duration_ms: 12 },
      { type: 'step_failed', step_id: 's', error_code: 'X', message: '失败', retryable: true, duration_ms: 12 },
      { type: 'confirmation_required', step_id: 's', message: '确认？', confirmation_id: 'c' },
      { type: 'action_completed', step_id: 's', action: 'create_todo', result: { id: 1 }, duration_ms: 12 },
      { type: 'reply', content: '完成' },
      { type: 'done' },
    ]
    expect(events.map((event) => parseAgentEvent(event))).toEqual(events)
    expect(() => parseAgentEvent({ type: 'reply', content: 2 })).toThrow(AgentContractError)
    expect(() => parseAgentEvent({ type: 'mystery' })).toThrow(AgentContractError)
  })
})

describe('createAgentStreamClient', () => {
  afterEach(() => vi.useRealTimers())

  it('resolves a relative endpoint, waits for open, sends JSON and closes on done', () => {
    const { factory, sockets } = createSocketFactory()
    const events: AgentEvent[] = []
    const client = createAgentStreamClient({ socketFactory: factory, endpoint: '/api/agent/stream' })
    client.send({ message: '你好', session_id: 'session-1' }, { onEvent: (event) => events.push(event) })

    expect(factory).toHaveBeenCalledWith('ws://localhost:3000/api/agent/stream')
    expect(sockets[0].sent).toEqual([])
    sockets[0].open()
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ message: '你好', session_id: 'session-1' })
    sockets[0].message({ type: 'reply', content: '你好' })
    sockets[0].message({ type: 'done' })
    expect(events.map((event) => event.type)).toEqual(['reply', 'done'])
    expect(sockets[0].closeCalls).toContainEqual([1000, 'agent_done'])
  })

  it('turns invalid JSON and contract violations into structured non-retryable failures', () => {
    const { factory, sockets } = createSocketFactory()
    const failures: unknown[] = []
    const client = createAgentStreamClient({ socketFactory: factory })
    client.send({ message: '你好' }, { onEvent: vi.fn(), onFailure: (failure) => failures.push(failure) })
    sockets[0].open()
    sockets[0].message('{bad')

    expect(failures[0]).toMatchObject({ code: 'INVALID_EVENT', retryable: false })
    expect(sockets[0].closeCalls).toContainEqual([1003, 'invalid_agent_event'])
  })

  it('times out a connection and retries with bounded exponential backoff', () => {
    vi.useFakeTimers()
    const { factory, sockets } = createSocketFactory()
    const failures: unknown[] = []
    const client = createAgentStreamClient({
      socketFactory: factory,
      connectionTimeoutMs: 1000,
      maxRetries: 2,
      retryBaseDelayMs: 100,
    })
    client.send({ message: '你好' }, { onEvent: vi.fn(), onFailure: (failure) => failures.push(failure) })

    vi.advanceTimersByTime(1000)
    expect(sockets[0].closeCalls).toContainEqual([4000, 'connection_timeout'])
    vi.advanceTimersByTime(100)
    expect(factory).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1000 + 200)
    expect(factory).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(1000)
    expect(failures.at(-1)).toMatchObject({ code: 'CONNECTION_TIMEOUT', retryable: true })
    expect(factory).toHaveBeenCalledTimes(3)
  })

  it('cancels idempotently and stale sockets cannot dispatch into a retried request', () => {
    vi.useFakeTimers()
    const { factory, sockets } = createSocketFactory()
    const events: AgentEvent[] = []
    const client = createAgentStreamClient({ socketFactory: factory, retryBaseDelayMs: 10, maxRetries: 1 })
    const cancel = client.send({ message: '你好' }, { onEvent: (event) => events.push(event) })
    sockets[0].abnormalClose()
    vi.advanceTimersByTime(10)
    sockets[0].message({ type: 'reply', content: '旧响应' })
    sockets[1].open()
    sockets[1].message({ type: 'reply', content: '新响应' })
    cancel()
    cancel()

    expect(events).toEqual([{ type: 'reply', content: '新响应' }])
    expect(sockets[1].closeCalls).toEqual([[1000, 'client_cancelled']])
  })

  it('allows confirmation controls on the active connection', () => {
    const { factory, sockets } = createSocketFactory()
    let sendControl: ((control: AgentClientControl) => void) | undefined
    const client = createAgentStreamClient({ socketFactory: factory })
    client.send({ message: '删除任务' }, {
      onEvent: vi.fn(), onControlReady: (send) => { sendControl = send },
    })
    sockets[0].open()
    sendControl?.({ type: 'confirmation_response', confirmation_id: 'confirm-1', approved: true })
    expect(JSON.parse(sockets[0].sent[1])).toEqual({
      type: 'confirmation_response', confirmation_id: 'confirm-1', approved: true,
    })
  })
})

class ControlledClient implements AgentStreamClient {
  requests: AgentMessageRequest[] = []
  handlers: AgentHandlers[] = []
  controls: AgentClientControl[] = []
  cancels = 0

  send(input: AgentMessageRequest, handlers: AgentHandlers) {
    this.requests.push(input)
    this.handlers.push(handlers)
    handlers.onControlReady?.((control) => this.controls.push(control))
    return () => { this.cancels++ }
  }
}

describe('useAgentSession', () => {
  it('clears history through the documented HTTP endpoint', async () => {
    await expect(agentHistoryApi.clear('session/with spaces')).resolves.toBeUndefined()
  })

  it('ignores blank/double sends and keeps a stable generated session id', () => {
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({
      client,
      sessionIdFactory: () => 'session-local',
      messageIdFactory: () => 'message-1',
      now: () => '2026-07-14T00:00:00Z',
    }))

    act(() => {
      result.current.send('   ')
      result.current.send('  创建任务  ')
      result.current.send('第二条')
    })
    expect(client.requests).toEqual([{ message: '创建任务', session_id: 'session-local' }])
    expect(result.current.sessionId).toBe('session-local')
    expect(result.current.status).toBe('connecting')
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: '创建任务' })
  })

  it('dispatches streamed events, confirms on the existing connection and finishes', () => {
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({ client, sessionIdFactory: () => 's' }))
    act(() => result.current.send('删除任务'))
    act(() => client.handlers[0].onOpen?.())
    act(() => client.handlers[0].onEvent({ type: 'step_started', step_id: 'delete-1', label: '删除' }))
    act(() => client.handlers[0].onEvent({
      type: 'confirmation_required', step_id: 'delete-1', message: '确认？', confirmation_id: 'confirm-1',
    }))
    expect(result.current.status).toBe('waiting_confirmation')
    act(() => result.current.confirm('confirm-1'))
    expect(client.controls).toEqual([{ type: 'confirmation_response', confirmation_id: 'confirm-1', approved: true }])
    expect(result.current.status).toBe('running')
    act(() => client.handlers[0].onEvent({ type: 'reply', content: '已删除' }))
    act(() => client.handlers[0].onEvent({ type: 'done' }))
    expect(result.current.status).toBe('done')
    expect(result.current.messages.at(-1)).toMatchObject({ role: 'assistant', content: '已删除' })
  })

  it('retries only a retryable known step by replaying the original request', () => {
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({ client, sessionIdFactory: () => 's' }))
    act(() => result.current.send('创建任务'))
    act(() => client.handlers[0].onEvent({ type: 'step_started', step_id: 'step-1', label: '调用' }))
    act(() => client.handlers[0].onEvent({
      type: 'step_failed', step_id: 'step-1', error_code: 'TIMEOUT', message: '超时', retryable: true, duration_ms: 5000,
    }))
    act(() => {
      result.current.retry('missing')
      result.current.retry('step-1')
    })
    expect(client.requests).toHaveLength(2)
    expect(client.requests[1]).toEqual({ message: '创建任务', session_id: 's' })
  })

  it('cancels on unmount and clear deletes server history before resetting local state', async () => {
    const client = new ControlledClient()
    const deleteHistory = vi.fn().mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() => useAgentSession({
      client, historyApi: { clear: deleteHistory }, sessionIdFactory: () => 's',
    }))
    act(() => result.current.send('创建任务'))
    await act(() => result.current.clear())
    expect(deleteHistory).toHaveBeenCalledWith('s')
    expect(result.current.messages).toEqual([])
    expect(result.current.status).toBe('idle')
    unmount()
    expect(client.cancels).toBeGreaterThanOrEqual(1)
  })

  it('manual cancel closes the stream and returns the session to idle', () => {
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({ client, sessionIdFactory: () => 's' }))
    act(() => result.current.send('创建任务'))
    act(() => result.current.cancel())
    expect(client.cancels).toBe(1)
    expect(result.current.status).toBe('idle')
  })

  it('preserves local history and reports failure when server history cannot be cleared', async () => {
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({
      client,
      historyApi: { clear: vi.fn().mockRejectedValue(new Error('offline')) },
      sessionIdFactory: () => 's',
    }))
    act(() => result.current.send('创建任务'))
    let thrown: unknown
    await act(async () => {
      try {
        await result.current.clear()
      } catch (error) {
        thrown = error
      }
    })
    expect(thrown).toEqual(new Error('offline'))
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.status).toBe('failed')
  })
})
