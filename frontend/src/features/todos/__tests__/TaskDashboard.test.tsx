import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../../components/common/ToastRegion'
import { server } from '../../../mocks/server'
import { TaskDashboard } from '../TaskDashboard'
import { TaskCard } from '../TaskCard'
import { TaskDetailDialog } from '../TaskDetailDialog'
import { createTodo } from '../todo.api'
import type { Todo } from '../todo.types'

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <TaskDashboard />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const fixture: Todo = {
  id: 42,
  title: '测试卡片',
  description: '卡片描述',
  priority: 'medium',
  completed: false,
  due_date: '2026-07-20T09:00:00Z',
  created_at: '2026-07-10T08:00:00Z',
  updated_at: '2026-07-11T08:00:00Z',
}

describe('TaskDashboard', () => {
  it('renders the complete localized Chinese date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T08:00:00+08:00'))
    try {
      renderDashboard()
      expect(screen.getByText('2026 年 7 月 14 日 · 星期二')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders a dedicated loading state before data arrives', () => {
    renderDashboard()
    expect(screen.getByRole('status', { name: '正在加载任务' })).toBeVisible()
  })

  it('renders exact summary values after loading', async () => {
    renderDashboard()
    await screen.findByText('完成项目文档')
    const summary = screen.getByRole('region', { name: '任务摘要' })
    expect(within(summary).getByText('4')).toBeVisible()
    expect(within(summary).getByText('3')).toBeVisible()
    expect(within(summary).getByText('1')).toBeVisible()
  })

  it('renders a dedicated empty-list state', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ code: 0, message: 'ok', data: { items: [], total: 0, page: 1, page_size: 10 } })))
    renderDashboard()
    expect(await screen.findByRole('heading', { name: '还没有任务' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: '新建任务' })).toHaveLength(2)
  })

  it('renders a request-error state with a retry action', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ code: 50301, message: '任务服务繁忙', data: null }, { status: 503 })))
    renderDashboard()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('任务服务繁忙')
    expect(within(alert).getByRole('button', { name: '重新加载' })).toBeVisible()
  })

  it('filters the list by completed status', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('完成项目文档')
    await user.click(screen.getByRole('button', { name: '全部状态' }))
    await user.click(within(screen.getByRole('dialog', { name: '状态筛选' })).getByRole('button', { name: '已完成' }))
    expect(await screen.findByText('购买 groceries')).toBeVisible()
    await waitFor(() => expect(screen.queryByText('完成项目文档')).not.toBeInTheDocument())
  })

  it('filters the list by high priority', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('完成项目文档')
    await user.click(screen.getByRole('button', { name: '优先级' }))
    await user.click(within(screen.getByRole('dialog', { name: '优先级筛选' })).getByRole('button', { name: '高优先级' }))
    expect(await screen.findByText('完成项目文档')).toBeVisible()
    await waitFor(() => expect(screen.queryByText('健身 30 分钟')).not.toBeInTheDocument())
  })

  it('renders V6 summary, grouped tasks and Chinese controls', async () => {
    renderDashboard()

    expect(await screen.findByRole('heading', { name: '今天，保持专注' })).toBeVisible()
    expect(screen.getByText('全部任务')).toBeVisible()
    expect(screen.getByText('进行中')).toBeVisible()
    expect(screen.getByText('已完成')).toBeVisible()
    expect(screen.getByRole('button', { name: '新建任务' })).toBeVisible()
    expect(screen.getByRole('button', { name: '全部状态' })).toBeVisible()
    expect(screen.getByRole('button', { name: '优先级' })).toBeVisible()
    expect(await screen.findByRole('heading', { name: '即将到期' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '稍后处理' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeVisible()
  })

  it('creates a task and announces success', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('完成项目文档')

    await user.click(screen.getByRole('button', { name: '新建任务' }))
    await user.type(screen.getByLabelText('任务标题'), '周五前完成原型')
    await user.type(screen.getByLabelText('任务描述'), '交付完整交互')
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    expect(await screen.findByText('周五前完成原型')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('任务已创建')
  })

  it('keeps create values in the dialog when the API rejects the request', async () => {
    server.use(
      http.post('/api/todos', () =>
        HttpResponse.json({ code: 50011, message: '创建失败，请稍后重试', data: null }, { status: 500 }),
      ),
    )
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('完成项目文档')

    await user.click(screen.getByRole('button', { name: '新建任务' }))
    await user.type(screen.getByLabelText('任务标题'), '保留这个标题')
    await user.type(screen.getByLabelText('任务描述'), '保留这个描述')
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    expect(await screen.findByDisplayValue('保留这个标题')).toBeVisible()
    expect(screen.getByDisplayValue('保留这个描述')).toBeVisible()
    expect(within(screen.getByRole('dialog', { name: '新建任务' })).getByRole('alert')).toHaveTextContent('创建失败，请稍后重试')
  })

  it('opens read-only details before entering edit mode', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: '查看任务：完成项目文档' }))
    const detail = screen.getByRole('dialog', { name: '任务详情' })
    expect(within(detail).getByText('编写项目的 README 和 API 文档')).toBeVisible()
    expect(within(detail).queryByLabelText('任务标题')).not.toBeInTheDocument()

    await user.click(within(detail).getByRole('button', { name: '编辑任务' }))
    const edit = screen.getByRole('dialog', { name: '编辑任务' })
    expect(within(edit).getByLabelText('任务标题')).toHaveValue('完成项目文档')
  })

  it('keeps edited values in the dialog when update fails', async () => {
    server.use(
      http.put('/api/todos/:id', () =>
        HttpResponse.json({ code: 50012, message: '更新失败，请稍后重试', data: null }, { status: 500 }),
      ),
    )
    const user = userEvent.setup()
    renderDashboard()
    await user.click(await screen.findByRole('button', { name: '查看任务：完成项目文档' }))
    await user.click(screen.getByRole('button', { name: '编辑任务' }))
    const title = screen.getByLabelText('任务标题')
    await user.clear(title)
    await user.type(title, '不会丢失的修改')
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    expect(await screen.findByDisplayValue('不会丢失的修改')).toBeVisible()
    expect(within(screen.getByRole('dialog', { name: '编辑任务' })).getByRole('alert')).toHaveTextContent('更新失败，请稍后重试')
  })

  it('updates a task and announces success', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(await screen.findByRole('button', { name: '查看任务：完成项目文档' }))
    await user.click(screen.getByRole('button', { name: '编辑任务' }))
    const title = screen.getByLabelText('任务标题')
    await user.clear(title)
    await user.type(title, '完成新版项目文档')
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    expect(await screen.findByText('完成新版项目文档')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('任务已更新')
  })

  it('distinguishes filtered-empty state and can clear it', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('完成项目文档')
    await user.type(screen.getByRole('searchbox', { name: '搜索任务' }), '不存在的任务')

    expect(await screen.findByRole('heading', { name: '没有符合条件的任务' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(await screen.findByText('完成项目文档')).toBeVisible()
  })

  it('completes and restores a task optimistically', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByRole('button', { name: '查看任务：完成项目文档' })

    await user.click(screen.getByRole('button', { name: '完成任务：完成项目文档' }))
    expect(await screen.findByRole('button', { name: '取消完成：完成项目文档' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: '取消完成：完成项目文档' }))
    expect(await screen.findByRole('button', { name: '完成任务：完成项目文档' })).toBeVisible()
  })

  it('guards a task from concurrent completion toggles', async () => {
    let completeRequests = 0
    let resolveRequest!: () => void
    const pending = new Promise<void>((resolve) => { resolveRequest = resolve })
    server.use(http.patch('/api/todos/:id/complete', async () => {
      completeRequests += 1
      await pending
      return HttpResponse.json({ code: 0, message: 'ok', data: { ...fixture, id: 1, title: '完成项目文档', completed: true } })
    }))
    renderDashboard()
    const toggle = await screen.findByRole('button', { name: '完成任务：完成项目文档' })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    await waitFor(() => expect(completeRequests).toBe(1))
    const pendingToggle = screen.getByRole('button', { name: '取消完成：完成项目文档' })
    expect(pendingToggle).toBeDisabled()
    expect(pendingToggle).toHaveAttribute('aria-busy', 'true')
    resolveRequest()
  })

  it('rolls optimistic completion back when the request fails', async () => {
    server.use(
      http.patch('/api/todos/:id/complete', () =>
        HttpResponse.json({ code: 50001, message: '服务暂时不可用', data: null }, { status: 500 }),
      ),
    )
    const user = userEvent.setup()
    renderDashboard()
    await user.click(await screen.findByRole('button', { name: '完成任务：完成项目文档' }))

    expect(await screen.findByRole('button', { name: '完成任务：完成项目文档' })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('服务暂时不可用')
  })

  it('requires confirmation, supports cancellation, and only then deletes', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('健身 30 分钟')

    await user.click(screen.getByRole('button', { name: '删除任务：健身 30 分钟' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: '删除任务' })).toBeVisible())
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByText('健身 30 分钟')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '删除任务：健身 30 分钟' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByText('健身 30 分钟')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('任务已删除')
  })

  it('submits delete only once during rapid confirmation', async () => {
    let requests = 0
    server.use(http.delete('/api/todos/:id', () => { requests += 1; return new HttpResponse(null, { status: 204 }) }))
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('健身 30 分钟')
    await user.click(screen.getByRole('button', { name: '删除任务：健身 30 分钟' }))
    const confirm = screen.getByRole('button', { name: '确认删除' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(requests).toBe(1))
    expect(screen.queryByText('待办不存在')).not.toBeInTheDocument()
  })

  it('moves to the previous page after deleting the only item on the last page', async () => {
    for (let index = 0; index < 7; index += 1) await createTodo({ title: `分页任务 ${index}` })
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByRole('navigation', { name: '任务分页' })
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByText('第 2 / 2 页')).toBeVisible()
    const deleteButton = await screen.findByRole('button', { name: /^删除任务：/ })
    await user.click(deleteButton)
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByText('第 2 / 2 页')).not.toBeInTheDocument())
    expect(await screen.findByText('分页任务 0')).toBeVisible()
  })

  it('clears an existing deadline and keeps it cleared after reopening', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(await screen.findByRole('button', { name: '查看任务：完成项目文档' }))
    await user.click(screen.getByRole('button', { name: '编辑任务' }))
    expect(screen.getByLabelText('截止时间')).not.toHaveValue('')
    await user.clear(screen.getByLabelText('截止时间'))
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    await user.click(await screen.findByRole('button', { name: '查看任务：完成项目文档' }))
    expect(screen.getByText('未设置')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '编辑任务' }))
    expect(screen.getByLabelText('截止时间')).toHaveValue('')
  })

  it('keeps a task visible when delete fails', async () => {
    server.use(
      http.delete('/api/todos/:id', () =>
        HttpResponse.json({ code: 50002, message: '删除失败，请稍后重试', data: null }, { status: 500 }),
      ),
    )
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('健身 30 分钟')

    await user.click(screen.getByRole('button', { name: '删除任务：健身 30 分钟' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    expect(await screen.findByText('健身 30 分钟')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('删除失败，请稍后重试')
  })
})

describe('TaskCard', () => {
  function renderCard(overrides: Partial<Todo> = {}) {
    const handlers = { onOpen: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn() }
    const todo = { ...fixture, ...overrides }
    render(<TaskCard todo={todo} {...handlers} />)
    return { todo, ...handlers }
  }

  it.each([
    ['high', '高'],
    ['medium', '中'],
    ['low', '低'],
  ] as const)('renders an AA semantic %s-priority badge', (priority, label) => {
    renderCard({ priority })
    expect(screen.getByText(label)).toBeVisible()
  })

  it('shows title, description, and a localized due date', () => {
    renderCard()
    expect(screen.getByText('测试卡片')).toBeVisible()
    expect(screen.getByText(/卡片描述/)).toBeVisible()
    expect(screen.getByText(/7\/20/)).toBeVisible()
  })

  it('provides a stable no-deadline label', () => {
    renderCard({ due_date: null })
    expect(screen.getByText(/未设置截止时间/)).toBeVisible()
  })

  it.each([['Enter', '{Enter}'], ['Space', ' ']] as const)('opens details from the %s key using native button behavior', async (_label, key) => {
    const user = userEvent.setup()
    const { onOpen, todo } = renderCard()
    screen.getByRole('button', { name: '查看任务：测试卡片' }).focus()
    await user.keyboard(key)
    expect(onOpen).toHaveBeenCalledWith(todo)
  })

  it('opens details from a pointer click', async () => {
    const user = userEvent.setup()
    const { onOpen, todo } = renderCard()
    await user.click(screen.getByRole('button', { name: '查看任务：测试卡片' }))
    expect(onOpen).toHaveBeenCalledWith(todo)
  })

  it.each([
    [false, '完成任务：测试卡片'],
    [true, '取消完成：测试卡片'],
  ] as const)('toggles completion when completed=%s', async (completed, label) => {
    const user = userEvent.setup()
    const { onToggle, todo } = renderCard({ completed })
    await user.click(screen.getByRole('button', { name: label }))
    expect(onToggle).toHaveBeenCalledWith(todo)
  })

  it('does not open details while toggling completion', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderCard()
    await user.click(screen.getByRole('button', { name: '完成任务：测试卡片' }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('requests deletion without opening details', async () => {
    const user = userEvent.setup()
    const { onDelete, onOpen, todo } = renderCard()
    await user.click(screen.getByRole('button', { name: '删除任务：测试卡片' }))
    expect(onDelete).toHaveBeenCalledWith(todo)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('marks completed titles visually and exposes pressed state', () => {
    renderCard({ completed: true })
    expect(screen.getByText('测试卡片')).toHaveClass('line-through')
    expect(screen.getByRole('button', { name: '取消完成：测试卡片' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses an AA-sized completion target and high-contrast native focus', () => {
    renderCard()
    expect(screen.getByRole('button', { name: '完成任务：测试卡片' })).toHaveClass('h-8', 'w-8')
    expect(screen.getByRole('button', { name: '查看任务：测试卡片' })).toHaveClass('focus-visible:outline-2')
    expect(screen.getByText('测试卡片')).not.toHaveClass('opacity-55')
    expect(screen.getByRole('button', { name: '删除任务：测试卡片' })).not.toHaveClass('opacity-60')
  })
})

describe('TaskDetailDialog', () => {
  it('renders read-only task metadata', () => {
    render(<TaskDetailDialog open todo={fixture} onOpenChange={vi.fn()} onEdit={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: '任务详情' })
    expect(within(dialog).getByText('卡片描述')).toBeVisible()
    expect(within(dialog).getByText('中优先级')).toBeVisible()
    expect(within(dialog).getByText('进行中')).toBeVisible()
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows an explicit description fallback', () => {
    render(<TaskDetailDialog open todo={{ ...fixture, description: '' }} onOpenChange={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.getByText('暂无描述')).toBeVisible()
  })

  it('starts editing from its primary action', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<TaskDetailDialog open todo={fixture} onOpenChange={vi.fn()} onEdit={onEdit} />)
    await user.click(screen.getByRole('button', { name: '编辑任务' }))
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('closes from its accessible close button', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<TaskDetailDialog open todo={fixture} onOpenChange={onOpenChange} onEdit={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '关闭任务详情' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
