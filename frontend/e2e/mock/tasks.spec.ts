import type { Todo } from '../../src/features/todos/todo.types'
import { expect, test } from '../fixtures/agent.fixture'

function todo(id: number, title: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    title,
    description: `描述 ${title}`,
    priority: 'medium',
    completed: false,
    due_date: null,
    created_at: `2026-07-${String(Math.min(13, id + 1)).padStart(2, '0')}T02:00:00Z`,
    updated_at: '2026-07-13T02:00:00Z',
    ...overrides,
  }
}

test.beforeEach(async ({ login }) => { await login() })

test('creates, edits, completes, reopens and deletes a task', async ({ page, seedTodos }) => {
  await seedTodos([])
  await page.goto('/tasks')
  await page.locator('header').getByRole('button', { name: '新建任务' }).click()
  await page.getByLabel('任务标题').fill('端到端任务')
  await page.getByLabel('任务描述').fill('完整生命周期')
  await page.getByRole('dialog', { name: '新建任务' }).getByLabel('优先级').selectOption('high')
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByRole('button', { name: '查看任务：端到端任务' })).toBeVisible()

  await page.getByRole('button', { name: '查看任务：端到端任务' }).click()
  await page.getByRole('button', { name: '编辑任务' }).click()
  await page.getByLabel('任务标题').fill('端到端任务（已编辑）')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByRole('button', { name: '查看任务：端到端任务（已编辑）' })).toBeVisible()

  await page.getByRole('button', { name: '完成任务：端到端任务（已编辑）' }).click()
  await expect(page.getByRole('button', { name: '取消完成：端到端任务（已编辑）' })).toBeVisible()
  await page.getByRole('button', { name: '取消完成：端到端任务（已编辑）' }).click()
  await expect(page.getByRole('button', { name: '完成任务：端到端任务（已编辑）' })).toBeVisible()

  await page.getByRole('button', { name: '删除任务：端到端任务（已编辑）' }).click()
  await page.getByRole('dialog', { name: '删除任务' }).getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByText('端到端任务（已编辑）')).toHaveCount(0)
})

test('debounces search and clears a no-results state', async ({ page, seedTodos }) => {
  await seedTodos([todo(1, 'Alpha 计划'), todo(2, 'Beta 复盘')])
  await page.goto('/tasks')
  const search = page.getByLabel('搜索任务')
  await expect(page.getByRole('button', { name: '查看任务：Alpha 计划' })).toBeVisible()
  const keywordRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/todos' && url.searchParams.has('keyword')) {
      keywordRequests.push(url.searchParams.get('keyword') ?? '')
    }
  })
  await search.fill('B')
  await search.fill('Be')
  await search.fill('Beta')
  await page.waitForTimeout(200)
  expect(keywordRequests).toEqual([])
  await expect.poll(() => keywordRequests).toEqual(['Beta'])
  await expect(page.getByRole('button', { name: '查看任务：Beta 复盘' })).toBeVisible()
  await expect(page.getByText('Alpha 计划')).toHaveCount(0)
  await search.fill('不存在')
  await expect(page.getByRole('heading', { name: '没有符合条件的任务' })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(page.getByRole('button', { name: '查看任务：Alpha 计划' })).toBeVisible()
})

