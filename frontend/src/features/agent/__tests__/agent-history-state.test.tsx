import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentHandlers, AgentSessionDetail, AgentSessionSummary, AgentSessionsApi, AgentStreamClient } from '../agent.types'
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
    deleteSecond.resolve()
    await act(async () => {
      await expect(failed).rejects.toThrow('delete failed')
      await succeeded
    })
    expect(hook.current().sessions.some((item) => item.id === first.id)).toBe(true)
    expect(hook.current().sessions.some((item) => item.id === second.id)).toBe(false)
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
    const failed = detail(first, '查询失败')
    failed.turns[0] = {
      ...failed.turns[0], status: 'failed',
      steps: [{ id: 'read', eventId: '99999999-9999-4999-8999-999999999999', label: '查询', status: 'failed',
        tool: 'list_todos', retryable: true, retryToken: 'opaque-server-token-that-is-long-enough' }],
    }
    const restored = detail(first, '重试后服务端轮次', 'server-retry-step')
    const list = vi.fn().mockResolvedValue([first])
    const detailMock = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(restored)
    const client = new ControlledClient()
    const hook = renderHistory(api({ list, detail: detailMock }), client)
    await waitFor(() => expect(hook.current().canRetry('read')).toBe(true))
    act(() => hook.current().retry('read'))
    act(() => client.handlers[0].onEvent({ type: 'done' }))

    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(hook.current().turns[0].steps[0].id).toBe('server-retry-step')
  })
})
