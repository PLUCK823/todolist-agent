import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server'
import { renderWithProviders } from '../../test/render'
import UpcomingPage from '../UpcomingPage'
import type { Todo } from '../../features/todos/todo.types'

const fixture = (overrides: Partial<Todo>): Todo => ({
  id: 20,
  title: '上午产品评审',
  description: '确认近期安排体验',
  priority: 'high',
  completed: false,
  due_date: '2026-07-14T02:00:00Z',
  created_at: '2026-07-10T08:00:00Z',
  updated_at: '2026-07-10T08:00:00Z',
  ...overrides,
})

function list(items: Todo[]) {
  return { code: 0, message: 'ok', data: { items, total: items.length, page: 1, page_size: 100 } }
}

describe('UpcomingPage', () => {
  it('queries a stable bounded schedule and renders the V6 heading', async () => {
    let requestUrl = ''
    server.use(http.get('/api/todos', ({ request }) => {
      requestUrl = request.url
      return HttpResponse.json(list([]))
    }))

    renderWithProviders(<UpcomingPage now={new Date('2026-07-14T08:00:00+08:00')} />)

    expect(screen.getByRole('status', { name: '正在加载近期安排' })).toBeVisible()
    expect(await screen.findByRole('heading', { name: '近期安排' })).toBeVisible()
    await waitFor(() => expect(requestUrl).toContain('page_size=100'))
    expect(requestUrl).toContain('sort_by=due_date')
    expect(requestUrl).toContain('order=asc')
  })

  it('hides completed items by default and reveals them with the labelled switch', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json(list([
      fixture({ id: 20, title: '进行中的安排' }),
      fixture({ id: 21, title: '完成的安排', completed: true }),
    ]))))
    const user = userEvent.setup()
    renderWithProviders(<UpcomingPage now={new Date('2026-07-14T08:00:00+08:00')} />)

    expect(await screen.findByText('进行中的安排')).toBeVisible()
    expect(screen.queryByText('完成的安排')).not.toBeInTheDocument()
    const completedSwitch = screen.getByRole('checkbox', { name: '显示已完成' })
    expect(completedSwitch).not.toBeChecked()

    await user.click(completedSwitch)
    expect(screen.getByText('完成的安排')).toBeVisible()
  })

  it('opens task details and completes an event with per-id concurrency protection', async () => {
    let completeRequests = 0
    let resolveRequest!: () => void
    const pending = new Promise<void>((resolve) => { resolveRequest = resolve })
    server.use(
      http.get('/api/todos', () => HttpResponse.json(list([fixture({})]))),
      http.patch('/api/todos/:id/complete', async () => {
        completeRequests += 1
        await pending
        return HttpResponse.json({ code: 0, message: 'ok', data: fixture({ completed: true }) })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<UpcomingPage now={new Date('2026-07-14T08:00:00+08:00')} />)

    await user.click(await screen.findByRole('button', { name: '查看安排：上午产品评审' }))
    expect(within(screen.getByRole('dialog', { name: '任务详情' })).getByText('确认近期安排体验')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '关闭任务详情' }))
    await user.click(screen.getByRole('checkbox', { name: '显示已完成' }))

    const toggle = screen.getByRole('button', { name: '完成安排：上午产品评审' })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    await waitFor(() => expect(completeRequests).toBe(1))
    expect(screen.getByRole('button', { name: '取消完成：上午产品评审' })).toBeDisabled()
    resolveRequest()
  })

  it('prefills the selected local day when adding an event and announces creation', async () => {
    const scheduled: Todo[] = []
    let postedDueDate = ''
    server.use(
      http.get('/api/todos', () => HttpResponse.json(list(scheduled))),
      http.post('/api/todos', async ({ request }) => {
        const body = await request.json() as { title: string; due_date: string }
        postedDueDate = body.due_date
        const created = fixture({ id: 90, title: body.title, due_date: body.due_date })
        scheduled.push(created)
        return HttpResponse.json({ code: 0, message: 'ok', data: created }, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<UpcomingPage now={new Date('2026-07-13T08:00:00+08:00')} />)

    await screen.findByText('当天暂无安排')
    await user.click(screen.getByRole('button', { name: /2026 年 7 月 14 日/ }))
    await user.click(screen.getByRole('button', { name: '添加安排' }))

    expect(screen.getByLabelText('截止时间')).toHaveValue('2026-07-14T09:00')
    await user.type(screen.getByLabelText('任务标题'), '新增日程')
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('安排已创建')
    expect(await screen.findByText('新增日程')).toBeVisible()
    expect(postedDueDate).toBe('2026-07-14T01:00:00.000Z')
  })

  it('keeps entered create values when the API rejects the request', async () => {
    server.use(
      http.get('/api/todos', () => HttpResponse.json(list([]))),
      http.post('/api/todos', () => HttpResponse.json({ code: 50031, message: '安排创建失败', data: null }, { status: 500 })),
    )
    const user = userEvent.setup()
    renderWithProviders(<UpcomingPage now={new Date('2026-07-14T08:00:00+08:00')} />)

    await screen.findByText('当天暂无安排')
    await user.click(screen.getByRole('button', { name: '添加安排' }))
    await user.type(screen.getByLabelText('任务标题'), '请保留这项安排')
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    expect(await screen.findByDisplayValue('请保留这项安排')).toBeVisible()
    expect(within(screen.getByRole('dialog', { name: '新建任务' })).getByRole('alert')).toHaveTextContent('安排创建失败')
  })

  it('renders a recoverable request error', async () => {
    server.use(http.get('/api/todos', () => HttpResponse.json({ code: 50331, message: '安排服务繁忙', data: null }, { status: 503 })))
    renderWithProviders(<UpcomingPage now={new Date('2026-07-14T08:00:00+08:00')} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('安排服务繁忙')
    expect(within(alert).getByRole('button', { name: '重新加载' })).toBeVisible()
  })
})
