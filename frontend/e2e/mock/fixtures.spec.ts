import { expect, test } from '../fixtures/agent.fixture'
import { shouldInstallMockTransport } from '../fixtures/app.fixture'
import type { Page } from '@playwright/test'

async function createOwnedSession(page: Page, title = '测试会话') {
  return page.evaluate(async (sessionTitle) => {
    const response = await fetch('/api/agent/sessions', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: sessionTitle }),
    })
    const payload = await response.json() as { data: { id: string } }
    return payload.data.id
  }, title)
}

test('mock routing is disabled for the real project and explicit real mode', () => {
  expect(shouldInstallMockTransport('chromium', false)).toBe(true)
  expect(shouldInstallMockTransport('real-chromium', false)).toBe(false)
  expect(shouldInstallMockTransport('chromium', true)).toBe(false)
})

test('API fixture seeds todos independently', async ({ page, login, seedTodos }) => {
  await seedTodos([{
    id: 91,
    title: 'fixture seeded task',
    description: '',
    priority: 'high',
    completed: false,
    due_date: '2026-07-14T02:00:00Z',
    created_at: '2026-07-13T02:00:00Z',
    updated_at: '2026-07-13T02:00:00Z',
  }])
  await login()
  await page.goto('/tasks')
  await expect(page.getByText('fixture seeded task')).toBeVisible()
})

test('API fixture fails only the next todo request', async ({ page, login, failNextTodoRequest }) => {
  await failNextTodoRequest({ status: 503, message: 'fixture failure' })
  await login()
  const statuses = await page.evaluate(async () => {
    const first = await fetch('/api/todos')
    const second = await fetch('/api/todos')
    return [first.status, second.status]
  })
  expect(statuses).toEqual([503, 200])
})

test('API fixture preserves a created todo for the following GET', async ({ page, login, seedTodos }) => {
  await seedTodos([])
  await login()
  const result = await page.evaluate(async () => {
    const created = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'persistent create', priority: 'high' }),
    })
    const list = await fetch('/api/todos').then((response) => response.json()) as {
      data: { items: Array<{ title: string }> }
    }
    return { status: created.status, titles: list.data.items.map((todo) => todo.title) }
  })
  expect(result).toEqual({ status: 201, titles: ['persistent create'] })
})

test('API fixture preserves updates, completion and deletion for following GETs', async ({ page, login, seedTodos }) => {
  await seedTodos([{
    id: 7,
    title: 'before update',
    description: '',
    priority: 'low',
    completed: false,
    due_date: null,
    created_at: '2026-07-13T02:00:00Z',
    updated_at: '2026-07-13T02:00:00Z',
  }])
  await login()
  const result = await page.evaluate(async () => {
    await fetch('/api/todos/7', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'after update' }),
    })
    const updated = await fetch('/api/todos/7').then((response) => response.json()) as { data: { title: string } }
    await fetch('/api/todos/7/complete', { method: 'PATCH' })
    const completed = await fetch('/api/todos/7').then((response) => response.json()) as { data: { completed: boolean } }
    await fetch('/api/todos/7/uncomplete', { method: 'PATCH' })
    const reopened = await fetch('/api/todos/7').then((response) => response.json()) as { data: { completed: boolean } }
    await fetch('/api/todos/7', { method: 'DELETE' })
    const deleted = await fetch('/api/todos/7')
    return {
      title: updated.data.title,
      completed: completed.data.completed,
      reopened: reopened.data.completed,
      deletedStatus: deleted.status,
    }
  })
  expect(result).toEqual({ title: 'after update', completed: true, reopened: false, deletedStatus: 404 })
})

test('app fixture shares the Cookie session without injecting localStorage identity', async ({ context, login }) => {
  await login()
  const session = (await context.cookies('http://127.0.0.1:3000')).find((cookie) => cookie.name === 'todolist_mock_session')
  expect(session).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
  })
  const secondPage = await context.newPage()
  await secondPage.goto('/tasks')
  await expect(secondPage.getByRole('heading', { name: '今天，保持专注' })).toBeVisible()
  await expect.poll(() => secondPage.evaluate(() => localStorage.getItem('todolist.auth.session'))).toBeNull()
  await secondPage.close()
})

