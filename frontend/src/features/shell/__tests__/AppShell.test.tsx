import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import AppShell from '../AppShell'
import { ShellProvider } from '../ShellContext'
import { useShell } from '../shell-context'

function PageHarness() {
  const { closeAgent } = useShell()

  return (
    <div>
      <button type="button" onClick={closeAgent}>收起智能助手</button>
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

  it('renders the V6 three-column shell and the nested route', () => {
    renderShell()

    const shell = screen.getByTestId('app-shell')
    expect(shell).toHaveClass('app-shell')
    expect(shell).toHaveStyle({
      '--nav-width': '68px',
      '--agent-width': '340px',
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
    expect(screen.getByTestId('app-shell')).toHaveStyle({ '--nav-width': '210px' })
    expect(screen.getByText('Plucky HZ')).toBeVisible()
  })

  it('removes the agent panel and its dark column when the agent is collapsed', async () => {
    const user = userEvent.setup()
    renderShell()

    expect(screen.getByRole('complementary', { name: 'AI 助手面板' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '收起智能助手' }))

    expect(screen.queryByRole('complementary', { name: 'AI 助手面板' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-column')).not.toBeInTheDocument()
    expect(screen.getByTestId('app-shell')).toHaveStyle({ '--agent-width': '0px' })
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
