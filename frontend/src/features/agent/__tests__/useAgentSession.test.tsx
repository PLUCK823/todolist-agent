import { act, renderHook } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentContractError, agentHistoryApi, createAgentStreamClient, parseAgentEvent } from '../agent.api'
import type {
  AgentClientControl,
  AgentControlSender,
  AgentEvent,
  AgentHandlers,
  AgentMessageRequest,
  AgentStreamClient,
} from '../agent.types'
import { useAgentSession } from '../useAgentSession'
import { createUuid } from '../agent.id'

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
  throwOnSend = false

  send(data: string) {
    if (this.throwOnSend) throw new Error('send failed')
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    this.closeCalls.push([code, reason])
    this.readyState = FakeSocket.CLOSED
    queueMicrotask(() => this.onclose?.(new CloseEvent('close', { code: code ?? 1005, reason })))
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
  error() { this.onerror?.(new Event('error')) }
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

  it('rejects inherited, extra, dangerous and non-JSON event data', () => {
    const inherited = Object.create({ content: '继承内容' }) as Record<string, unknown>
    inherited.type = 'reply'
    expect(() => parseAgentEvent(inherited)).toThrow(AgentContractError)
    expect(() => parseAgentEvent({ type: 'done', extra: true })).toThrow(AgentContractError)
    expect(() => parseAgentEvent(JSON.parse(
      '{"type":"action_completed","step_id":"s","action":"x","result":{"nested":{"__proto__":1}},"duration_ms":1}',
    ))).toThrow(AgentContractError)
    expect(() => parseAgentEvent({
      type: 'action_completed', step_id: 's', action: 'x', result: { when: new Date() }, duration_ms: 1,
    })).toThrow(AgentContractError)
  })

  it('deep-clones validated args and results instead of retaining service objects', () => {
    const raw = {
      type: 'action_completed',
      step_id: 's',
      action: 'create_todo',
      result: { todo: { id: 1 } },
      duration_ms: 1,
    }
    const parsed = parseAgentEvent(raw)
    raw.result.todo.id = 99

    expect(parsed).toMatchObject({ result: { todo: { id: 1 } } })
  })

  it('rejects deeply nested and oversized event payloads with a contract error', () => {
    let nested: Record<string, unknown> = { value: 'end' }
    for (let index = 0; index < 80; index++) nested = { nested }

    expect(() => parseAgentEvent({
      type: 'action_completed', step_id: 's', action: 'x', result: nested, duration_ms: 1,
    })).toThrow(AgentContractError)
    expect(() => parseAgentEvent({
      type: 'reply', content: 'x'.repeat(200_000),
    })).toThrow(AgentContractError)
  })

  it('counts keys toward the string budget and never echoes an oversized key', () => {
    const key = `secret-${'x'.repeat(500)}`
    let thrown: unknown
    try {
      parseAgentEvent({ type: 'action_completed', step_id: 's', action: 'x', result: { [key]: true }, duration_ms: 1 })
    } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(AgentContractError)
    expect(String(thrown)).not.toContain(key)
    expect(String(thrown)).not.toContain('secret-')
  })

  it('rejects payloads that exceed the total JSON node budget', () => {
    expect(() => parseAgentEvent({
      type: 'action_completed', step_id: 's', action: 'x', result: { items: Array.from({ length: 5_100 }, (_, id) => id) }, duration_ms: 1,
    })).toThrow(AgentContractError)
  })
})

