import { expect, test } from '../fixtures/agent.fixture'
import { shouldInstallMockTransport } from '../fixtures/app.fixture'
import { postE2EControl } from '../fixtures/api.fixture'
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
  await login()
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
  await page.goto('/tasks')
  await expect(page.getByText('fixture seeded task')).toBeVisible()
})

test('API fixture fails only the next todo request', async ({ page, login, failNextTodoRequest }) => {
  await login()
  await failNextTodoRequest({ status: 503, message: 'fixture failure' })
  const statuses = await page.evaluate(async () => {
    const first = await fetch('/api/todos')
    const second = await fetch('/api/todos')
    return [first.status, second.status]
  })
  expect(statuses).toEqual([503, 200])
})

test('API fixture preserves a created todo for the following GET', async ({ page, login, seedTodos }) => {
  await login()
  await seedTodos([])
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
  await login()
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

test('Cookie is authoritative for every protected HTTP surface', async ({ page, context, login }) => {
  await login()
  await context.clearCookies({ name: 'todolist_mock_session' })

  const statuses = await page.evaluate(async () => Promise.all([
    fetch('/api/auth/me').then((response) => response.status),
    fetch('/api/todos').then((response) => response.status),
    fetch('/api/agent/sessions').then((response) => response.status),
  ]))

  expect(statuses).toEqual([401, 401, 401])
})

test('an unknown Cookie identity cannot authorize protected APIs', async ({ page, context, login }) => {
  await login()
  await context.clearCookies({ name: 'todolist_mock_session' })
  await context.addCookies([{
    name: 'todolist_mock_session', value: 'unknown@example.com', domain: '127.0.0.1', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }])

  const status = await page.evaluate(() => fetch('/api/todos').then((response) => response.status))
  expect(status).toBe(401)
})

test('clearing the Cookie rejects a new Agent socket', async ({ page, context, login }) => {
  await login()
  const sessionId = await createOwnedSession(page, '即将失效的会话')
  await context.clearCookies({ name: 'todolist_mock_session' })

  const result = await page.evaluate((ownedSession) => new Promise<{ closeCode?: number; eventType?: string }>((resolve) => {
    const socket = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(ownedSession)}`)
    socket.onopen = () => socket.send(JSON.stringify({ message: '不应执行', session_id: ownedSession }))
    socket.onmessage = (message) => resolve({ eventType: (JSON.parse(String(message.data)) as { type: string }).type })
    socket.onclose = (event) => resolve({ closeCode: event.code })
  }), sessionId)

  expect(result).toEqual({ closeCode: 1008 })
})

test('clearing the Cookie invalidates an already connected Agent socket before its first frame', async ({ page, context, login }) => {
  await login()
  const sessionId = await createOwnedSession(page, '连接后失效的会话')
  await page.evaluate((ownedSession) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(ownedSession)}`)
    ;(window as typeof window & { __e2eSocket?: WebSocket }).__e2eSocket = socket
    socket.onerror = () => reject(new Error('mock socket failed before opening'))
    socket.onopen = () => resolve()
  }), sessionId)
  await context.clearCookies({ name: 'todolist_mock_session' })

  const closeCode = await page.evaluate((ownedSession) => new Promise<number>((resolve, reject) => {
    const socket = (window as typeof window & { __e2eSocket?: WebSocket }).__e2eSocket
    if (!socket) { reject(new Error('expected connected mock socket')); return }
    socket.onclose = (event) => resolve(event.code)
    socket.send(JSON.stringify({ message: 'Cookie 已失效', session_id: ownedSession }))
  }), sessionId)
  expect(closeCode).toBe(1008)
})

