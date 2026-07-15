import type { Todo } from '../../src/features/todos/todo.types'
import { expect, test } from '../fixtures/agent.fixture'

function scheduled(id: number, title: string, dueDate: string, completed = false): Todo {
  return {
    id,
    title,
    description: `安排：${title}`,
    priority: 'medium',
    completed,
    due_date: dueDate,
    created_at: '2026-07-12T02:00:00Z',
    updated_at: '2026-07-12T02:00:00Z',
  }
}

test.beforeEach(async ({ login }) => { await login() })

test('switches dates and renders an explicit empty-day state', async ({ page, seedTodos }) => {
  await seedTodos([scheduled(1, '周二安排', '2026-07-14T01:00:00Z')])
  await page.goto('/upcoming')
  await expect(page.getByText('当天暂无安排')).toBeVisible()
  await page.getByRole('button', { name: /7 月 14 日 周二$/ }).click()
  await expect(page.getByRole('heading', { name: '7 月 14 日' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看安排：周二安排' })).toBeVisible()
})

test('shows completed schedules only when requested', async ({ page, seedTodos }) => {
  await seedTodos([
    scheduled(1, '进行中的安排', '2026-07-13T02:00:00Z'),
    scheduled(2, '已完成的安排', '2026-07-13T03:00:00Z', true),
  ])
  await page.goto('/upcoming')
  await expect(page.getByRole('button', { name: '查看安排：进行中的安排' })).toBeVisible()
  await expect(page.getByText('已完成的安排')).toHaveCount(0)
  await page.getByLabel('显示已完成').check()
  await expect(page.getByRole('button', { name: '查看安排：已完成的安排' })).toBeVisible()
})

test('adds an arrangement, opens its details and completes it', async ({ page, seedTodos }) => {
  await seedTodos([])
  await page.goto('/upcoming')
  await page.getByRole('button', { name: '添加安排' }).click()
  const dialog = page.getByRole('dialog', { name: '新建任务' })
  await dialog.getByLabel('任务标题').fill('上午评审')
  await expect(dialog.getByLabel('截止时间')).toHaveValue('2026-07-13T09:00')
  await dialog.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByRole('button', { name: '查看安排：上午评审' })).toBeVisible()
  await page.getByRole('button', { name: '查看安排：上午评审' }).click()
  await expect(page.getByRole('dialog', { name: '任务详情' })).toContainText('上午评审')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '完成安排：上午评审' }).click()
  await expect(page.getByText('上午评审')).toHaveCount(0)
  await page.getByLabel('显示已完成').check()
  await expect(page.getByRole('button', { name: '取消完成：上午评审' })).toBeVisible()
})
