import { expect, test } from '../fixtures/agent.fixture'

test.beforeEach(async ({ login }) => { await login() })

async function sendFromPanel(page: import('@playwright/test').Page, message: string) {
  await page.getByLabel('消息输入框').fill(message)
  await page.getByRole('button', { name: '发送消息' }).click()
}

test('renders a successful multi-step run in the collapsible panel', async ({ page, useAgentScenario }) => {
  await useAgentScenario('success')
  await page.goto('/tasks')
  await sendFromPanel(page, '创建高优先级任务')
  const timeline = page.getByRole('list', { name: 'Agent 执行步骤' })
  await expect(timeline).toContainText('理解请求')
  await expect(timeline).toContainText('调用 Todo API')
  await expect(timeline).toContainText('create_todo')
  await expect(timeline).toContainText('已完成')
  await expect(page.getByText('好的，已创建高优先级任务。')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '任务已完成' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看任务：完成前端原型' })).toBeVisible()
})

test('shows running and waiting time before a delayed tool completes', async ({ page, useAgentScenario }) => {
  await useAgentScenario('success', { timeScale: 0.25 })
  await page.goto('/tasks')
  await sendFromPanel(page, '创建延迟任务')
  const timeline = page.getByRole('list', { name: 'Agent 执行步骤' })
  await expect(timeline).toContainText('运行中')
  await expect(timeline.locator('time')).toBeVisible()
  await expect(timeline).toContainText('1.4 秒')
  await expect(page.getByText('好的，已创建高优先级任务。')).toBeVisible()
})

test('retries a retryable tool timeout from the panel and succeeds', async ({ page, useAgentScenario }) => {
  await useAgentScenario('readOnlyTimeout')
  await page.goto('/tasks')
  await sendFromPanel(page, '查询未完成任务')
  await expect(page.getByRole('alert').filter({ hasText: 'Todo API 查询超时' })).toBeVisible()
  await useAgentScenario('readOnlySuccess')
  await page.getByRole('button', { name: '重试查询 Todo 列表' }).click()
  await expect(page.getByText('已查询到 4 项任务。')).toBeVisible()
})

test('never offers replay for create or delete timeouts', async ({ page, useAgentScenario }) => {
  await useAgentScenario('timeout')
  await page.goto('/tasks')
  await sendFromPanel(page, '创建超时任务')
  await expect(page.getByRole('alert').filter({ hasText: 'Todo API 响应超时' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试调用 Todo API' })).toHaveCount(0)

  await useAgentScenario('deleteTimeout')
  await sendFromPanel(page, '删除超时任务')
  await expect(page.getByRole('alert').filter({ hasText: '删除 Todo 超时' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试删除待办' })).toHaveCount(0)
})

test('rejects and approves destructive Agent confirmations', async ({ page, useAgentScenario }) => {
  await useAgentScenario('confirmationRequired')
  await page.goto('/tasks')
  await sendFromPanel(page, '删除完成项目文档')
  await page.getByRole('button', { name: '取消删除待办' }).click()
  await expect(page.getByText('已取消删除操作。')).toBeVisible()
  await expect(page.getByRole('button', { name: '查看任务：完成项目文档' })).toBeVisible()

  await useAgentScenario('confirmationRequired')
  await sendFromPanel(page, '确认删除完成项目文档')
  await page.getByRole('button', { name: '确认删除待办' }).click()
  await expect(page.getByText('已删除待办「完成项目文档」。')).toBeVisible()
  await expect(page.getByRole('button', { name: '查看任务：完成项目文档' })).toHaveCount(0)
})

test('shares the same live session with the standalone Agent workspace', async ({ page, useAgentScenario }) => {
  await useAgentScenario('success')
  await page.goto('/assistant')
  await expect(page.getByRole('heading', { name: '智能助手', exact: true })).toBeVisible()
  await page.getByLabel('智能助手消息').fill('独立工作区任务')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('log')).toContainText('独立工作区任务')
  await expect(page.getByRole('log')).toContainText('好的，已创建高优先级任务。')
  await expect(page.getByLabel('执行详情').filter({ has: page.getByRole('list', { name: 'Agent 执行步骤' }) })).toBeVisible()
})

test('recovers a retryable failure from the standalone Agent workspace', async ({ page, useAgentScenario }) => {
  await useAgentScenario('readOnlyTimeout')
  await page.goto('/assistant')
  await page.getByLabel('智能助手消息').fill('独立页查询任务')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Todo API 查询超时' })).toBeVisible()
  await useAgentScenario('readOnlySuccess')
  await page.getByRole('button', { name: '重试查询 Todo 列表' }).click()
  await expect(page.getByRole('log')).toContainText('已查询到 4 项任务。')
  await expect(page.locator('#current > header').getByText('任务已完成', { exact: true })).toBeVisible()
})

test('shows waiting time and completion in the standalone Agent workspace', async ({ page, useAgentScenario }) => {
  await useAgentScenario('readOnlySuccess', { timeScale: 0.25 })
  await page.goto('/assistant')
  await page.getByLabel('智能助手消息').fill('查询近期任务')
  await page.getByRole('button', { name: '发送消息' }).click()
  const timeline = page.getByRole('list', { name: 'Agent 执行步骤' })
  await expect(timeline).toContainText('运行中')
  await expect(timeline.locator('time')).toBeVisible()
  await expect(timeline).toContainText('1.4 秒')
  await expect(page.getByRole('log')).toContainText('已查询到 4 项任务。')
})

test('confirms deletion in the standalone workspace and refreshes cached Todos', async ({ page, seedTodos, useAgentScenario }) => {
  await seedTodos()
  await page.goto('/tasks')
  await expect(page.getByRole('button', { name: '查看任务：完成项目文档' })).toBeVisible()
  await page.getByRole('link', { name: '智能助手' }).click()
  await useAgentScenario('confirmationRequired')
  await page.getByLabel('智能助手消息').fill('删除完成项目文档')
  await page.getByRole('button', { name: '发送消息' }).click()
  await page.getByRole('button', { name: '确认删除待办' }).click()
  await expect(page.getByRole('log')).toContainText('已删除待办「完成项目文档」。')
  await page.getByRole('link', { name: '我的任务' }).click()
  await expect(page.getByRole('button', { name: '查看任务：完成项目文档' })).toHaveCount(0)
})

test('reports and clears a disconnected panel session', async ({ page, useAgentScenario }) => {
  await useAgentScenario('disconnect')
  await page.goto('/tasks')
  await sendFromPanel(page, '侧栏触发断线')
  await expect(page.getByRole('alert').filter({ hasText: '连接异常 · 当前离线' })).toBeVisible()
  await expect(page.getByRole('log', { name: '对话消息' })).toContainText('侧栏触发断线')
  await page.getByRole('button', { name: '清空对话' }).click()
  await expect(page.getByRole('heading', { name: '今天要做什么？' })).toBeVisible()
  await expect(page.getByRole('log', { name: '对话消息' })).not.toContainText('侧栏触发断线')
})

test('reports a disconnected stream and clears retained history', async ({ page, useAgentScenario }) => {
  await useAgentScenario('disconnect')
  await page.goto('/assistant')
  await page.getByLabel('智能助手消息').fill('触发断线')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '连接异常 · 当前离线' })).toBeVisible()
  await expect(page.getByRole('log')).toContainText('触发断线')
  await page.getByRole('button', { name: '清空对话' }).click()
  await expect(page.getByRole('heading', { name: '从一句话开始' })).toBeVisible()
  await expect(page.getByRole('log')).not.toContainText('触发断线')
})
