import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import NavigationRail from '../NavigationRail'
import { ShellProvider } from '../ShellContext'
import { SETTINGS_OPEN_EVENT } from '../shell-events'

function renderNavigation(path = '/tasks') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ShellProvider>
        <NavigationRail />
      </ShellProvider>
    </MemoryRouter>,
  )
}

describe('NavigationRail', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exposes a named navigation landmark', () => {
    renderNavigation()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
  })

  it('renders the approved navigation destinations in order', () => {
    renderNavigation()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const controls = Array.from(nav.querySelectorAll('a, button'))

    expect(controls.map((control) => control.getAttribute('aria-label'))).toEqual([
      '我的任务',
      '近期安排',
      '智能助手',
      '设置',
      '用户资料',
      '展开导航',
    ])
  })

  it('links each page destination to its current route', () => {
    renderNavigation()
    expect(screen.getByRole('link', { name: '我的任务' })).toHaveAttribute('href', '/tasks')
    expect(screen.getByRole('link', { name: '近期安排' })).toHaveAttribute('href', '/upcoming')
    expect(screen.getByRole('link', { name: '智能助手' })).toHaveAttribute('href', '/assistant')
    expect(screen.getByRole('link', { name: '用户资料' })).toHaveAttribute('href', '/profile')
  })

  it('keeps labels mounted but hidden from accessibility when collapsed', () => {
    renderNavigation()
    expect(screen.getByText('我的任务')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('近期安排')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('智能助手')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Plucky HZ')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('HZ')).toBeInTheDocument()
  })

  it('reveals labels and user information when expanded', async () => {
    const user = userEvent.setup()
    renderNavigation()
    await user.click(screen.getByRole('button', { name: '展开导航' }))

    expect(screen.getByText('我的任务')).toBeVisible()
    expect(screen.getByText('近期安排')).toBeVisible()
    expect(screen.getByText('智能助手')).toBeVisible()
    expect(screen.getByText('Plucky HZ')).toBeVisible()
    expect(screen.getByText('plucky@example.com')).toBeVisible()
    expect(screen.getByText('我的任务')).toHaveAttribute('aria-hidden', 'false')
  })

  it('preserves label nodes across the expansion transition', async () => {
    const user = userEvent.setup()
    renderNavigation()
    const taskLabel = screen.getByText('我的任务')
    const userName = screen.getByText('Plucky HZ')

    await user.click(screen.getByRole('button', { name: '展开导航' }))

    expect(screen.getByText('我的任务')).toBe(taskLabel)
    expect(screen.getByText('Plucky HZ')).toBe(userName)
    expect(taskLabel).toHaveAttribute('data-state', 'expanded')
    expect(userName).toHaveAttribute('data-state', 'expanded')
  })

  it('updates its accessible expansion state', async () => {
    const user = userEvent.setup()
    renderNavigation()
    const toggle = screen.getByRole('button', { name: '展开导航' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('marks tasks as the active destination', () => {
    renderNavigation('/tasks')
    expect(screen.getByRole('link', { name: '我的任务' })).toHaveAttribute('aria-current', 'page')
  })

  it('marks the assistant workspace as the active destination', () => {
    renderNavigation('/assistant')
    expect(screen.getByRole('link', { name: '智能助手' })).toHaveAttribute('aria-current', 'page')
  })

  it('uses the active visual treatment only on the current destination', () => {
    renderNavigation('/upcoming')
    expect(screen.getByRole('link', { name: '近期安排' })).toHaveClass('nav-rail__control--active')
    expect(screen.getByRole('link', { name: '我的任务' })).not.toHaveClass('nav-rail__control--active')
  })

  it('dispatches the settings boundary event', async () => {
    const user = userEvent.setup()
    const listener = vi.fn()
    window.addEventListener(SETTINGS_OPEN_EVENT, listener)
    renderNavigation()

    await user.click(screen.getByRole('button', { name: '设置' }))

    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(SETTINGS_OPEN_EVENT, listener)
  })

  it('renders an icon for every primary route', () => {
    renderNavigation()
    for (const label of ['我的任务', '近期安排', '智能助手']) {
      expect(screen.getByRole('link', { name: label }).querySelector('svg')).toBeInTheDocument()
    }
  })

  it('keeps the profile entry reachable as a route link', () => {
    renderNavigation()
    expect(screen.getByRole('link', { name: '用户资料' })).toBeVisible()
  })
})
