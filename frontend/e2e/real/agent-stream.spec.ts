import { expect, test } from '../fixtures/app.fixture'

test.beforeEach(async ({ login }) => { await login() })

test('@real streams a deterministic Agent tool call and persists its Todo', async ({ page, request }) => {
  const receivedTypes: string[] = []
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      try {
        const event = JSON.parse(String(payload)) as { type?: string }
        if (event.type) receivedTypes.push(event.type)
      } catch {
        // Binary/non-JSON frames are not Agent protocol events.
      }
    })
  })

  await page.goto('/assistant')
  await page.getByLabel('智能助手消息').fill('创建高优先级任务：真实联调任务')
  await page.getByRole('button', { name: '发送消息' }).click()

  await expect(page.getByRole('log')).toContainText('已创建高优先级任务「真实联调任务」。')
  await expect.poll(() => receivedTypes).toEqual(expect.arrayContaining([
    'step_started', 'action_completed', 'reply', 'done',
  ]))

  const response = await request.get('/api/todos', { params: { keyword: '真实联调任务' } })
  expect(response.ok()).toBeTruthy()
  const body = await response.json() as { data: { items: Array<{ id: number, title: string, priority: string }> } }
  const created = body.data.items.find((todo) => todo.title === '真实联调任务')
  expect(created).toMatchObject({ title: '真实联调任务', priority: 'high' })

  if (created) {
    const cleanup = await request.delete(`/api/todos/${created.id}`)
    expect(cleanup.ok()).toBeTruthy()
  }
})
