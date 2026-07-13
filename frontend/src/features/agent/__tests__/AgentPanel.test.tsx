import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../../components/common/ToastRegion'
import AppShell from '../../shell/AppShell'
import { ShellProvider } from '../../shell/ShellContext'
import { TaskDashboard } from '../../todos/TaskDashboard'
import { AgentSessionProvider } from '../AgentSessionContext'
import AgentStepTimeline from '../AgentStepTimeline'
import type { AgentSessionValue, AgentStep } from '../agent.types'

function session(overrides: Partial<AgentSessionValue> = {}): AgentSessionValue {
  return {
    messages: [],
    steps: [],
    status: 'idle',
    canSend: true,
    isClearing: false,
    capabilities: { supportsStepRetry: false },
    send: vi.fn(), retry: vi.fn(), confirm: vi.fn(), reject: vi.fn(),
    resolveConfirmation: vi.fn(), cancel: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

afterEach(() => vi.useRealTimers())

describe('AgentStepTimeline', () => {
  it('renders running elapsed time with tabular numerals and completed action details', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T00:00:02Z'))
    const steps: AgentStep[] = [
      { id: 'run', label: '查询任务', status: 'running', startedAt: '2026-07-14T00:00:00Z' },
      { id: 'done', label: '创建任务', status: 'completed', durationMs: 860, action: 'create_todo', result: { title: '完成原型', priority: 'high' } },
    ]
    render(<AgentStepTimeline steps={steps} capabilities={{ supportsStepRetry: false }} onRetry={vi.fn()} onConfirm={vi.fn()} onReject={vi.fn()} />)

    expect(screen.getByText('运行中')).toBeVisible()
    expect(screen.getByText('2.0 秒')).toHaveClass('tabular-nums')
    expect(screen.getByText('已完成')).toBeVisible()
    expect(screen.getByLabelText('create_todo 执行结果')).toHaveTextContent('完成原型')
  })

  it('renders confirmation actions and never offers unsafe retry when unsupported', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onReject = vi.fn()
    render(<AgentStepTimeline
      steps={[
        { id: 'failed', label: '同步任务', status: 'failed', retryable: true, errorMessage: '接口超时' },
        { id: 'confirm', label: '删除任务', status: 'waiting_confirmation', confirmationId: 'confirmation-1', confirmationMessage: '确定删除？' },
      ]}
      capabilities={{ supportsStepRetry: false }}
      onRetry={vi.fn()}
      onConfirm={onConfirm}
      onReject={onReject}
    />)

    expect(screen.queryByRole('button', { name: '重试同步任务' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认删除任务' }))
    expect(onConfirm).toHaveBeenCalledWith('confirmation-1')
    await user.click(screen.getByRole('button', { name: '取消删除任务' }))
    expect(onReject).toHaveBeenCalledWith('confirmation-1')
  })

  it('renders waiting and invokes retry only when the capability explicitly allows it', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<AgentStepTimeline
      steps={[
        { id: 'wait', label: '等待 Todo API', status: 'waiting' },
        { id: 'failed', label: '同步任务', status: 'failed', retryable: true, errorMessage: '接口超时' },
      ]}
      capabilities={{ supportsStepRetry: true }}
      onRetry={onRetry}
      onConfirm={vi.fn()}
      onReject={vi.fn()}
    />)
    expect(screen.getByText('等待中')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '重试同步任务' }))
    expect(onRetry).toHaveBeenCalledWith('failed')
  })

  it('preserves nested objects, arrays, booleans and null in an action card', () => {
    render(<AgentStepTimeline
      steps={[{
        id: 'action', label: '创建任务', status: 'completed', action: 'create_todo', durationMs: 120,
        result: { todo: { title: '完成原型', meta: { priority: 'high' } }, tags: ['设计', { name: '前端' }], completed: false, due: null },
      }]}
      capabilities={{ supportsStepRetry: false }}
      onRetry={vi.fn()}
      onConfirm={vi.fn()}
      onReject={vi.fn()}
    />)
    const card = screen.getByLabelText('create_todo 执行结果')
    expect(card).toHaveTextContent('完成原型')
    expect(card).toHaveTextContent('priority')
    expect(card).toHaveTextContent('设计')
    expect(card).toHaveTextContent('前端')
    expect(card).toHaveTextContent('false')
    expect(card).toHaveTextContent('null')
    expect(card).not.toHaveTextContent('[object Object]')
  })

  it('safely renders cyclic results and hides invalid elapsed timers', () => {
    const interval = vi.spyOn(window, 'setInterval')
    const cyclic: Record<string, unknown> = { title: '结果' }
    cyclic.self = cyclic
    render(<AgentStepTimeline
      steps={[
        { id: 'cycle', label: '循环结果', status: 'completed', action: 'inspect', result: cyclic },
        { id: 'bad-time', label: '无效时间', status: 'running', startedAt: 'not-a-date' },
      ]}
      capabilities={{ supportsStepRetry: false }} onRetry={vi.fn()} onConfirm={vi.fn()} onReject={vi.fn()}
    />)
    expect(screen.getByLabelText('inspect 执行结果')).toHaveTextContent('循环引用')
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
    expect(interval).not.toHaveBeenCalled()
  })
})

