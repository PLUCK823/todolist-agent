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
