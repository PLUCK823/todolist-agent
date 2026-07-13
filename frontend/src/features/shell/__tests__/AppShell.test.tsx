import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import AppShell from '../AppShell'
import { ShellProvider } from '../ShellContext'
import { useShell } from '../shell-context'

function PageHarness() {
  const { closeAgent, openAgent } = useShell()

  return (
    <div>
      <button type="button" onClick={closeAgent}>收起智能助手</button>
      <button type="button" onClick={openAgent}>展开智能助手</button>
      <Outlet />
    </div>
  )
}

function renderShell(path = '/tasks') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ShellProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route element={<PageHarness />}>
              <Route path="/tasks" element={<h1>我的任务内容</h1>} />
              <Route path="/upcoming" element={<h1>近期安排内容</h1>} />
              <Route path="/assistant" element={<h1>智能助手内容</h1>} />
              <Route path="/profile" element={<h1>个人资料内容</h1>} />
            </Route>
          </Route>
        </Routes>
      </ShellProvider>
    </MemoryRouter>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the V6 three-column shell and the nested route', () => {
    renderShell()

    const shell = screen.getByTestId('app-shell')
    expect(shell).toHaveClass('app-shell')
    expect(shell).toHaveStyle({
      '--nav-width': 'var(--nav-width-collapsed)',
      '--agent-width': 'var(--agent-width-expanded)',
    })
    expect(screen.getByRole('heading', { name: '我的任务内容' })).toBeInTheDocument()
  })

  it('expands the navigation rail and preserves keyboard focus', async () => {
    const user = userEvent.setup()
    renderShell()

    const toggle = screen.getByRole('button', { name: '展开导航' })
    toggle.focus()
    await user.keyboard('{Enter}')

    expect(toggle).toHaveFocus()
    expect(toggle).toHaveAccessibleName('收起导航')
    expect(screen.getByTestId('app-shell')).toHaveStyle({
      '--nav-width': 'var(--nav-width-expanded)',
    })
    expect(screen.getByText('Plucky HZ')).toBeVisible()
  })

  it('makes the agent inert while exiting and removes its column after transition end', async () => {
    const user = userEvent.setup()
    renderShell()

    expect(screen.getByRole('complementary', { name: 'AI 助手面板' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '收起智能助手' }))

    const column = screen.getByTestId('agent-column')
    expect(column).toHaveAttribute('data-state', 'exiting')
    expect(column).toHaveAttribute('aria-hidden', 'true')
    expect(column).toHaveAttribute('inert')
    expect(column.querySelector('[aria-label="AI 助手面板"]')).toBeInTheDocument()
    fireEvent.transitionEnd(column)

    expect(screen.queryByTestId('agent-column')).not.toBeInTheDocument()
    expect(screen.getByTestId('app-shell')).toHaveStyle({ '--agent-width': '0px' })
  })

  it('keeps the agent draft and instance alive when close is quickly reversed', async () => {
    const user = userEvent.setup()
    renderShell()
    const input = screen.getByRole('textbox', { name: '消息输入框' })
    await user.type(input, '保留这段草稿')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '收起智能助手' }))
    expect(screen.getByTestId('agent-column')).toHaveAttribute('data-state', 'exiting')
    fireEvent.click(screen.getByRole('button', { name: '展开智能助手' }))

    expect(screen.getByTestId('agent-column')).toHaveAttribute('data-state', 'entered')
    expect(screen.getByRole('textbox', { name: '消息输入框' })).toBe(input)
    expect(input).toHaveValue('保留这段草稿')
    act(() => vi.advanceTimersByTime(480))
    expect(screen.getByTestId('agent-column')).toHaveAttribute('data-state', 'entered')
    expect(input).toHaveValue('保留这段草稿')
  })

  it('restores the draft after a completed close and later reopen', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.type(screen.getByRole('textbox', { name: '消息输入框' }), '跨关闭保留')
    await user.click(screen.getByRole('button', { name: '收起智能助手' }))
    fireEvent.transitionEnd(screen.getByTestId('agent-column'))

    expect(screen.queryByTestId('agent-column')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '展开智能助手' }))

    expect(screen.getByRole('textbox', { name: '消息输入框' })).toHaveValue('跨关闭保留')
  })

  it('uses the shell motion duration as a fallback when transitionend does not fire', () => {
    vi.useFakeTimers()
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: '收起智能助手' }))
    expect(screen.getByTestId('agent-column')).toHaveAttribute('data-state', 'exiting')

    act(() => vi.advanceTimersByTime(480))

    expect(screen.queryByTestId('agent-column')).not.toBeInTheDocument()
  })

  it('marks the current navigation route with aria-current', () => {
    renderShell('/upcoming')

    expect(screen.getByRole('link', { name: '近期安排' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '我的任务' })).not.toHaveAttribute('aria-current')
  })

  it('keeps navigation controls keyboard reachable when collapsed', async () => {
    const user = userEvent.setup()
    renderShell()

    await user.tab()
    expect(screen.getByRole('link', { name: '我的任务' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: '近期安排' })).toHaveFocus()
  })
})
