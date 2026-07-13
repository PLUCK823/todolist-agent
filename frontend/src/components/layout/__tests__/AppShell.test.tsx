import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AppShell from '../AppShell'

function renderAppShell({
  showAgentPanel = true,
  initialEntries = ['/tasks'],
  currentRoute = '/tasks',
}: {
  showAgentPanel?: boolean
  initialEntries?: string[]
  currentRoute?: string
} = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          element={<AppShell showAgentPanel={showAgentPanel} />}
        >
          <Route
            path={currentRoute}
            element={<div data-testid="page-content">{currentRoute} Page Content</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppShell', () => {
  it('renders the NavigationRail', () => {
    renderAppShell()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
  })

  it('renders the AgentPanel by default', () => {
    renderAppShell()
    expect(screen.getByRole('complementary', { name: 'AI 助手面板' })).toBeInTheDocument()
  })

  it('hides AgentPanel when showAgentPanel is false', () => {
    renderAppShell({ showAgentPanel: false })
    expect(screen.queryByRole('complementary', { name: 'AI 助手面板' })).not.toBeInTheDocument()
  })

  it('renders the Outlet content via a nested route', () => {
    renderAppShell()
    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    expect(screen.getByText('/tasks Page Content')).toBeInTheDocument()
  })

  it('renders the main content area with correct structure', () => {
    renderAppShell()
    const main = screen.getByRole('main')
    expect(main).toBeInTheDocument()
  })

  it('has left margin on main to account for NavigationRail width', () => {
    renderAppShell()
    const main = screen.getByRole('main')
    expect(main.className).toContain('ml-[72px]')
  })

  it('renders logo in the three-column structure', () => {
    renderAppShell()
    expect(screen.getByText('AT')).toBeInTheDocument()
  })

  it('renders different page content when route changes', () => {
    render(
      <MemoryRouter initialEntries={['/upcoming']}>
        <Routes>
          <Route element={<AppShell showAgentPanel />}>
            <Route
              path="/upcoming"
              element={<div data-testid="upcoming-page">Upcoming Page Content</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('upcoming-page')).toBeInTheDocument()
    expect(screen.getByText('Upcoming Page Content')).toBeInTheDocument()
  })

  it('has a flex layout at the top level', () => {
    renderAppShell()
    const shell = screen.getByRole('main').parentElement
    expect(shell).toBeInTheDocument()
    expect(shell?.className).toContain('flex')
  })

  it('has correct background color', () => {
    renderAppShell()
    const shell = screen.getByRole('main').parentElement
    expect(shell?.className).toContain('bg-[var(--color-app-bg)]')
  })

  it('navigation rail has fixed positioning with correct width', () => {
    renderAppShell()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(nav.className).toContain('fixed')
    expect(nav.className).toContain('w-[72px]')
  })

  it('agent panel has correct fixed width', () => {
    renderAppShell()
    const aside = screen.getByRole('complementary', { name: 'AI 助手面板' })
    expect(aside.className).toContain('w-[320px]')
  })
})
