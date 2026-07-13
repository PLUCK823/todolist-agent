import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server'
import {
  ApiError,
  completeTodo,
  createTodo,
  deleteTodo,
  fetchTodo,
  fetchTodos,
  uncompleteTodo,
  updateTodo,
} from '../todo.api'
import { TaskDialog } from '../TaskDialog'

describe('TaskDialog', () => {
  it('keeps entered values and shows a Chinese API error when create fails', async () => {
    const user = userEvent.setup()
    render(
      <TaskDialog
        open
        mode="create"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn().mockRejectedValue(new ApiError(50001, '创建失败，请稍后重试', 500))}
      />,
    )

    await user.type(screen.getByLabelText('任务标题'), '失败时保留')
    await user.type(screen.getByLabelText('任务描述'), '不能丢失')
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    expect(await screen.findByDisplayValue('失败时保留')).toBeVisible()
    expect(screen.getByDisplayValue('不能丢失')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('创建失败，请稍后重试')
  })

  it('keeps edited values and stays open when update fails', async () => {
    const user = userEvent.setup()
    render(
      <TaskDialog
        open
        mode="edit"
        todo={{
          id: 1,
          title: '旧标题',
          description: '',
          priority: 'medium',
          completed: false,
          due_date: null,
          created_at: '2026-07-10T08:00:00Z',
          updated_at: '2026-07-10T08:00:00Z',
        }}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn().mockRejectedValue(new Error('offline'))}
      />,
    )

    const title = screen.getByLabelText('任务标题')
    await user.clear(title)
    await user.type(title, '新标题')
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    expect(await screen.findByDisplayValue('新标题')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('网络异常，请检查连接后重试')
  })

  it('validates a blank title without submitting', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TaskDialog open mode="create" onOpenChange={vi.fn()} onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: '创建任务' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入任务标题')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed values and defaults to medium priority', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<TaskDialog open mode="create" onOpenChange={vi.fn()} onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('任务标题'), '  清晰标题  ')
    await user.type(screen.getByLabelText('任务描述'), '  详细说明  ')
    await user.click(screen.getByRole('button', { name: '创建任务' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: '清晰标题', description: '详细说明', priority: 'medium' }))
  })

  it.each([
    ['high', '高'],
    ['medium', '中'],
    ['low', '低'],
  ] as const)('submits the %s priority selected from %s', async (value, label) => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<TaskDialog open mode="create" onOpenChange={vi.fn()} onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('任务标题'), `${label}优先任务`)
    await user.selectOptions(screen.getByLabelText('优先级'), value)
    await user.click(screen.getByRole('button', { name: '创建任务' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ priority: value }))
  })

  it('normalizes a selected deadline to an ISO timestamp', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<TaskDialog open mode="create" onOpenChange={vi.fn()} onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('任务标题'), '有截止时间')
    await user.type(screen.getByLabelText('截止时间'), '2026-07-18T09:30')
    await user.click(screen.getByRole('button', { name: '创建任务' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ due_date: expect.stringMatching(/^2026-07-18T/) }))
  })

  it('loads and saves an editable deadline in the app IANA timezone', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<TaskDialog open mode="edit" todo={{ id: 7, title: '完整任务', description: '完整描述', priority: 'high', completed: false, due_date: '2026-07-18T09:30:00Z', created_at: '2026-07-10T08:00:00Z', updated_at: '2026-07-10T08:00:00Z' }} onOpenChange={vi.fn()} onSubmit={onSubmit} />)
    expect(screen.getByLabelText('任务标题')).toHaveValue('完整任务')
    expect(screen.getByLabelText('任务描述')).toHaveValue('完整描述')
    expect(screen.getByLabelText('优先级')).toHaveValue('high')
    expect(screen.getByLabelText('截止时间')).toHaveValue('2026-07-18T17:30')
    await user.clear(screen.getByLabelText('截止时间'))
    await user.type(screen.getByLabelText('截止时间'), '2026-07-18T10:00')
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ due_date: '2026-07-18T02:00:00.000Z' }))
  })

  it('closes from cancel without submitting', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn()
    render(<TaskDialog open mode="create" onOpenChange={onOpenChange} onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('uses the stable fallback for an unknown rejected value', async () => {
    const user = userEvent.setup()
    render(<TaskDialog open mode="create" onOpenChange={vi.fn()} onSubmit={vi.fn().mockRejectedValue('unknown')} />)
    await user.type(screen.getByLabelText('任务标题'), '未知错误')
    await user.click(screen.getByRole('button', { name: '创建任务' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络异常，请检查连接后重试')
  })
})

describe('todo API contract', () => {
  it('preserves code, message, and status on ApiError', () => {
    const error = new ApiError(40001, '参数错误', 400)
    expect(error).toMatchObject({ name: 'ApiError', code: 40001, message: '参数错误', status: 400 })
  })
  it('lists paginated tasks', async () => {
    const result = await fetchTodos()
    expect(result).toMatchObject({ total: 4, page: 1, page_size: 20 })
    expect(result.items).toHaveLength(4)
  })

  it('searches titles case-insensitively after trimming and ignores descriptions', async () => {
    await createTodo({ title: 'Plan Launch', description: 'secret phrase' })
    const matched = await fetchTodos({ keyword: '  LAUNCH  ' })
    expect(matched.items).toHaveLength(1)
    expect(matched.items[0].title).toBe('Plan Launch')
    await expect(fetchTodos({ keyword: 'secret' })).resolves.toMatchObject({ total: 0, items: [] })
  })

  it.each([
    [{ completed: true }, (items: Awaited<ReturnType<typeof fetchTodos>>['items']) => items.every((item) => item.completed)],
    [{ priority: 'high' as const }, (items: Awaited<ReturnType<typeof fetchTodos>>['items']) => items.every((item) => item.priority === 'high')],
    [{ keyword: '文档' }, (items: Awaited<ReturnType<typeof fetchTodos>>['items']) => items.every((item) => item.title.includes('文档'))],
  ])('forwards supported filters %o', async (filters, assertItems) => {
    const result = await fetchTodos(filters)
    expect(assertItems(result.items)).toBe(true)
  })

  it.each([
    ['created_at', 'asc'],
    ['created_at', 'desc'],
    ['priority', 'asc'],
    ['priority', 'desc'],
    ['due_date', 'asc'],
    ['due_date', 'desc'],
  ] as const)('supports %s %s sorting', async (sort_by, order) => {
    const result = await fetchTodos({ sort_by, order })
    expect(result.items).toHaveLength(4)
  })

  it('paginates without changing total', async () => {
    const result = await fetchTodos({ page: 2, page_size: 2 })
    expect(result).toMatchObject({ page: 2, page_size: 2, total: 4 })
    expect(result.items).toHaveLength(2)
  })

  it('fetches a task by id', async () => {
    await expect(fetchTodo(1)).resolves.toMatchObject({ id: 1, title: '完成项目文档' })
  })

  it('normalizes a backend not-found response to ApiError', async () => {
    await expect(fetchTodo(999)).rejects.toMatchObject({ name: 'ApiError', code: 40401, status: 404, message: '待办不存在' })
  })

  it('creates a task with explicit fields', async () => {
    await expect(createTodo({ title: 'API 创建', priority: 'high', description: '说明' })).resolves.toMatchObject({ title: 'API 创建', priority: 'high', description: '说明', completed: false })
  })

  it('uses the backend medium-priority default on create', async () => {
    await expect(createTodo({ title: '默认值' })).resolves.toMatchObject({ priority: 'medium' })
  })

  it('normalizes create validation failures', async () => {
    await expect(createTodo({ title: ' ' })).rejects.toMatchObject({ code: 40001, status: 400 })
  })

  it('updates a task', async () => {
    await expect(updateTodo(1, { title: 'API 更新', priority: 'low' })).resolves.toMatchObject({ id: 1, title: 'API 更新', priority: 'low' })
  })

  it('normalizes update not-found failures', async () => {
    await expect(updateTodo(999, { title: '无效' })).rejects.toBeInstanceOf(ApiError)
  })

  it('accepts the backend DELETE 204 response', async () => {
    await expect(deleteTodo(1)).resolves.toBeUndefined()
  })

  it('normalizes delete not-found failures', async () => {
    await expect(deleteTodo(999)).rejects.toMatchObject({ code: 40401, status: 404 })
  })

  it('completes a task', async () => {
    await expect(completeTodo(1)).resolves.toMatchObject({ completed: true })
  })

  it('uncompletes a task', async () => {
    await expect(uncompleteTodo(2)).resolves.toMatchObject({ completed: false })
  })

  it('uses a stable response fallback for non-standard backend errors', async () => {
    server.use(http.get('/api/todos/:id', () => HttpResponse.json({ detail: 'broken' }, { status: 502 })))
    await expect(fetchTodo(1)).rejects.toMatchObject({ message: '服务响应异常，请稍后重试', status: 502 })
  })

  it('rejects todo timestamps that omit an RFC3339 offset', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        items: [{ id: 1, title: '坏时间', description: '', priority: 'medium', completed: false, due_date: '2026-07-14T09:00:00', created_at: '2026-07-10T08:00:00Z', updated_at: '2026-07-10T08:00:00Z' }],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })))
    await expect(fetchTodos()).rejects.toMatchObject({ name: 'ApiError', message: '服务响应异常，请稍后重试' })
  })

  it('uses a stable network fallback when no response exists', async () => {
    server.use(http.get('/api/todos/:id', () => HttpResponse.error()))
    await expect(fetchTodo(1)).rejects.toMatchObject({ message: '网络异常，请检查连接后重试', status: 0 })
  })
})
