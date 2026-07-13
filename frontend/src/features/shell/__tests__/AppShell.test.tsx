import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { AgentSessionProvider } from '../../agent/AgentSessionContext'
import type { AgentSessionValue } from '../../agent/agent.types'
import AppShell from '../AppShell'
import { ShellProvider } from '../ShellContext'
import { useShell } from '../shell-context'

const session: AgentSessionValue = {
  messages: [], steps: [], status: 'idle', capabilities: { supportsStepRetry: false },
  canSend: true, isClearing: false,
  send: vi.fn(), retry: vi.fn(), confirm: vi.fn(), reject: vi.fn(), resolveConfirmation: vi.fn(),
  cancel: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
}

function PageHarness() {
  const { closeAgent, openAgent } = useShell()
  return <div><button type="button" onClick={closeAgent}>收起智能助手</button><button type="button" onClick={openAgent}>展开智能助手</button><Outlet /></div>
}

function renderShell(path = '/tasks') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient()}><ShellProvider><AgentSessionProvider value={session}>
        <Routes><Route element={<AppShell />}><Route element={<PageHarness />}>
          <Route path="/tasks" element={<h1>我的任务内容</h1>} />
          <Route path="/upcoming" element={<h1>近期安排内容</h1>} />
          <Route path="/assistant" element={<h1>智能助手内容</h1>} />
          <Route path="/profile" element={<h1>个人资料内容</h1>} />
        </Route></Route></Routes>
      </AgentSessionProvider></ShellProvider></QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('AppShell', () => {
  beforeEach(() => localStorage.clear())

  it('renders the V6 three-column shell and nested route', () => {
    renderShell()
    expect(screen.getByTestId('app-shell')).toHaveStyle({ '--nav-width': 'var(--nav-width-collapsed)', '--agent-width': 'var(--agent-width-expanded)' })
    expect(screen.getByRole('heading', { name: '我的任务内容' })).toBeVisible()
    expect(screen.getByLabelText('智能助手面板')).toBeVisible()
  })

  it('expands navigation while preserving keyboard focus', async () => {
    const user = userEvent.setup()
    renderShell()
    const toggle = screen.getByRole('button', { name: '展开导航' })
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveFocus()
    expect(toggle).toHaveAccessibleName('收起导航')
    expect(screen.getByTestId('app-shell')).toHaveStyle({ '--nav-width': 'var(--nav-width-expanded)' })
  })

  it('removes the entire dark Agent column immediately and restores it from the spark', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getAllByRole('button', { name: '收起智能助手' })[0])
    expect(screen.queryByTestId('agent-column')).not.toBeInTheDocument()
    expect(screen.getByTestId('app-shell')).toHaveStyle({ '--agent-width': '0px' })
    await user.click(screen.getAllByRole('button', { name: '展开智能助手' }).at(-1)!)
    expect(screen.getByLabelText('智能助手面板')).toBeVisible()
  })

  it('preserves the draft across a completed collapse and reopen', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.type(screen.getByRole('textbox', { name: '消息输入框' }), '跨关闭保留')
    await user.click(screen.getAllByRole('button', { name: '收起智能助手' })[0])
    await user.click(screen.getAllByRole('button', { name: '展开智能助手' }).at(-1)!)
    expect(screen.getByRole('textbox', { name: '消息输入框' })).toHaveValue('跨关闭保留')
  })

  it('suppresses the side panel in the standalone assistant workspace', () => {
    renderShell('/assistant')
    expect(screen.queryByTestId('agent-column')).not.toBeInTheDocument()
    expect(screen.getByTestId('app-shell')).toHaveStyle({ '--agent-width': '0px' })
    expect(document.querySelector('.shell-header-actions-fallback')).not.toBeInTheDocument()
  })

  it('marks navigation routes and keeps collapsed controls keyboard reachable', async () => {
    const user = userEvent.setup()
    renderShell('/upcoming')
    expect(screen.getByRole('link', { name: '近期安排' })).toHaveAttribute('aria-current', 'page')
    await user.tab()
    expect(screen.getByRole('link', { name: '我的任务' })).toHaveFocus()
  })
})
