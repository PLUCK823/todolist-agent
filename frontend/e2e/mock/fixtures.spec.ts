import { expect, test } from '../fixtures/agent.fixture'

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
  const secondPage = await context.newPage()
  await secondPage.goto('/tasks')
  await expect(secondPage.getByRole('heading', { name: '今天，保持专注' })).toBeVisible()
  await expect.poll(() => secondPage.evaluate(() => localStorage.getItem('todolist.auth.session'))).toBeNull()
  await secondPage.close()
})

test('Agent fixture streams a deterministic success sequence', async ({ page, useAgentScenario }) => {
  await useAgentScenario('success')
  await page.goto('/login')
  await page.getByRole('button', { name: '登录' }).waitFor()
  const eventTypes = await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const events: string[] = []
    const socket = new WebSocket('/api/agent/stream')
    socket.onerror = () => reject(new Error('mock socket failed'))
    socket.onopen = () => socket.send(JSON.stringify({ message: 'create a task', session_id: 'e2e' }))
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as { type: string }
      events.push(event.type)
      if (event.type === 'done') resolve(events)
    }
  }))
  expect(eventTypes).toEqual(['step_started', 'step_completed', 'step_started', 'action_completed', 'reply', 'done'])
})

test('Agent confirmation timing is relative to the confirmation event', async ({ page, useAgentScenario }) => {
  await useAgentScenario('confirmationRequired', { timeScale: 0.25 })
  await page.goto('/login')
  await page.getByRole('button', { name: '登录' }).waitFor()
  const actionDelay = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    let confirmedAt = 0
    const socket = new WebSocket('/api/agent/stream')
    socket.onerror = () => reject(new Error('mock socket failed'))
    socket.onopen = () => socket.send(JSON.stringify({ message: 'delete a task', session_id: 'e2e' }))
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
  }))
  expect(actionDelay).toBeGreaterThan(200)
  expect(actionDelay).toBeLessThan(600)
})