test('filters by status and priority and sorts by due date', async ({ page, seedTodos }) => {
  await seedTodos([
    todo(1, '已完成高优先', { completed: true, priority: 'high', due_date: '2026-07-16T02:00:00Z' }),
    todo(2, '进行中低优先', { priority: 'low', due_date: '2026-07-14T02:00:00Z' }),
    todo(3, '进行中高优先', { priority: 'high', due_date: '2026-07-15T02:00:00Z' }),
  ])
  await page.goto('/tasks')
  await page.getByRole('button', { name: '全部状态' }).click()
  await page.getByRole('dialog', { name: '状态筛选' }).getByRole('button', { name: '进行中' }).click()
  await expect(page.getByText('已完成高优先')).toHaveCount(0)
  await page.getByRole('button', { name: '优先级' }).click()
  await page.getByRole('dialog', { name: '优先级筛选' }).getByRole('button', { name: '高优先级' }).click()
  await expect(page.getByRole('button', { name: '查看任务：进行中高优先' })).toBeVisible()
  await expect(page.getByText('进行中低优先')).toHaveCount(0)

  await page.getByRole('button', { name: '高优先级' }).click()
  await page.getByRole('dialog', { name: '优先级筛选' }).getByRole('button', { name: '全部优先级' }).click()
  await page.getByLabel('任务排序').selectOption('due_date:asc')
  const taskButtons = page.getByRole('button', { name: /^查看任务：/ })
  await expect(taskButtons.first()).toHaveAccessibleName('查看任务：进行中低优先')
})

test('paginates deterministic results without leaking page state', async ({ page, seedTodos }) => {
  await seedTodos(Array.from({ length: 11 }, (_, index) => todo(index + 1, `分页任务 ${index + 1}`)))
  await page.goto('/tasks')
  await expect(page.getByText('第 1 / 2 页')).toBeVisible()
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByText('第 2 / 2 页')).toBeVisible()
  await expect(page.getByRole('button', { name: /^查看任务：/ })).toHaveCount(1)
  await page.getByRole('button', { name: '上一页' }).click()
  await expect(page.getByText('第 1 / 2 页')).toBeVisible()
})

test('shows a loading skeleton until a delayed list request resolves', async ({ page, seedTodos, delayNextTodoRequest }) => {
  await seedTodos([todo(1, '延迟任务')])
  await delayNextTodoRequest({ method: 'GET', query: 'page_size=10', times: 2, delayMs: 2_000 })
  const navigation = page.goto('/tasks')
  await expect(page.getByRole('status', { name: '正在加载任务' })).toBeVisible()
  await navigation
  await expect(page.getByRole('button', { name: '查看任务：延迟任务' })).toBeVisible()
})

test('distinguishes an empty list from a filtered no-results state', async ({ page, seedTodos }) => {
  await seedTodos([])
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: '还没有任务' })).toBeVisible()
  await seedTodos([todo(1, '唯一任务')])
  await page.reload()
  await page.getByLabel('搜索任务').fill('无匹配')
  await expect(page.getByRole('heading', { name: '没有符合条件的任务' })).toBeVisible()
})

test('recovers from a one-shot 500 response with an explicit retry', async ({ page, failNextTodoRequest }) => {
  await failNextTodoRequest({ method: 'GET', query: 'page_size=10', times: 4, status: 500, message: '服务暂时不可用' })
  await page.goto('/tasks')
  const alert = page.getByRole('alert').filter({ hasText: '暂时无法加载任务' })
  await expect(alert).toContainText('服务暂时不可用')
  await alert.getByRole('button', { name: '重新加载' }).click()
  await expect(page.getByRole('heading', { name: '今天，保持专注' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看任务：完成项目文档' })).toBeVisible()
})

test('preserves form values after a failed create submission', async ({ page, seedTodos, failNextTodoRequest }) => {
  await seedTodos([])
  await page.goto('/tasks')
  await page.locator('header').getByRole('button', { name: '新建任务' }).click()
  await page.getByLabel('任务标题').fill('失败后保留')
  await page.getByLabel('任务描述').fill('仍然存在')
  await failNextTodoRequest({ method: 'POST', status: 500, message: '创建失败，请重试' })
  await page.getByRole('button', { name: '创建任务' }).click()
  const dialog = page.getByRole('dialog', { name: '新建任务' })
  await expect(dialog.getByRole('alert')).toContainText('创建失败，请重试')
  await expect(dialog.getByLabel('任务标题')).toHaveValue('失败后保留')
  await expect(dialog.getByLabel('任务描述')).toHaveValue('仍然存在')
})
