import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentHandlers, AgentSessionDetail, AgentSessionSummary, AgentSessionsApi, AgentStreamClient } from '../agent.types'
import { parseAgentSessionDetail } from '../agent-history.api'
import { useAgentSession } from '../useAgentSession'

const first: AgentSessionSummary = {
  id: '11111111-1111-4111-8111-111111111111', title: '第一会话',
  createdAt: '2026-07-26T00:00:00Z', updatedAt: '2026-07-26T00:00:01Z', lastMessageAt: '2026-07-26T00:00:01Z',
}
const second: AgentSessionSummary = { ...first, id: '22222222-2222-4222-8222-222222222222', title: '第二会话' }
const third: AgentSessionSummary = { ...first, id: '33333333-3333-4333-8333-333333333333', title: '第三会话' }

function detail(session: AgentSessionSummary, content: string, stepId = 'step'): AgentSessionDetail {
  return { ...session, turns: [{
    id: `${session.id}-turn`, ordinal: 1, status: 'completed', startedAt: session.createdAt,
    completedAt: session.updatedAt, resultUncertain: false,
    messages: [
      { id: `${session.id}-user`, role: 'user', content, createdAt: session.createdAt },
      { id: `${session.id}-assistant`, role: 'assistant', content: `答复:${content}`, createdAt: session.updatedAt },
    ],
    steps: [{ id: stepId, eventId: `${session.id}-event`, label: content, status: 'completed', startedAt: session.createdAt }],
  }] }
}