test('Agent fixture streams a deterministic success sequence', async ({ page, login, useAgentScenario }) => {
  await useAgentScenario('success')
  await login()
  const sessionId = await createOwnedSession(page)
  const eventTypes = await page.evaluate((ownedSession) => new Promise<string[]>((resolve, reject) => {
    const events: string[] = []
    const socket = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(ownedSession)}`)
    socket.onerror = () => reject(new Error('mock socket failed'))
    socket.onopen = () => socket.send(JSON.stringify({ message: 'create a task', session_id: ownedSession }))
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as { type: string }
      events.push(event.type)
      if (event.type === 'done') resolve(events)
    }
  }), sessionId)
  expect(eventTypes).toEqual(['step_started', 'step_completed', 'step_started', 'action_completed', 'reply', 'done'])
})

test('Agent confirmation timing is relative to the confirmation event', async ({ page, login, useAgentScenario }) => {
  await useAgentScenario('confirmationRequired', { timeScale: 0.25 })
  await login()
  const sessionId = await createOwnedSession(page)
  const actionDelay = await page.evaluate((ownedSession) => new Promise<number>((resolve, reject) => {
    let confirmedAt = 0
    const socket = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(ownedSession)}`)
    socket.onerror = () => reject(new Error('mock socket failed'))
    socket.onopen = () => socket.send(JSON.stringify({ message: 'delete a task', session_id: ownedSession }))
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as { type: string; confirmation_id?: string }
      if (event.type === 'confirmation_required') {
        confirmedAt = performance.now()
        socket.send(JSON.stringify({
          type: 'confirmation_response',
          confirmation_id: event.confirmation_id,
          approved: true,
        }))
      }
      if (event.type === 'action_completed') resolve(performance.now() - confirmedAt)
    }
  }), sessionId)
  expect(actionDelay).toBeGreaterThan(200)
  expect(actionDelay).toBeLessThan(600)
})

test('Agent socket rejects a session owned by another authenticated user', async ({ page, login, useAgentScenario }) => {
  await login()
  const aliceSession = await createOwnedSession(page, 'Alice 私有会话')
  await login({ account: {
    id: 'bob', name: 'Bob', email: 'bob@example.com', timezone: 'Asia/Shanghai (UTC+8)',
    avatar: { kind: 'preset', value: 'amber' }, taskCount: 0, agentSessionCount: 0,
  } })
  await useAgentScenario('success')

  const result = await page.evaluate((sessionId) => new Promise<{ closeCode?: number; eventType?: string }>((resolve) => {
    const socket = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(sessionId)}`)
    socket.onopen = () => socket.send(JSON.stringify({ message: '越权写入', session_id: sessionId }))
    socket.onmessage = (message) => resolve({ eventType: (JSON.parse(String(message.data)) as { type: string }).type })
    socket.onclose = (event) => resolve({ closeCode: event.code })
  }), aliceSession)

  expect(result).toEqual({ closeCode: 1008 })
})

test('Agent socket rejects a frame whose session differs from the URL session', async ({ page, login, useAgentScenario }) => {
  await login()
  const [urlSession, frameSession] = await Promise.all([
    createOwnedSession(page, 'URL 会话'), createOwnedSession(page, '帧会话'),
  ])
  await useAgentScenario('success')

  const closeCode = await page.evaluate(({ urlId, frameId }) => new Promise<number>((resolve) => {
    const socket = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(urlId)}`)
    socket.onopen = () => socket.send(JSON.stringify({ message: '错位写入', session_id: frameId }))
    socket.onclose = (event) => resolve(event.code)
  }), { urlId: urlSession, frameId: frameSession })

  expect(closeCode).toBe(1003)
  const turnCounts = await page.evaluate(async (ids) => Promise.all(ids.map(async (id) => {
    const payload = await fetch(`/api/agent/sessions/${id}`).then((response) => response.json()) as { data: { turns: unknown[] } }
    return payload.data.turns.length
  })), [urlSession, frameSession])
  expect(turnCounts).toEqual([0, 0])
})