describe('createUuid', () => {
  it('uses getRandomValues to produce an RFC 4122 v4 id when randomUUID is unavailable', () => {
    const value = createUuid({
      getRandomValues(array) {
        array.fill(0)
        return array
      },
    })
    expect(value).toBe('00000000-0000-4000-8000-000000000000')
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
    expect(failures).toHaveLength(1)
    expect(factory).toHaveBeenCalledTimes(3)
  })

  it('retries a connection failure only before the request has been sent', async () => {
    vi.useFakeTimers()
    const { factory, sockets } = createSocketFactory()
    const failures: unknown[] = []
    const client = createAgentStreamClient({ socketFactory: factory, maxRetries: 1, retryBaseDelayMs: 25 })
    client.send({ message: '你好' }, { onEvent: vi.fn(), onFailure: (failure) => failures.push(failure) })

    sockets[0].abnormalClose()
    await vi.advanceTimersByTimeAsync(25)
    expect(factory).toHaveBeenCalledTimes(2)
    sockets[1].open()
    sockets[1].abnormalClose()
    await vi.runAllTimersAsync()

    expect(factory).toHaveBeenCalledTimes(2)
    expect(failures).toHaveLength(1)
  })

  it('never resends input after open when an error is followed by close', async () => {
    vi.useFakeTimers()
    const { factory, sockets } = createSocketFactory()
    const failures: unknown[] = []
    const client = createAgentStreamClient({ socketFactory: factory, maxRetries: 2, retryBaseDelayMs: 10 })
    client.send({ message: '创建任务' }, { onEvent: vi.fn(), onFailure: (failure) => failures.push(failure) })
    sockets[0].open()
    sockets[0].error()
    await vi.runAllTimersAsync()

    expect(factory).toHaveBeenCalledTimes(1)
    expect(sockets[0].sent).toHaveLength(1)
    expect(failures).toHaveLength(1)
  })

  it('turns a socket factory exception during backoff into one terminal failure', async () => {
    vi.useFakeTimers()
    const first = new FakeSocket()
    const factory = vi.fn()
      .mockReturnValueOnce(first as unknown as WebSocket)
      .mockImplementationOnce(() => { throw new Error('factory failed') })
    const failures: unknown[] = []
    const client = createAgentStreamClient({ socketFactory: factory, maxRetries: 1, retryBaseDelayMs: 10 })
    client.send({ message: '创建任务' }, { onEvent: vi.fn(), onFailure: (failure) => failures.push(failure) })
    first.abnormalClose()

    await vi.advanceTimersByTimeAsync(10)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ code: 'SOCKET_ERROR' })
  })

  it('closes and reports once when sending the initial input throws on open', async () => {
    const { factory, sockets } = createSocketFactory()
    const failures: unknown[] = []
    const client = createAgentStreamClient({ socketFactory: factory })
    client.send({ message: '创建任务' }, { onEvent: vi.fn(), onFailure: (failure) => failures.push(failure) })
    sockets[0].throwOnSend = true

    expect(() => sockets[0].open()).not.toThrow()
    await Promise.resolve()
    expect(sockets[0].closeCalls).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ code: 'SOCKET_ERROR', retryable: false })
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

  it('refuses confirmation controls after the socket has closed', async () => {
    const { factory, sockets } = createSocketFactory()
    let sendControl: AgentControlSender | undefined
    const failures: unknown[] = []
    const client = createAgentStreamClient({ socketFactory: factory, maxRetries: 0 })
    client.send({ message: '删除任务' }, {
      onEvent: vi.fn(),
      onFailure: (failure) => failures.push(failure),
      onControlReady: (send) => { sendControl = send },
    })
    sockets[0].open()
    sockets[0].abnormalClose()
    await Promise.resolve()

    expect(sendControl?.({
      type: 'confirmation_response', confirmation_id: 'confirm-1', approved: true,
    })).toBe(false)
    expect(failures).toHaveLength(1)
  })

  it('terminates the socket once when sending a confirmation throws', async () => {
    const { factory, sockets } = createSocketFactory()
    let sendControl: AgentControlSender | undefined
    const failures: unknown[] = []
    const client = createAgentStreamClient({ socketFactory: factory })
    client.send({ message: '删除任务' }, {
      onEvent: vi.fn(),
      onFailure: (failure) => failures.push(failure),
      onControlReady: (send) => { sendControl = send },
    })
    sockets[0].open()
    sockets[0].throwOnSend = true

    expect(sendControl?.({
      type: 'confirmation_response', confirmation_id: 'confirm-1', approved: true,
    })).toBe(false)
    await Promise.resolve()
    expect(sockets[0].closeCalls).toHaveLength(1)
    expect(failures).toHaveLength(1)
  })
})

class ControlledClient implements AgentStreamClient {
  requests: AgentMessageRequest[] = []
  handlers: AgentHandlers[] = []
  controls: AgentClientControl[] = []
  cancels = 0
  exposeControl = true
  controlAccepted = true