function parsedFailedDetail(resultUncertain = false): AgentSessionDetail {
  return parseAgentSessionDetail({
    session: {
      id: first.id, title: first.title, created_at: first.createdAt,
      updated_at: first.updatedAt, last_message_at: first.lastMessageAt,
    },
    turns: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ordinal: 1,
      status: resultUncertain ? 'interrupted' : 'completed', started_at: first.createdAt, completed_at: first.updatedAt,
      failure_code: 'TOOL_TIMEOUT', failure_message: '超时', result_uncertain: resultUncertain,
      messages: [{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', role: 'user', content: '查询', ordinal: 1, created_at: first.createdAt,
      }],
      steps: [{
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        event_id: '99999999-9999-4999-8999-999999999999', ordinal: 1, label: '查询', tool: 'list_todos',
        status: 'failed', args: {}, result: null, result_preview: null, result_truncated: false, duration_ms: 5,
        error_code: 'TOOL_TIMEOUT', error_message: '超时', retryable: true,
        confirmation_id: null, confirmation_message: null, confirmation_approved: null,
        started_at: first.createdAt, completed_at: first.updatedAt,
      }],
    }],
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

class ControlledClient implements AgentStreamClient {
  handlers: AgentHandlers[] = []
  requests: unknown[] = []
  cancels = 0
  send(input: never, handlers: AgentHandlers) {
    this.requests.push(input)
    this.handlers.push(handlers)
    return () => { this.cancels++ }
  }
}

function api(overrides: Partial<AgentSessionsApi> = {}): AgentSessionsApi {
  return {
    list: vi.fn().mockResolvedValue([first, second]),
    detail: vi.fn(async (id) => detail(
      id === first.id ? first : id === second.id ? second : third,
      id === first.id ? '第一轮' : id === second.id ? '第二轮' : '第三轮',
    )),
    create: vi.fn().mockResolvedValue(first), rename: vi.fn().mockResolvedValue(first), delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderHistory(sessionsApi: AgentSessionsApi, client = new ControlledClient()) {
  const options = { sessionsApi, client }
  const hook = renderHook(() => useAgentSession(options as never))
  return { ...hook, client, current: () => hook.result.current as typeof hook.result.current & {
    sessions: AgentSessionSummary[]; selectedSessionId?: string; turns: AgentSessionDetail['turns'];
    isHistoryLoading: boolean; historyError?: string; reloadHistory(): Promise<void>;
    selectSession(id: string): void; createSession(title?: string): Promise<void>;
    renameSession(id: string, title: string): Promise<void>; deleteSession(id: string): Promise<void>;
  } }
}

describe('durable Agent session state', () => {
  it('retains a safe wire retry capability after done replaces the step with its DB identity', async () => {
    const persisted = parsedFailedDetail()
    const detailMock = vi.fn().mockResolvedValueOnce({ ...first, turns: [] }).mockResolvedValueOnce(persisted)
    const client = new ControlledClient()
    const hook = renderHistory(api({ list: vi.fn().mockResolvedValue([first]), detail: detailMock }), client)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    act(() => hook.current().send('查询'))
    act(() => {
      client.handlers[0].onEvent({
        type: 'step_started', event_id: '99999999-9999-4999-8999-999999999999',
        step_id: 'wire-S', label: '查询', tool: 'list_todos',
      })
      client.handlers[0].onEvent({
        type: 'step_failed', event_id: '99999999-9999-4999-8999-999999999999', step_id: 'wire-S',
        error_code: 'TOOL_TIMEOUT', message: '超时', retryable: true,
        retry_token: 'opaque-server-token-that-is-long-enough', duration_ms: 5,
      })
      client.handlers[0].onEvent({
        type: 'step_failed', event_id: '99999999-9999-4999-8999-999999999999', step_id: 'wire-S',
        error_code: 'TOOL_TIMEOUT', message: '重复帧', retryable: true,
        retry_token: 'different-duplicate-token-is-long-enough', duration_ms: 5,
      })
      client.handlers[0].onEvent({ type: 'done' })
    })
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))

    const dbStepId = persisted.turns[0].steps[0].id
    expect(dbStepId).not.toBe('wire-S')
    expect(hook.current().canRetry(dbStepId)).toBe(true)
    act(() => hook.current().retry(dbStepId))
    expect(hook.current().canRetry(dbStepId)).toBe(false)
    expect(client.requests.at(-1)).toMatchObject({
      type: 'retry_step', step_id: 'wire-S', retry_token: 'opaque-server-token-that-is-long-enough',
    })
  })

  it('does not retain a retry capability for an uncertain persisted result', async () => {
    const persisted = parsedFailedDetail(true)
    const detailMock = vi.fn().mockResolvedValueOnce({ ...first, turns: [] }).mockResolvedValueOnce(persisted)
    const client = new ControlledClient()
    const hook = renderHistory(api({ list: vi.fn().mockResolvedValue([first]), detail: detailMock }), client)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    act(() => hook.current().send('查询'))
    act(() => {
      client.handlers[0].onEvent({
        type: 'step_started', event_id: '99999999-9999-4999-8999-999999999999', step_id: 'wire-S', label: '查询', tool: 'list_todos',
      })
      client.handlers[0].onEvent({
        type: 'step_failed', event_id: '99999999-9999-4999-8999-999999999999', step_id: 'wire-S', error_code: 'X',
        message: '失败', retryable: true, retry_token: 'opaque-server-token-that-is-long-enough', duration_ms: 1,
      })
      client.handlers[0].onEvent({ type: 'done' })
    })
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    expect(hook.current().canRetry(persisted.turns[0].steps[0].id)).toBe(false)
  })

  it('does not retry a successful step in a completed persisted turn', async () => {
    const completed = detail(first, '查询完成', 'completed-step')
    const hook = renderHistory(api({
      list: vi.fn().mockResolvedValue([first]),
      detail: vi.fn().mockResolvedValue(completed),
    }))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    expect(hook.current().canRetry('completed-step')).toBe(false)
  })

  it('clears an ephemeral retry capability when switching away and back', async () => {
    const persisted = parsedFailedDetail()
    const detailMock = vi.fn()
      .mockResolvedValueOnce({ ...first, turns: [] })
      .mockResolvedValueOnce(persisted)
      .mockResolvedValueOnce({ ...second, turns: [] })
      .mockResolvedValueOnce(persisted)
    const client = new ControlledClient()
    const hook = renderHistory(api({ list: vi.fn().mockResolvedValue([first, second]), detail: detailMock }), client)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    act(() => hook.current().send('查询'))
    act(() => {
      client.handlers[0].onEvent({
        type: 'step_started', event_id: '99999999-9999-4999-8999-999999999999', step_id: 'wire-S', label: '查询', tool: 'list_todos',
      })
      client.handlers[0].onEvent({
        type: 'step_failed', event_id: '99999999-9999-4999-8999-999999999999', step_id: 'wire-S', error_code: 'X',
        message: '失败', retryable: true, retry_token: 'opaque-server-token-that-is-long-enough', duration_ms: 1,
      })
      client.handlers[0].onEvent({ type: 'done' })
    })
    await waitFor(() => expect(hook.current().canRetry(persisted.turns[0].steps[0].id)).toBe(true))
    act(() => hook.current().selectSession(second.id))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    act(() => hook.current().selectSession(first.id))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    expect(hook.current().canRetry(persisted.turns[0].steps[0].id)).toBe(false)
  })

  it('blocks sending from a persisted uncertain interrupted turn', async () => {
    const client = new ControlledClient()
    const persisted = parsedFailedDetail(true)
    const hook = renderHistory(api({ list: vi.fn().mockResolvedValue([first]), detail: vi.fn().mockResolvedValue(persisted) }), client)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    const turnsBefore = hook.current().turns
    let accepted = true
    act(() => { accepted = hook.current().send('不能继续') })
    expect(accepted).toBe(false)
    expect(client.requests).toEqual([])
    expect(hook.current().turns).toBe(turnsBefore)
  })

  it('retries an initial list failure and then selects and loads the first session', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('list offline')).mockResolvedValueOnce([first])
    const hook = renderHistory(api({ list }))
    await waitFor(() => expect(hook.current().historyError).toContain('list offline'))
    expect(hook.current().selectedSessionId).toBeUndefined()

    await act(() => hook.current().reloadHistory())
    expect(list).toHaveBeenCalledTimes(2)
    expect(hook.current().selectedSessionId).toBe(first.id)
    expect(hook.current().turns[0].messages[0].content).toBe('第一轮')
  })

  it('loads sessions, selects the first valid target and restores persisted turn identities', async () => {
    const sessionsApi = api()
    const hook = renderHistory(sessionsApi)
    await waitFor(() => expect(hook.current().selectedSessionId).toBe(first.id))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))

    expect(hook.current().turns[0]).toMatchObject({ id: `${first.id}-turn` })
    expect(hook.current().messages[0].id).toBe(`${first.id}-user`)
    expect(hook.current().steps[0]).toMatchObject({ id: 'step', label: '第一轮' })
  })

  it('keeps the old view while loading and a slow stale detail cannot overwrite a later selection', async () => {
    const slowFirst = deferred<AgentSessionDetail>()
    const slowSecond = deferred<AgentSessionDetail>()
    const sessionsApi = api({ detail: vi.fn((id) => id === first.id ? slowFirst.promise : slowSecond.promise) })
    const hook = renderHistory(sessionsApi)
    await waitFor(() => expect(hook.current().selectedSessionId).toBe(first.id))
    slowFirst.resolve(detail(first, '已加载第一轮'))
    await waitFor(() => expect(hook.current().turns[0]?.messages[0].content).toBe('已加载第一轮'))

    act(() => hook.current().selectSession(second.id))
    expect(hook.current().isHistoryLoading).toBe(true)
    expect(hook.current().turns[0].messages[0].content).toBe('已加载第一轮')
    act(() => hook.current().selectSession(first.id))
    slowSecond.resolve(detail(second, '过时第二轮'))
    await Promise.resolve()
    expect(hook.current().selectedSessionId).toBe(first.id)
    expect(hook.current().turns[0].messages[0].content).toBe('已加载第一轮')
  })

  it('preserves visible turns on detail failure and retries the selected detail', async () => {
    const detailMock = vi.fn()
      .mockResolvedValueOnce(detail(first, '旧内容'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(detail(second, '恢复内容'))
    const sessionsApi = api({ detail: detailMock })
    const hook = renderHistory(sessionsApi)
    await waitFor(() => expect(hook.current().turns[0]?.messages[0].content).toBe('旧内容'))
    act(() => hook.current().selectSession(second.id))
    await waitFor(() => expect(hook.current().historyError).toContain('offline'))
    expect(hook.current().turns[0].messages[0].content).toBe('旧内容')
    await act(() => hook.current().reloadHistory())
    expect(hook.current().turns[0].messages[0].content).toBe('恢复内容')
  })

  it('creates, atomically renames, and safely deletes current and non-current sessions', async () => {
    const created = { ...second, id: '33333333-3333-4333-8333-333333333333', title: '新会话' }
    const sessionsApi = api({
      list: vi.fn().mockResolvedValueOnce([first, second]).mockResolvedValue([created, second]),
      create: vi.fn().mockResolvedValue(created),
      detail: vi.fn(async (id) => id === created.id ? { ...created, turns: [] } : detail(id === first.id ? first : second, id)),
      rename: vi.fn(async (id, title) => ({ ...(id === created.id ? created : first), title })),
    })
    const hook = renderHistory(sessionsApi)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    await act(() => hook.current().createSession('新会话'))
    expect(hook.current().selectedSessionId).toBe(created.id)
    await act(() => hook.current().renameSession(created.id, '已重命名'))
    expect(hook.current().sessions.find((item) => item.id === created.id)?.title).toBe('已重命名')
    await act(() => hook.current().deleteSession(first.id))
    expect(hook.current().selectedSessionId).toBe(created.id)
    await act(() => hook.current().deleteSession(created.id))
    expect(hook.current().selectedSessionId).toBe(second.id)
  })

  it('serializes overlapping renames so an already-resolved B remains authoritative after A completes', async () => {
    const renameA = deferred<void>()
    const renameB = deferred<void>()
    let serverTitle = first.title
    const rename = vi.fn(async (_id: string, title: string) => {
      await (title === 'A' ? renameA.promise : renameB.promise)
      serverTitle = title
      return { ...first, title }
    })
    const hook = renderHistory(api({ list: vi.fn().mockResolvedValue([first]), rename }))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    let a!: Promise<void>
    let b!: Promise<void>
    act(() => {
      a = hook.current().renameSession(first.id, 'A')
      b = hook.current().renameSession(first.id, 'B')
    })
    renameB.resolve()
    renameA.resolve()
    await act(() => Promise.all([a, b]))
    expect(serverTitle).toBe('B')
    expect(hook.current().sessions[0].title).toBe('B')
  })

  it('continues the same-session rename queue after failure and confirms the later title', async () => {
    const renameA = deferred<void>()
    const renameB = deferred<void>()
    const rename = vi.fn(async (_id: string, title: string) => {
      await (title === 'A' ? renameA.promise : renameB.promise)
      return { ...first, title }
    })
    const hook = renderHistory(api({ list: vi.fn().mockResolvedValue([first]), rename }))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    let a!: Promise<void>
    let b!: Promise<void>
    act(() => {
      a = hook.current().renameSession(first.id, 'A')
      b = hook.current().renameSession(first.id, 'B')
    })
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(1))
    renameA.reject(new Error('A failed'))
    await act(async () => { await expect(a).rejects.toThrow('A failed') })
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(2))
    renameB.resolve()
    await act(() => b)
    expect(hook.current().sessions[0].title).toBe('B')
  })

  it('restores the last confirmed title when every queued rename fails', async () => {
    const renameA = deferred<void>()
    const renameB = deferred<void>()
    const rename = vi.fn(async (_id: string, title: string) => {
      await (title === 'A' ? renameA.promise : renameB.promise)
      return { ...first, title }
    })
    const hook = renderHistory(api({ list: vi.fn().mockResolvedValue([first]), rename }))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    let a!: Promise<void>
    let b!: Promise<void>
    act(() => {
      a = hook.current().renameSession(first.id, 'A')
      b = hook.current().renameSession(first.id, 'B')
    })
    renameA.reject(new Error('A failed'))
    await act(async () => { await expect(a).rejects.toThrow('A failed') })
    renameB.reject(new Error('B failed'))
    await act(async () => { await expect(b).rejects.toThrow('B failed') })
    expect(hook.current().sessions[0].title).toBe(first.title)
  })

  it('allows different sessions to rename in parallel', async () => {
    const pendingFirst = deferred<void>()
    const pendingSecond = deferred<void>()
    const rename = vi.fn(async (id: string, title: string) => {
      await (id === first.id ? pendingFirst.promise : pendingSecond.promise)
      return { ...(id === first.id ? first : second), title }
    })
    const hook = renderHistory(api({ rename }))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    let one!: Promise<void>
    let two!: Promise<void>
    act(() => {
      one = hook.current().renameSession(first.id, '一')
      two = hook.current().renameSession(second.id, '二')
    })
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(2))
    pendingFirst.resolve()
    pendingSecond.resolve()
    await act(() => Promise.all([one, two]))
  })

  it('deduplicates identical stable events but allows the same event_id to advance status', async () => {
    const client = new ControlledClient()
    const hook = renderHistory(api({ list: vi.fn().mockResolvedValue([first]), detail: vi.fn().mockResolvedValue({ ...first, turns: [] }) }), client)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    act(() => hook.current().send('查询'))
    const handlers = client.handlers[0]
    const eventId = '99999999-9999-4999-8999-999999999999'
    const started = { type: 'step_started', event_id: eventId, step_id: 'query', label: '查询' } as const
    act(() => { handlers.onEvent(started); handlers.onEvent({ ...started, label: '重复帧不应覆盖' }) })
    expect(hook.current().turns.at(-1)?.steps).toHaveLength(1)
    expect(hook.current().steps[0].label).toBe('查询')
    expect(hook.current().turns.at(-1)?.steps[0].label).toBe('查询')
    act(() => handlers.onEvent({ type: 'step_completed', event_id: eventId, step_id: 'query', duration_ms: 5 }))
    expect(hook.current().turns.at(-1)?.steps[0]).toMatchObject({ status: 'completed', durationMs: 5 })
  })

  it('closes the old stream on selection and ignores its later events', async () => {
    const client = new ControlledClient()
    const sessionsApi = api()
    const hook = renderHistory(sessionsApi, client)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    act(() => hook.current().send('第一会话请求'))
    const stale = client.handlers[0]
    act(() => hook.current().selectSession(second.id))
    await waitFor(() => expect(hook.current().selectedSessionId).toBe(second.id))
    expect(client.cancels).toBeGreaterThan(0)
    const detailCalls = vi.mocked(sessionsApi.detail).mock.calls.length
    const listCalls = vi.mocked(sessionsApi.list).mock.calls.length
    act(() => {
      stale.onEvent({ type: 'reply', content: '旧 socket 污染' })
      stale.onEvent({ type: 'done' })
    })
    expect(hook.current().messages.some((message) => message.content === '旧 socket 污染')).toBe(false)
    expect(sessionsApi.detail).toHaveBeenCalledTimes(detailCalls)
    expect(sessionsApi.list).toHaveBeenCalledTimes(listCalls)
  })

  it('coalesces duplicate create clicks and a late create never steals a newer selection', async () => {
    const pending = deferred<AgentSessionSummary>()
    const create = vi.fn(() => pending.promise)
    const hook = renderHistory(api({ create }))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    let one!: Promise<void>
    let two!: Promise<void>
    act(() => {
      one = hook.current().createSession('稍后完成')
      two = hook.current().createSession('重复点击')
      hook.current().selectSession(second.id)
    })
    expect(one).toBe(two)
    expect(create).toHaveBeenCalledTimes(1)
    pending.resolve({ ...first, id: '44444444-4444-4444-8444-444444444444', title: '稍后完成' })
    await act(() => one)
    expect(hook.current().selectedSessionId).toBe(second.id)
  })

  it('does not resurrect a deleted session when an older rename resolves', async () => {
    const pendingRename = deferred<AgentSessionSummary>()
    const hook = renderHistory(api({ rename: vi.fn(() => pendingRename.promise) }))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    let rename!: Promise<void>
    act(() => { rename = hook.current().renameSession(first.id, '旧请求') })
    await act(() => hook.current().deleteSession(first.id))
    pendingRename.resolve({ ...first, title: '晚到标题' })
    await act(() => rename)
    expect(hook.current().sessions.some((item) => item.id === first.id)).toBe(false)
  })

  it('never resurrects tombstoned sessions when two deletes start from the same render', async () => {
    const deleteFirst = deferred<void>()
    const deleteSecond = deferred<void>()
    const list = vi.fn().mockResolvedValueOnce([first, second, third]).mockResolvedValue([third])
    const sessionsApi = api({
      list,
      delete: vi.fn((id) => id === first.id ? deleteFirst.promise : deleteSecond.promise),
    })
    const hook = renderHistory(sessionsApi)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    let firstDelete!: Promise<void>
    let secondDelete!: Promise<void>
    act(() => {
      firstDelete = hook.current().deleteSession(first.id)
      secondDelete = hook.current().deleteSession(second.id)
    })
    expect(hook.current().sessions.map((item) => item.id)).toEqual([third.id])
    deleteSecond.resolve()
    deleteFirst.resolve()
    await act(() => Promise.all([firstDelete, secondDelete]))
    expect(hook.current().sessions.map((item) => item.id)).toEqual([third.id])
    expect(hook.current().selectedSessionId).toBe(third.id)
  })

  it('does not override a newer user selection when the deleted current session finishes later', async () => {
    const pendingDelete = deferred<void>()
    const sessionsApi = api({
      list: vi.fn().mockResolvedValueOnce([first, second, third]).mockResolvedValue([second, third]),
      delete: vi.fn(() => pendingDelete.promise),
    })
    const hook = renderHistory(sessionsApi)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    let deletion!: Promise<void>
    act(() => { deletion = hook.current().deleteSession(first.id) })
    act(() => hook.current().selectSession(third.id))
    await waitFor(() => expect(hook.current().selectedSessionId).toBe(third.id))
    pendingDelete.resolve()
    await act(() => deletion)
    expect(hook.current().selectedSessionId).toBe(third.id)
  })

  it('rolls back only the failed delete without reviving another tombstoned session', async () => {
    const deleteFirst = deferred<void>()
    const deleteSecond = deferred<void>()
    const sessionsApi = api({
      list: vi.fn().mockResolvedValueOnce([first, second, third]).mockResolvedValue([first, third]),
      delete: vi.fn((id) => id === first.id ? deleteFirst.promise : deleteSecond.promise),
    })
    const hook = renderHistory(sessionsApi)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    let failed!: Promise<void>
    let succeeded!: Promise<void>
    act(() => {
      failed = hook.current().deleteSession(first.id)
      succeeded = hook.current().deleteSession(second.id)
    })
    deleteFirst.reject(new Error('delete failed'))
    await act(async () => { await expect(failed).rejects.toThrow('delete failed') })
    expect(hook.current().sessions.map((item) => item.id)).toEqual([first.id, third.id])
    deleteSecond.resolve()
    await act(() => succeeded)
  })

  it.each([
    { removed: first, expected: [first.id, second.id, third.id] },
    { removed: second, expected: [first.id, second.id, third.id] },
  ])('restores a failed delete of $removed.title at its original relative position', async ({ removed, expected }) => {
    const pendingDelete = deferred<void>()
    const sessionsApi = api({
      list: vi.fn().mockResolvedValue([first, second, third]),
      delete: vi.fn(() => pendingDelete.promise),
    })
    const hook = renderHistory(sessionsApi)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    let deletion!: Promise<void>
    act(() => { deletion = hook.current().deleteSession(removed.id) })
    expect(hook.current().sessions.some((item) => item.id === removed.id)).toBe(false)
    pendingDelete.reject(new Error('delete failed'))
    await act(async () => { await expect(deletion).rejects.toThrow('delete failed') })
    expect(hook.current().sessions.map((item) => item.id)).toEqual(expected)
  })

  it('restores uncertain interrupted turns without enabling replay', async () => {
    const uncertain = detail(first, '可能已执行')
    uncertain.turns[0] = {
      ...uncertain.turns[0], status: 'interrupted', resultUncertain: true,
      steps: [{
        id: 'write', eventId: 'write-event', label: '创建', status: 'failed', tool: 'list_todos',
        retryable: true, retryToken: 'opaque-server-token-that-is-long-enough', startedAt: first.createdAt,
      }],
    }
    const hook = renderHistory(api({ list: vi.fn().mockResolvedValue([first]), detail: vi.fn().mockResolvedValue(uncertain) }))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    expect(hook.current().turns[0]).toMatchObject({ status: 'interrupted', resultUncertain: true })
    expect(hook.current().canRetry('write')).toBe(false)
  })

  it('refreshes both detail identities and list ordering after ordinary done', async () => {
    const refreshedFirst = { ...first, title: '服务端新标题', updatedAt: '2026-07-26T02:00:00Z', lastMessageAt: '2026-07-26T02:00:00Z' }
    const list = vi.fn().mockResolvedValueOnce([first, second]).mockResolvedValueOnce([second, refreshedFirst])
    const detailMock = vi.fn()
      .mockResolvedValueOnce({ ...first, turns: [] })
      .mockResolvedValueOnce(detail(refreshedFirst, '服务端持久化轮次', 'server-step'))
    const client = new ControlledClient()
    const hook = renderHistory(api({ list, detail: detailMock }), client)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    act(() => hook.current().send('新请求'))
    act(() => client.handlers[0].onEvent({ type: 'done' }))

    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(hook.current().sessions.map((item) => item.id)).toEqual([second.id, first.id])
    expect(hook.current().turns[0].id).toBe(`${first.id}-turn`)
    expect(hook.current().messages[0].id).toBe(`${first.id}-user`)
  })

  it('refreshes both detail and list after retry done', async () => {
    const failed = parsedFailedDetail()
    const restored = detail(first, '重试后服务端轮次', 'server-retry-step')
    const list = vi.fn().mockResolvedValue([first])
    const detailMock = vi.fn()
      .mockResolvedValueOnce({ ...first, turns: [] })
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(restored)
    const client = new ControlledClient()
    const hook = renderHistory(api({ list, detail: detailMock }), client)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    act(() => hook.current().send('查询'))
    act(() => {
      client.handlers[0].onEvent({
        type: 'step_started', event_id: '99999999-9999-4999-8999-999999999999',
        step_id: 'wire-read', label: '查询', tool: 'list_todos',
      })
      client.handlers[0].onEvent({
        type: 'step_failed', event_id: '99999999-9999-4999-8999-999999999999', step_id: 'wire-read',
        error_code: 'X', message: '失败', retryable: true,
        retry_token: 'opaque-server-token-that-is-long-enough', duration_ms: 1,
      })
      client.handlers[0].onEvent({ type: 'done' })
    })
    await waitFor(() => expect(hook.current().canRetry(failed.turns[0].steps[0].id)).toBe(true))
    act(() => hook.current().retry(failed.turns[0].steps[0].id))
    act(() => client.handlers[1].onEvent({ type: 'done' }))

    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
    expect(hook.current().turns[0].steps[0].id).toBe('server-retry-step')
  })

  it('ignores an old done-sync rejection after selection and keeps the new detail loading', async () => {
    const staleSync = deferred<AgentSessionDetail>()
    const newDetail = deferred<AgentSessionDetail>()
    const detailMock = vi.fn()
      .mockResolvedValueOnce({ ...first, turns: [] })
      .mockImplementationOnce(() => staleSync.promise)
      .mockImplementationOnce(() => newDetail.promise)
    const client = new ControlledClient()
    const hook = renderHistory(api({ list: vi.fn().mockResolvedValue([first, second]), detail: detailMock }), client)
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
    act(() => hook.current().send('旧会话请求'))
    act(() => client.handlers[0].onEvent({ type: 'done' }))
    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2))
    act(() => hook.current().selectSession(second.id))
    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(3))
    expect(hook.current().isHistoryLoading).toBe(true)

    staleSync.reject(new Error('stale sync failed'))
    await act(async () => { await Promise.resolve() })
    expect(hook.current().historyError).toBeUndefined()
    expect(hook.current().isHistoryLoading).toBe(true)

    newDetail.resolve(detail(second, '新会话内容'))
    await waitFor(() => expect(hook.current().isHistoryLoading).toBe(false))
  })
})