test('a page on another origin cannot initiate the mocked Agent socket', async ({ page, login }) => {
  await login()
  const sessionId = await createOwnedSession(page, '同源限定会话')
  await page.goto('http://localhost:3000/login')

  const result = await page.evaluate((ownedSession) => new Promise<{ closeCode?: number; eventType?: string }>((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:3000/api/agent/stream?session_id=${encodeURIComponent(ownedSession)}`)
    socket.onopen = () => socket.send(JSON.stringify({ message: '跨源请求', session_id: ownedSession }))
    socket.onmessage = (message) => resolve({ eventType: (JSON.parse(String(message.data)) as { type: string }).type })
    socket.onclose = (event) => resolve({ closeCode: event.code })
  }), sessionId)

  expect(result).toEqual({ closeCode: 1008 })
})

test('Todo data and mutations are isolated by Cookie owner', async ({ page, login }) => {
  await login()
  await postE2EControl(page, '/api/__e2e__/todos/seed', { todos: [{
    id: 91, title: 'Alice 私有任务', description: '', priority: 'high', completed: false,
    due_date: null, created_at: '2026-07-13T02:00:00Z', updated_at: '2026-07-13T02:00:00Z',
  }] })

  await login({ account: {
    id: 'bob', name: 'Bob', email: 'bob@example.com', timezone: 'Asia/Shanghai (UTC+8)',
    avatar: { kind: 'preset', value: 'amber' }, taskCount: 0, agentSessionCount: 0,
  } })
  await postE2EControl(page, '/api/__e2e__/todos/seed', { todos: [] })
  const bob = await page.evaluate(async () => {
    const list = await fetch('/api/todos').then((response) => response.json()) as { data: { items: Array<{ title: string }> } }
    const mutation = await fetch('/api/todos/91', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Bob 越权修改' }),
    })
    return { titles: list.data.items.map((todo) => todo.title), mutationStatus: mutation.status }
  })

  await login()
  const aliceTitles = await page.evaluate(async () => {
    const payload = await fetch('/api/todos').then((response) => response.json()) as { data: { items: Array<{ title: string }> } }
    return payload.data.items.map((todo) => todo.title)
  })
  expect(bob).toEqual({ titles: [], mutationStatus: 404 })
  expect(aliceTitles).toEqual(['Alice 私有任务'])
})

test('anonymous Todo controls cannot inject fixture state', async ({ page }) => {
  await page.goto('/login')
  const status = await page.evaluate(() => fetch('/api/__e2e__/todos/seed', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ todos: [] }),
  }).then((response) => response.status))
  expect(status).toBe(401)
})

test('Agent create and delete actions mutate only the stored turn owner', async ({ page, login, useAgentScenario }) => {
  const runAgent = async (sessionId: string, message: string, approve = false) => page.evaluate(({ ownedSession, prompt, shouldApprove }) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`/api/agent/stream?session_id=${encodeURIComponent(ownedSession)}`)
    socket.onerror = () => reject(new Error('mock socket failed'))
    socket.onopen = () => socket.send(JSON.stringify({ message: prompt, session_id: ownedSession }))
    socket.onmessage = (raw) => {
      const event = JSON.parse(String(raw.data)) as { type: string; confirmation_id?: string }
      if (event.type === 'confirmation_required' && shouldApprove) socket.send(JSON.stringify({
        type: 'confirmation_response', confirmation_id: event.confirmation_id, approved: true,
      }))
      if (event.type === 'done') resolve()
    }
  }), { ownedSession: sessionId, prompt: message, shouldApprove: approve })

  await login()
  await postE2EControl(page, '/api/__e2e__/todos/seed', { todos: [] })
  await useAgentScenario('success')
  await runAgent(await createOwnedSession(page, 'Alice 创建'), '创建 Alice 任务')

  await login({ account: {
    id: 'bob', name: 'Bob', email: 'bob@example.com', timezone: 'Asia/Shanghai (UTC+8)',
    avatar: { kind: 'preset', value: 'amber' }, taskCount: 0, agentSessionCount: 0,
  } })
  await postE2EControl(page, '/api/__e2e__/todos/seed', { todos: [{
    id: 1, title: 'Bob 私有任务', description: '', priority: 'medium', completed: false,
    due_date: null, created_at: '2026-07-13T02:00:00Z', updated_at: '2026-07-13T02:00:00Z',
  }] })

  await login()
  let aliceTitles = await page.evaluate(async () => {
    const payload = await fetch('/api/todos').then((response) => response.json()) as { data: { items: Array<{ title: string }> } }
    return payload.data.items.map((todo) => todo.title)
  })
  expect(aliceTitles).toEqual(['完成前端原型'])

  await postE2EControl(page, '/api/__e2e__/todos/seed', { todos: [{
    id: 1, title: 'Alice 待删除', description: '', priority: 'medium', completed: false,
    due_date: null, created_at: '2026-07-13T02:00:00Z', updated_at: '2026-07-13T02:00:00Z',
  }] })
  await useAgentScenario('confirmationRequired')
  await runAgent(await createOwnedSession(page, 'Alice 删除'), '删除 Alice 任务', true)
  aliceTitles = await page.evaluate(async () => {
    const payload = await fetch('/api/todos').then((response) => response.json()) as { data: { items: Array<{ title: string }> } }
    return payload.data.items.map((todo) => todo.title)
  })
  expect(aliceTitles).toEqual([])

  await login({ account: {
    id: 'bob', name: 'Bob', email: 'bob@example.com', timezone: 'Asia/Shanghai (UTC+8)',
    avatar: { kind: 'preset', value: 'amber' }, taskCount: 0, agentSessionCount: 0,
  } })
  const bobTitles = await page.evaluate(async () => {
    const payload = await fetch('/api/todos').then((response) => response.json()) as { data: { items: Array<{ title: string }> } }
    return payload.data.items.map((todo) => todo.title)
  })
  expect(bobTitles).toEqual(['Bob 私有任务'])
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
