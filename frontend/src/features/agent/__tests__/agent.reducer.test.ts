import { describe, expect, it } from 'vitest'
import { initialAgentState, reduceAgent } from '../agent.reducer'
import type { AgentEvent } from '../agent.types'

const started: AgentEvent = {
  type: 'step_started',
  step_id: 'create-1',
  label: '调用 Todo API',
  tool: 'create_todo',
  args: { title: '完成原型' },
  started_at: '2026-07-14T00:00:00Z',
}

describe('reduceAgent', () => {
  it('moves a running step to completed without mutating the previous state', () => {
    const running = reduceAgent(initialAgentState, started)
    const completed = reduceAgent(running, {
      type: 'step_completed', step_id: 'create-1', duration_ms: 742,
    })

    expect(running.steps[0]).toMatchObject({ status: 'running' })
    expect(completed.steps[0]).toMatchObject({ status: 'completed', durationMs: 742 })
    expect(completed.steps).not.toBe(running.steps)
  })

  it('moves a running step to failed and preserves retry metadata', () => {
    const running = reduceAgent(initialAgentState, started)
    const failed = reduceAgent(running, {
      type: 'step_failed',
      step_id: 'create-1',
      error_code: 'TOOL_TIMEOUT',
      message: 'Todo API 响应超时',
      retryable: true,
      duration_ms: 5000,
    })

    expect(failed.status).toBe('failed')
    expect(failed.steps[0]).toMatchObject({
      status: 'failed', retryable: true, errorCode: 'TOOL_TIMEOUT', durationMs: 5000,
    })
  })

  it('replaces duplicate step_started in place instead of creating duplicate timelines', () => {
    const first = reduceAgent(initialAgentState, started)
    const duplicate = reduceAgent(first, { ...started, label: '重试 Todo API' })

    expect(duplicate.steps).toHaveLength(1)
    expect(duplicate.steps[0]).toMatchObject({ label: '重试 Todo API', status: 'running' })
  })

  it('ignores completion for an unknown or out-of-order step', () => {
    const next = reduceAgent(initialAgentState, {
      type: 'step_completed', step_id: 'missing', duration_ms: 1,
    })
    expect(next).toBe(initialAgentState)
  })

  it('waits for confirmation then completes the action on the same step', () => {
    const running = reduceAgent(initialAgentState, started)
    const waiting = reduceAgent(running, {
      type: 'confirmation_required',
      step_id: 'create-1',
      message: '确认执行？',
      confirmation_id: 'confirm-1',
    })
    const completed = reduceAgent(waiting, {
      type: 'action_completed',
      step_id: 'create-1',
      action: 'create_todo',
      result: { id: 7 },
      duration_ms: 1380,
    })

    expect(waiting.status).toBe('waiting_confirmation')
    expect(waiting.pendingConfirmation).toEqual({
      stepId: 'create-1', confirmationId: 'confirm-1', message: '确认执行？',
    })
    expect(completed.steps[0]).toMatchObject({ status: 'completed', action: 'create_todo', result: { id: 7 } })
    expect(completed.pendingConfirmation).toBeUndefined()
  })

  it('coalesces streamed reply chunks while preserving user/assistant order', () => {
    const requested = reduceAgent(initialAgentState, {
      type: 'request_started',
      message: '创建任务',
      sessionId: 'session-1',
      messageId: 'user-1',
      createdAt: '2026-07-14T01:00:00Z',
    })
    const firstChunk = reduceAgent(requested, {
      type: 'reply', content: '好的，已为你',
    })
    const secondChunk = reduceAgent(firstChunk, {
      type: 'reply', content: '创建任务',
    })

    expect(secondChunk.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', '创建任务'],
      ['assistant', '好的，已为你创建任务'],
    ])
    expect(secondChunk.messages[1].createdAt).toBe('2026-07-14T01:00:00Z')
  })

  it('returns to idle on manual cancellation while preserving the visible timeline', () => {
    const running = reduceAgent(reduceAgent(initialAgentState, started), { type: 'connected' })
    const cancelled = reduceAgent(running, { type: 'cancelled' })

    expect(cancelled.status).toBe('idle')
    expect(cancelled.serverDone).toBe(false)
    expect(cancelled.steps).toEqual(running.steps)
  })

  it('only server done opens the terminal gate, never a client failure', () => {
    const running = reduceAgent(initialAgentState, {
      type: 'request_started', message: '查询', sessionId: 's', messageId: 'm', createdAt: 'now',
    })
    const failed = reduceAgent(running, {
      type: 'client_failed',
      failure: { code: 'CONNECTION_CLOSED', message: '断线', retryable: false },
    })
    const done = reduceAgent(running, { type: 'done' })

    expect(running.serverDone).toBe(false)
    expect(failed.serverDone).toBe(false)
    expect(done.serverDone).toBe(true)
  })

  it('preserves messages but clears the previous timeline for a new request', () => {
    const withOldTurn = {
      ...reduceAgent(reduceAgent(initialAgentState, started), { type: 'reply', content: '完成' } as AgentEvent),
      status: 'done' as const,
    }
    const next = reduceAgent(withOldTurn, {
      type: 'request_started',
      message: '下一项',
      sessionId: 'session-1',
      messageId: 'user-2',
      createdAt: '2026-07-14T01:01:00Z',
    })

    expect(next.messages.at(-1)).toMatchObject({ role: 'user', content: '下一项' })
    expect(next.steps).toEqual([])
    expect(next.status).toBe('connecting')
    expect(next.lastRequest).toBe('下一项')
  })

  it('marks a successful stream done but keeps a failed stream failed', () => {
    const done = reduceAgent(reduceAgent(initialAgentState, started), { type: 'done' })
    const failed = reduceAgent(
      reduceAgent(reduceAgent(initialAgentState, started), {
        type: 'step_failed', step_id: 'create-1', error_code: 'X', message: 'no', retryable: false, duration_ms: 1,
      }),
      { type: 'done' },
    )

    expect(done.status).toBe('done')
    expect(failed.status).toBe('failed')
  })
})