test('Agent confirmation from one session cannot approve another session', async ({ page, login, useAgentScenario }) => {
  await login()
  const [firstSession, secondSession] = await Promise.all([
    createOwnedSession(page, '第一会话'),
    createOwnedSession(page, '第二会话'),
  ])
  await useAgentScenario('confirmationRequired')

  const result = await page.evaluate(({ firstId, secondId }) => new Promise<{ closeCode?: number; eventType?: string }>((resolve) => {
    const first = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(firstId)}`)
    const second = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(secondId)}`)
    let firstConfirmation = ''
    let secondReady = false
    const tryForge = () => {
      if (firstConfirmation && secondReady) second.send(JSON.stringify({
        type: 'confirmation_response', confirmation_id: firstConfirmation, approved: true,
      }))
    }
    first.onopen = () => first.send(JSON.stringify({ message: '第一会话删除', session_id: firstId }))
    second.onopen = () => second.send(JSON.stringify({ message: '第二会话删除', session_id: secondId }))
    first.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as { type: string; confirmation_id?: string }
      if (event.type === 'confirmation_required') { firstConfirmation = event.confirmation_id ?? ''; tryForge() }
    }
    second.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as { type: string }
      if (event.type === 'confirmation_required') { secondReady = true; tryForge() }
      if (event.type === 'action_completed') resolve({ eventType: event.type })
    }
    second.onclose = (event) => resolve({ closeCode: event.code })
  }), { firstId: firstSession, secondId: secondSession })

  expect(result).toEqual({ closeCode: 1008 })
})

test('done from another socket cannot unlock a retry token', async ({ page, login, useAgentScenario }) => {
  await login()
  const [slowSession, fastSession] = await Promise.all([
    createOwnedSession(page, '慢会话'), createOwnedSession(page, '快会话'),
  ])
  await useAgentScenario('readOnlyTimeout', { timeScale: 0.25 })

  const result = await page.evaluate(({ slowId, fastId }) => new Promise<string>((resolve, reject) => {
    const slow = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(slowId)}`)
    slow.onerror = () => reject(new Error('slow socket failed'))
    slow.onopen = () => slow.send(JSON.stringify({ message: '慢查询', session_id: slowId }))
    slow.onmessage = async (message) => {
      const event = JSON.parse(String(message.data)) as { type: string; step_id?: string; retry_token?: string }
      if (event.type !== 'step_failed' || !event.step_id || !event.retry_token) return
      await fetch('/api/__e2e__/agent/scenario', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'success', timeScale: 0 }),
      })
      const fast = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(fastId)}`)
      fast.onopen = () => fast.send(JSON.stringify({ message: '快执行', session_id: fastId }))
      fast.onmessage = (fastMessage) => {
        const fastEvent = JSON.parse(String(fastMessage.data)) as { type: string }
        if (fastEvent.type !== 'done') return
        const retry = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(slowId)}`)
        retry.onopen = () => retry.send(JSON.stringify({
          type: 'retry_step', session_id: slowId, step_id: event.step_id, retry_token: event.retry_token,
        }))
        retry.onmessage = (retryMessage) => {
          const retryEvent = JSON.parse(String(retryMessage.data)) as { type: string; error_code?: string }
          if (retryEvent.type === 'step_failed') resolve(retryEvent.error_code ?? '')
          if (retryEvent.type === 'action_completed') resolve(retryEvent.type)
        }
      }
    }
  }), { slowId: slowSession, fastId: fastSession })

  expect(result).toBe('INVALID_RETRY_STEP')
})
