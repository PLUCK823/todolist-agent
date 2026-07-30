import type { Todo } from '../../src/features/todos/todo.types'
import { expect, test } from '../fixtures/agent.fixture'

function todo(id: number): Todo {
  return { id, title: `批量任务 ${id}`, description: '', priority: 'low', completed: false, due_date: null, created_at: `2026-07-${String(Math.min(id, 28)).padStart(2, '0')}T00:00:00Z`, updated_at: '2026-07-30T00:00:00Z' }
}

test.beforeEach(async ({ login }) => { await login() })

test('selects across pages and uses one request per batch operation', async ({ page, seedTodos }) => {
  await seedTodos(Array.from({ length: 12 }, (_, index) => todo(index + 1)))
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/todos/batch')) requests.push(`${request.method()} ${new URL(request.url()).pathname}`)
  })
  await page.goto('/tasks')
  await page.getByRole('button', { name: '选择任务' }).click()
  await page.getByRole('checkbox', { name: '选择当前页' }).check()
  await page.getByRole('button', { name: '下一页' }).click()
  await page.getByRole('checkbox', { name: '选择当前页' }).check()
  await expect(page.getByRole('toolbar', { name: '批量操作' })).toContainText('已选择 12 项')
  await page.getByRole('button', { name: '批量编辑' }).click()
  const edit = page.getByRole('dialog', { name: '批量编辑任务' })
  await edit.getByRole('checkbox', { name: '修改优先级' }).check()
  await edit.getByLabel('批量优先级').selectOption('high')
  await edit.getByRole('button', { name: '应用修改' }).click()
  await expect(edit).toBeHidden()

  await page.getByRole('button', { name: '选择任务' }).click()
  await page.getByRole('checkbox', { name: '选择当前页' }).check()
  await page.getByRole('button', { name: '批量完成' }).click()
  await expect(page.getByRole('toolbar', { name: '批量操作' })).toBeHidden()
  await page.getByRole('button', { name: '选择任务' }).click()
  await page.getByRole('checkbox', { name: '选择当前页' }).check()
  await page.getByRole('button', { name: '批量恢复' }).click()
  await page.getByRole('button', { name: '选择任务' }).click()
  await page.getByRole('checkbox', { name: '选择当前页' }).check()
  await page.getByRole('button', { name: '批量删除' }).click()
  const confirm = page.getByRole('dialog', { name: '批量删除任务' })
  await expect(confirm).toContainText('2 项')
  await confirm.getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByText('第 2 / 2 页')).toHaveCount(0)

  expect(requests).toEqual([
    'PUT /api/todos/batch',
    'PATCH /api/todos/batch/status',
    'PATCH /api/todos/batch/status',
    'DELETE /api/todos/batch',
  ])
})
