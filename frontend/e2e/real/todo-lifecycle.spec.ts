import type { APIRequestContext } from '@playwright/test'
import { expect, test } from '../fixtures/app.fixture'

interface TodoRecord {
  id: number
  title: string
  completed: boolean
  priority: 'high' | 'medium' | 'low'
}

async function findTodo(request: APIRequestContext, title: string): Promise<TodoRecord | undefined> {
  const response = await request.get('/api/todos', { params: { keyword: title, page_size: 100 } })
  expect(response.ok()).toBeTruthy()
  const body = await response.json() as { data: { items: TodoRecord[] } }
  return body.data.items.find((todo) => todo.title === title)
}

test.beforeEach(async ({ login }) => { await login() })

test('@real creates, searches, edits, completes, reopens and deletes through the real stack', async ({ page, request }) => {
  const originalTitle = '真实 Todo 生命周期'
  const editedTitle = '真实 Todo 生命周期（已编辑）'

  await page.goto('/tasks')
  await page.locator('header').getByRole('button', { name: '新建任务' }).click()
  await page.getByLabel('任务标题').fill(originalTitle)
  await page.getByLabel('任务描述').fill('Playwright → nginx → Go → PostgreSQL')
  await page.getByRole('dialog', { name: '新建任务' }).getByLabel('优先级').selectOption('high')
  await page.getByRole('button', { name: '创建任务' }).click()

  const created = await expect.poll(() => findTodo(request, originalTitle)).not.toBeUndefined()
  void created
  await page.getByLabel('搜索任务').fill(originalTitle)
  await expect(page.getByRole('button', { name: `查看任务：${originalTitle}` })).toBeVisible()

  await page.getByRole('button', { name: `查看任务：${originalTitle}` }).click()
  await page.getByRole('button', { name: '编辑任务' }).click()
  await page.getByLabel('任务标题').fill(editedTitle)
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect.poll(() => findTodo(request, editedTitle)).toMatchObject({ title: editedTitle, priority: 'high' })

  await page.getByRole('button', { name: `完成任务：${editedTitle}` }).click()
  await expect.poll(() => findTodo(request, editedTitle)).toMatchObject({ completed: true })
  await page.getByRole('button', { name: `取消完成：${editedTitle}` }).click()
  await expect.poll(() => findTodo(request, editedTitle)).toMatchObject({ completed: false })

  await page.getByRole('button', { name: `删除任务：${editedTitle}` }).click()
  await page.getByRole('dialog', { name: '删除任务' }).getByRole('button', { name: '确认删除' }).click()
  await expect.poll(() => findTodo(request, editedTitle)).toBeUndefined()
})