describe('AgentPanel integration', () => {
  it('removes the dark column when collapsed and exposes the header spark', async () => {
    const user = userEvent.setup()
    const value = session()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/tasks']}>
          <ShellProvider>
            <AgentSessionProvider value={value}>
              <Routes><Route element={<AppShell />}><Route path="/tasks" element={<button type="button">新建任务</button>} /></Route></Routes>
            </AgentSessionProvider>
          </ShellProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: '收起智能助手' }))
    expect(screen.queryByLabelText('智能助手面板')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-column')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开智能助手' })).toBeVisible()
  })

  it('sends suggestions and input through the shared session and keeps failed messages visible', async () => {
    const user = userEvent.setup()
    const send = vi.fn()
    const value = session({
      send,
      status: 'failed',
      messages: [{ id: 'm1', role: 'user', content: '创建周报任务', createdAt: '2026-07-14T00:00:00Z' }],
      steps: [{ id: 'client-connection', label: '连接智能助手', status: 'failed', errorMessage: '连接超时', retryable: true }],
    })
    render(<QueryClientProvider client={new QueryClient()}><AgentSessionProvider value={value}><div><AgentPanelHarness /></div></AgentSessionProvider></QueryClientProvider>)

    expect(screen.getByText('创建周报任务')).toBeVisible()
    expect(screen.getByText('连接超时')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '查看未完成任务' }))
    expect(send).toHaveBeenCalledWith('查看未完成任务')
    await user.type(screen.getByPlaceholderText('输入消息或指令…'), '安排明日计划')
    await user.keyboard('{Enter}')
    expect(send).toHaveBeenCalledWith('安排明日计划')
  })

  it('announces a failed connection as offline while preserving the conversation', () => {
    const value = session({
      status: 'failed',
      messages: [{ id: 'm1', role: 'user', content: '不要丢失这条消息', createdAt: '2026-07-14T00:00:00Z' }],
      steps: [{ id: 'client-connection', label: '连接智能助手', status: 'failed', errorCode: 'CONNECTION_TIMEOUT', errorMessage: '连接超时' }],
    })
    render(<QueryClientProvider client={new QueryClient()}><AgentSessionProvider value={value}><AgentPanelHarness /></AgentSessionProvider></QueryClientProvider>)
    expect(screen.getByText('连接异常 · 当前离线')).toHaveAttribute('role', 'alert')
    expect(screen.getByText('不要丢失这条消息')).toBeVisible()
    expect(screen.queryByText(/在线 · 随时处理任务/)).not.toBeInTheDocument()
  })

  it('describes a tool timeout as a partial task failure without claiming the user is offline', () => {
    const value = session({
      status: 'failed',
      messages: [{ id: 'm1', role: 'user', content: '保留部分成功消息', createdAt: '2026-07-14T00:00:00Z' }],
      steps: [{ id: 'create-1', label: '创建任务', tool: 'create_todo', status: 'failed', errorCode: 'TOOL_TIMEOUT', errorMessage: 'Todo API 响应超时' }],
    })
    render(<QueryClientProvider client={new QueryClient()}><AgentSessionProvider value={value}><AgentPanelHarness /></AgentSessionProvider></QueryClientProvider>)
    expect(screen.getByText('任务执行遇到问题 · 查看详情')).toHaveAttribute('role', 'alert')
    expect(screen.getByText('Todo API 响应超时')).toBeVisible()
    expect(screen.getByText('保留部分成功消息')).toBeVisible()
    expect(screen.queryByText(/当前离线/)).not.toBeInTheDocument()
  })

  it('uses a generic failure label when no failed step details are available', () => {
    render(<QueryClientProvider client={new QueryClient()}><AgentSessionProvider value={session({ status: 'failed', steps: [] })}><AgentPanelHarness /></AgentSessionProvider></QueryClientProvider>)
    expect(screen.getByText('任务未完成 · 请查看详情')).toHaveAttribute('role', 'alert')
    expect(screen.queryByText(/当前离线/)).not.toBeInTheDocument()
  })

  it.each([
    ['idle', '在线 · 随时处理任务'],
    ['connecting', '正在连接智能助手'],
    ['running', '正在执行任务'],
    ['waiting_confirmation', '等待你的确认'],
    ['done', '任务已完成'],
  ] as const)('renders the %s session status as %s', (status, label) => {
    render(<QueryClientProvider client={new QueryClient()}><AgentSessionProvider value={session({ status })}><AgentPanelHarness /></AgentSessionProvider></QueryClientProvider>)
    expect(screen.getByText(label)).toBeVisible()
  })

  it('renders the real task header slot with the collapsed spark after New Task', async () => {
    const user = userEvent.setup()
    localStorage.clear()
    const value = session()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/tasks']}><ShellProvider><AgentSessionProvider value={value}>
          <Routes><Route element={<AppShell />}><Route path="/tasks" element={<TaskDashboard />} /></Route></Routes>
        </AgentSessionProvider></ShellProvider></MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('button', { name: '收起智能助手' }))
    const newTask = screen.getByRole('button', { name: '新建任务' })
    const spark = screen.getByRole('button', { name: '展开智能助手' })
    expect(screen.queryByTestId('agent-column')).not.toBeInTheDocument()
    expect(newTask.compareDocumentPosition(spark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(spark.closest('.shell-header-actions-slot')).not.toBeNull()
  })

  it('invalidates Todo data once when an action completes', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    const value = session({ steps: [{ id: 'create-1', label: '创建任务', status: 'completed', action: 'create_todo', result: { id: 9 } }] })
    const view = render(<QueryClientProvider client={client}><AgentSessionProvider value={value}><span>surface</span></AgentSessionProvider></QueryClientProvider>)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['todos'] })

    view.rerender(<QueryClientProvider client={client}><AgentSessionProvider value={{ ...value }}><span>surface</span></AgentSessionProvider></QueryClientProvider>)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('invalidates a reused step id once per user turn, not once per component lifetime', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    const first = session({
      sessionId: 's',
      messages: [{ id: 'turn-1', role: 'user', content: '第一次', createdAt: '2026-07-14T00:00:00Z' }],
      steps: [{ id: 'create', label: '创建', status: 'completed', action: 'create_todo' }],
    })
    const view = render(<QueryClientProvider client={client}><AgentSessionProvider value={first}><span /></AgentSessionProvider></QueryClientProvider>)
    view.rerender(<QueryClientProvider client={client}><AgentSessionProvider value={{ ...first }}><span /></AgentSessionProvider></QueryClientProvider>)
    expect(invalidate).toHaveBeenCalledTimes(1)

    const second = { ...first, messages: [...first.messages, { id: 'turn-2', role: 'user' as const, content: '第二次', createdAt: '2026-07-14T00:01:00Z' }] }
    view.rerender(<QueryClientProvider client={client}><AgentSessionProvider value={second}><span /></AgentSessionProvider></QueryClientProvider>)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})

// Imported lazily through require-free JSX so the RED failure points at the new surface.
import AgentPanel from '../AgentPanel'
function AgentPanelHarness() {
  return <AgentPanel onCollapse={vi.fn()} />
}