  send(input: AgentMessageRequest, handlers: AgentHandlers) {
    this.requests.push(input)
    this.handlers.push(handlers)
    if (this.exposeControl) {
      handlers.onControlReady?.((control) => {
        if (this.controlAccepted) this.controls.push(control)
        return this.controlAccepted
      })
    }
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

    let blankAccepted = true
    let firstAccepted = false
    let secondAccepted = true
    act(() => {
      blankAccepted = result.current.send('   ')
      firstAccepted = result.current.send('  创建任务  ')
      secondAccepted = result.current.send('第二条')
    })
    expect([blankAccepted, firstAccepted, secondAccepted]).toEqual([false, true, false])
    expect(result.current.canSend).toBe(false)
    expect(client.requests).toEqual([{ message: '创建任务', session_id: 'session-local' }])
    expect(result.current.sessionId).toBe('session-local')
    expect(result.current.status).toBe('connecting')
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: '创建任务' })
  })

  it('remains live through the StrictMode setup-cleanup-setup cycle', () => {
    const client = new ControlledClient()
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(
      () => useAgentSession({ client, sessionIdFactory: () => 'strict-session' }),
      { wrapper },
    )
    act(() => result.current.send('创建任务'))

    expect(client.cancels).toBe(0)
    act(() => client.handlers[0].onOpen?.())
    act(() => client.handlers[0].onEvent({ type: 'reply', content: '仍然在线' }))
    expect(result.current.status).toBe('running')
    expect(result.current.messages.at(-1)?.content).toBe('仍然在线')
  })

  it('turns synchronous id factory and client failures into failed state', () => {
    const throwingFactory = renderHook(() => useAgentSession({
      client: new ControlledClient(),
      sessionIdFactory: () => { throw new Error('crypto unavailable') },
    }))
    expect(() => act(() => throwingFactory.result.current.send('创建任务'))).not.toThrow()
    expect(throwingFactory.result.current.status).toBe('failed')

    const throwingClient: AgentStreamClient = { send: () => { throw new Error('socket unavailable') } }
    const brokenSocket = renderHook(() => useAgentSession({
      client: throwingClient, sessionIdFactory: () => 's',
    }))
    expect(() => act(() => brokenSocket.result.current.send('创建任务'))).not.toThrow()
    expect(brokenSocket.result.current.status).toBe('failed')
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

  it('can reject a confirmation on the existing connection', () => {
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({ client, sessionIdFactory: () => 's' }))
    act(() => result.current.send('删除任务'))
    act(() => client.handlers[0].onEvent({ type: 'step_started', step_id: 'delete-1', label: '删除' }))
    act(() => client.handlers[0].onEvent({
      type: 'confirmation_required', step_id: 'delete-1', message: '确认？', confirmation_id: 'confirm-1',
    }))
    act(() => result.current.reject('confirm-1'))

    expect(client.controls).toEqual([{
      type: 'confirmation_response', confirmation_id: 'confirm-1', approved: false,
    }])
    expect(result.current.status).toBe('running')
  })

  it('does not leave waiting state when confirmation cannot be sent', () => {
    const client = new ControlledClient()
    client.exposeControl = false
    const { result } = renderHook(() => useAgentSession({ client, sessionIdFactory: () => 's' }))
    act(() => result.current.send('删除任务'))
    act(() => client.handlers[0].onEvent({ type: 'step_started', step_id: 'delete-1', label: '删除' }))
    act(() => client.handlers[0].onEvent({
      type: 'confirmation_required', step_id: 'delete-1', message: '确认？', confirmation_id: 'confirm-1',
    }))
    act(() => result.current.confirm('confirm-1'))

    expect(result.current.status).toBe('waiting_confirmation')
  })

  it('clears pending confirmation controls when the connection fails', () => {
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({ client, sessionIdFactory: () => 's' }))
    act(() => result.current.send('删除任务'))
    act(() => client.handlers[0].onEvent({ type: 'step_started', step_id: 'delete-1', label: '删除' }))
    act(() => client.handlers[0].onEvent({
      type: 'confirmation_required', step_id: 'delete-1', message: '确认？', confirmation_id: 'confirm-1',
    }))
    act(() => client.handlers[0].onFailure?.({
      code: 'CONNECTION_CLOSED', message: '断线', retryable: false,
    }))
    act(() => result.current.confirm('confirm-1'))

    expect(result.current.status).toBe('failed')
    expect(client.controls).toEqual([])
  })

  it('replays a retryable failed turn when no action has completed', () => {
    const client = new ControlledClient()
    let messageId = 0
    const { result } = renderHook(() => useAgentSession({
      client,
      sessionIdFactory: () => 's',
      messageIdFactory: () => `message-${++messageId}`,
    }))
    act(() => result.current.send('创建任务'))
    act(() => client.handlers[0].onEvent({ type: 'step_started', step_id: 'step-1', label: '调用' }))
    act(() => client.handlers[0].onEvent({
      type: 'step_failed', step_id: 'step-1', error_code: 'TIMEOUT', message: '超时', retryable: true, duration_ms: 5000,
    }))
    act(() => result.current.retry('step-1'))

    expect(client.requests).toEqual([
      { message: '创建任务', session_id: 's' },
      { message: '创建任务', session_id: 's' },
    ])
    expect(result.current.messages.filter((message) => message.role === 'user')).toHaveLength(2)
    expect(result.current.sessionId).toBe('s')
    expect(result.current.status).toBe('connecting')
    expect(result.current.capabilities.supportsStepRetry).toBe(true)
  })

  it('refuses replay for missing, non-retryable or already-mutated steps', () => {
    const cases = [
      { failedId: 'failed', requestedId: 'missing', retryable: true, completedAction: false },
      { failedId: 'failed', requestedId: 'failed', retryable: false, completedAction: false },
      { failedId: 'failed', requestedId: 'failed', retryable: true, completedAction: true },
    ]

    for (const scenario of cases) {
      const client = new ControlledClient()
      const { result, unmount } = renderHook(() => useAgentSession({ client, sessionIdFactory: () => 's' }))
      act(() => result.current.send('创建任务'))
      act(() => client.handlers[0].onEvent({ type: 'step_started', step_id: scenario.failedId, label: '调用' }))
      if (scenario.completedAction) {
        act(() => client.handlers[0].onEvent({
          type: 'step_started', step_id: 'mutated', label: '创建', tool: 'create_todo',
        }))
        act(() => client.handlers[0].onEvent({
          type: 'action_completed', step_id: 'mutated', action: 'create_todo', result: { id: 1 }, duration_ms: 1,
        }))
      }
      act(() => client.handlers[0].onEvent({
        type: 'step_failed', step_id: scenario.failedId, error_code: 'TIMEOUT', message: '超时', retryable: scenario.retryable, duration_ms: 5000,
      }))
      act(() => result.current.retry(scenario.requestedId))

      expect(client.requests).toHaveLength(1)
      unmount()
    }
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

  it('keeps local history while clearing, blocks sends, then clears only after history succeeds', async () => {
    let resolveHistory!: () => void
    const historyPending = new Promise<void>((resolve) => { resolveHistory = resolve })
    const client = new ControlledClient()
    const sessionIdFactory = vi.fn()
      .mockReturnValueOnce('session-before-clear')
      .mockReturnValueOnce('session-after-clear')
    const { result } = renderHook(() => useAgentSession({
      client,
      historyApi: { clear: vi.fn(() => historyPending) },
      sessionIdFactory,
    }))
    act(() => result.current.send('旧请求'))
    const oldHandlers = client.handlers[0]
    let clearPromise!: Promise<void>
    act(() => { clearPromise = result.current.clear() })
    expect(result.current.isClearing).toBe(true)
    expect(result.current.canSend).toBe(false)
    act(() => result.current.send('清理期间请求'))
    act(() => {
      oldHandlers.onOpen?.()
      oldHandlers.onEvent({ type: 'reply', content: '旧回复' })
      oldHandlers.onFailure?.({ code: 'CONNECTION_CLOSED', message: '旧失败', retryable: false })
      oldHandlers.onControlReady?.(() => true)
    })

    expect(result.current.messages.map((message) => message.content)).toEqual(['旧请求'])
    expect(result.current.sessionId).toBe('session-before-clear')
    expect(client.requests).toHaveLength(1)

    resolveHistory()
    await act(() => clearPromise)
    expect(result.current.isClearing).toBe(false)
    expect(result.current.canSend).toBe(true)
    expect(result.current.messages).toEqual([])
    expect(result.current.status).toBe('idle')
    act(() => result.current.send('新请求'))
    const staleControl = vi.fn(() => true)
    act(() => {
      oldHandlers.onOpen?.()
      oldHandlers.onEvent({ type: 'reply', content: '更晚的旧回复' })
      oldHandlers.onFailure?.({ code: 'CONNECTION_CLOSED', message: '更晚的旧失败', retryable: false })
      oldHandlers.onControlReady?.(staleControl)
    })

    expect(client.requests).toHaveLength(2)
    expect(client.requests[1].session_id).toBe('session-after-clear')
    expect(result.current.status).toBe('connecting')
    expect(result.current.messages.map((message) => message.content)).toEqual(['新请求'])
    act(() => {
      client.handlers[1].onEvent({ type: 'step_started', step_id: 'new-step', label: '删除' })
      client.handlers[1].onEvent({
        type: 'confirmation_required',
        step_id: 'new-step',
        message: '确认？',
        confirmation_id: 'new-confirm',
      })
    })
    act(() => result.current.confirm('new-confirm'))
    expect(staleControl).not.toHaveBeenCalled()
    expect(client.controls.at(-1)).toMatchObject({ confirmation_id: 'new-confirm', approved: true })
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
    act(() => client.handlers[0].onEvent({ type: 'step_started', step_id: 'old-step', label: '旧步骤' }))
    const messagesBefore = result.current.messages
    const sessionBefore = result.current.sessionId
    let thrown: unknown
    await act(async () => {
      try {
        await result.current.clear()
      } catch (error) {
        thrown = error
      }
    })
    expect(thrown).toEqual(new Error('offline'))
    expect(result.current.messages).toEqual(messagesBefore)
    expect(result.current.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'old-step', label: '旧步骤' }),
    ]))
    expect(result.current.sessionId).toBe(sessionBefore)
    expect(result.current.status).toBe('failed')
  })

  it('shares one pending clear operation across duplicate calls', async () => {
    let resolveHistory!: () => void
    const pending = new Promise<void>((resolve) => { resolveHistory = resolve })
    const clearHistory = vi.fn(() => pending)
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({
      client, historyApi: { clear: clearHistory }, sessionIdFactory: () => 's',
    }))
    act(() => result.current.send('创建任务'))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.clear()
      second = result.current.clear()
    })
    expect(first).toBe(second)
    expect(clearHistory).toHaveBeenCalledTimes(1)
    resolveHistory()
    await act(() => first)
  })

  it('does not retain an empty clear promise across a later real session', async () => {
    const clearHistory = vi.fn().mockResolvedValue(undefined)
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({
      client, historyApi: { clear: clearHistory }, sessionIdFactory: () => 'later-session',
    }))

    await act(() => result.current.clear())
    expect(clearHistory).not.toHaveBeenCalled()
    act(() => result.current.send('稍后创建的会话'))
    act(() => client.handlers[0].onEvent({ type: 'done' }))
    await act(() => result.current.clear())

    expect(clearHistory).toHaveBeenCalledTimes(1)
    expect(clearHistory).toHaveBeenCalledWith('later-session')
    expect(result.current.messages).toEqual([])
    expect(result.current.sessionId).toBeUndefined()
  })

  it('treats cancel as a no-op while clear is pending and still commits successful clear', async () => {
    let resolveHistory!: () => void
    const pending = new Promise<void>((resolve) => { resolveHistory = resolve })
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({
      client, historyApi: { clear: vi.fn(() => pending) }, sessionIdFactory: () => 's',
    }))
    act(() => result.current.send('待清理会话'))
    act(() => client.handlers[0].onEvent({ type: 'step_started', step_id: 'delete-1', label: '删除' }))
    act(() => client.handlers[0].onEvent({
      type: 'confirmation_required', step_id: 'delete-1', message: '确认？', confirmation_id: 'confirm-1',
    }))
    let clearPromise!: Promise<void>
    act(() => { clearPromise = result.current.clear() })
    act(() => {
      result.current.cancel()
      result.current.confirm('confirm-1')
      result.current.reject('confirm-1')
    })

    expect(result.current.messages).toHaveLength(1)
    expect(client.controls).toEqual([])
    resolveHistory()
    await act(() => clearPromise)
    expect(result.current.messages).toEqual([])
    expect(result.current.status).toBe('idle')
  })

  it('ignores all callbacks after done or failure terminal states', () => {
    const client = new ControlledClient()
    const { result } = renderHook(() => useAgentSession({ client, sessionIdFactory: () => 's' }))
    act(() => result.current.send('第一轮'))
    act(() => client.handlers[0].onEvent({ type: 'done' }))
    act(() => {
      client.handlers[0].onEvent({ type: 'reply', content: 'done 后污染' })
      client.handlers[0].onFailure?.({ code: 'CONNECTION_CLOSED', message: 'done 后失败', retryable: false })
    })
    expect(result.current.status).toBe('done')
    expect(result.current.messages.some((message) => message.content === 'done 后污染')).toBe(false)

    act(() => result.current.send('第二轮'))
    act(() => client.handlers[1].onFailure?.({ code: 'CONNECTION_CLOSED', message: '失败', retryable: false }))
    act(() => {
      client.handlers[1].onOpen?.()
      client.handlers[1].onEvent({ type: 'reply', content: 'failure 后污染' })
    })
    expect(result.current.status).toBe('failed')
    expect(result.current.messages.some((message) => message.content === 'failure 后污染')).toBe(false)
  })
})
