import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../mocks/server'
import { ApiError } from '../../../shared/api/authenticated-fetch'
import { agentSessionsApi } from '../agent-history.api'

const summary = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '计划今天',
  created_at: '2026-07-26T01:00:00+00:00',
  updated_at: '2026-07-26T01:01:00+00:00',
  last_message_at: '2026-07-26T01:01:00+00:00',
}

const ok = (data: unknown, init?: ResponseInit) => HttpResponse.json({ code: 0, message: 'ok', data }, init)

afterEach(() => vi.restoreAllMocks())

describe('agentSessionsApi', () => {
  it('parses list and nested detail without moving steps across turns', async () => {
    server.use(
      http.get('/api/agent/sessions', () => ok({ items: [summary] })),
      http.get(`/api/agent/sessions/${summary.id}`, () => ok({
        session: summary,
        turns: [
          {
            id: '21111111-1111-4111-8111-111111111111', ordinal: 1, status: 'completed',
            started_at: summary.created_at, completed_at: summary.updated_at,
            failure_code: null, failure_message: null, result_uncertain: false,
            messages: [
              { id: '31111111-1111-4111-8111-111111111111', role: 'user', content: '第一轮', ordinal: 1, created_at: summary.created_at },
              { id: '41111111-1111-4111-8111-111111111111', role: 'assistant', content: '完成', ordinal: 2, created_at: summary.updated_at },
            ],
            steps: [{
              id: '51111111-1111-4111-8111-111111111111', event_id: '61111111-1111-4111-8111-111111111111', ordinal: 1,
              label: '查询', tool: 'list_todos', status: 'completed', args: {}, result: [], result_preview: '[]',
              result_truncated: false, duration_ms: 2, error_code: null, error_message: null, retryable: false,
              confirmation_id: null, confirmation_message: null, confirmation_approved: null,
              started_at: summary.created_at, completed_at: summary.updated_at,
            }],
          },
          {
            id: '71111111-1111-4111-8111-111111111111', ordinal: 2, status: 'interrupted',
            started_at: summary.updated_at, completed_at: null, failure_code: 'INTERRUPTED', failure_message: 'restart',
            result_uncertain: true, messages: [], steps: [],
          },
        ],
      })),
    )

    await expect(agentSessionsApi.list()).resolves.toEqual([{
      id: summary.id, title: summary.title,
      createdAt: summary.created_at, updatedAt: summary.updated_at, lastMessageAt: summary.last_message_at,
    }])
    const detail = await agentSessionsApi.detail(summary.id)
    expect(detail.turns).toHaveLength(2)
    expect(detail.turns[0].steps[0]).toMatchObject({ eventId: '61111111-1111-4111-8111-111111111111', label: '查询' })
    expect(detail.turns[1]).toMatchObject({ status: 'interrupted', resultUncertain: true, steps: [] })
  })

  it.each([
    { data: { items: [{ ...summary, surprise: true }] }, name: 'unknown summary field' },
    { data: { items: [{ ...summary, title: 7 }] }, name: 'wrong field type' },
    { data: { items: 'not-an-array' }, name: 'wrong list shape' },
    { data: { items: [{ ...summary, id: 'not-a-uuid' }] }, name: 'invalid id' },
    { data: { items: [{ ...summary, created_at: 'yesterday' }] }, name: 'invalid timestamp' },
  ])('fails closed for $name', async ({ data }) => {
    server.use(http.get('/api/agent/sessions', () => ok(data)))
    await expect(agentSessionsApi.list()).rejects.toThrow(/Agent session contract/i)
  })

  it('rejects malformed success envelopes through the shared primitive', async () => {
    server.use(http.get('/api/agent/sessions', () => HttpResponse.json({ items: [summary] })))
    await expect(agentSessionsApi.list()).rejects.toBeInstanceOf(ApiError)
  })

  it.each([403, 404])('preserves owner-safe %s errors without interpreting response data', async (status) => {
    server.use(http.get(`/api/agent/sessions/${summary.id}`, () => HttpResponse.json({
      code: status === 404 ? 40402 : 40301, message: status === 404 ? '会话不存在' : 'Forbidden', data: null,
    }, { status })))
    await expect(agentSessionsApi.detail(summary.id)).rejects.toMatchObject({ status })
  })

  it('creates, renames and deletes with the server contract', async () => {
    const requests: Array<{ method: string; body: unknown; credentials: RequestCredentials }> = []
    server.use(
      http.post('/api/agent/sessions', async ({ request }) => {
        requests.push({ method: request.method, body: await request.json(), credentials: request.credentials })
        return ok(summary, { status: 201 })
      }),
      http.patch(`/api/agent/sessions/${summary.id}`, async ({ request }) => {
        requests.push({ method: request.method, body: await request.json(), credentials: request.credentials })
        return ok({ ...summary, title: '新标题' })
      }),
      http.delete(`/api/agent/sessions/${summary.id}`, ({ request }) => {
        requests.push({ method: request.method, body: undefined, credentials: request.credentials })
        return ok({ deleted: true, session_id: summary.id })
      }),
    )

    await expect(agentSessionsApi.create({ firstMessage: '计划今天' })).resolves.toMatchObject({ id: summary.id })
    await expect(agentSessionsApi.rename(summary.id, '新标题')).resolves.toMatchObject({ title: '新标题' })
    await expect(agentSessionsApi.delete(summary.id)).resolves.toBeUndefined()
    expect(requests).toEqual([
      { method: 'POST', body: { first_message: '计划今天' }, credentials: 'include' },
      { method: 'PATCH', body: { title: '新标题' }, credentials: 'include' },
      { method: 'DELETE', body: undefined, credentials: 'include' },
    ])
  })
})
