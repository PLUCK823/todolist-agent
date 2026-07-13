import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AppShell from '../../shell/AppShell'
import { ShellProvider } from '../../shell/ShellContext'
import { AgentSessionProvider } from '../AgentSessionContext'
import AgentStepTimeline from '../AgentStepTimeline'
import type { AgentSessionValue, AgentStep } from '../agent.types'

function session(overrides: Partial<AgentSessionValue> = {}): AgentSessionValue {
  return {
    messages: [],
    steps: [],
    status: 'idle',
    capabilities: { supportsStepRetry: false },
    send: vi.fn(), retry: vi.fn(), confirm: vi.fn(), reject: vi.fn(),
    resolveConfirmation: vi.fn(), cancel: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

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
    expect(screen.getByText('完成原型')).toBeVisible()
    vi.useRealTimers()
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

  it('invalidates Todo data once when an action completes', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    const value = session({ steps: [{ id: 'create-1', label: '创建任务', status: 'completed', action: 'create_todo', result: { id: 9 } }] })
    const view = render(<QueryClientProvider client={client}><AgentSessionProvider value={value}><span>surface</span></AgentSessionProvider></QueryClientProvider>)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['todos'] })

    view.rerender(<QueryClientProvider client={client}><AgentSessionProvider value={{ ...value }}><span>surface</span></AgentSessionProvider></QueryClientProvider>)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
})

// Imported lazily through require-free JSX so the RED failure points at the new surface.
import AgentPanel from '../AgentPanel'
function AgentPanelHarness() {
  return <AgentPanel onCollapse={vi.fn()} />
}
