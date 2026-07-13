import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import NavigationRail from '../NavigationRail'
import { ShellProvider } from '../ShellContext'

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

  it('shows only icons and the avatar when collapsed', () => {
    renderNavigation()
    expect(screen.queryByText('我的任务')).not.toBeInTheDocument()
    expect(screen.queryByText('近期安排')).not.toBeInTheDocument()
    expect(screen.queryByText('智能助手')).not.toBeInTheDocument()
    expect(screen.queryByText('Plucky HZ')).not.toBeInTheDocument()
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
    window.addEventListener('todolist:open-settings', listener)
    renderNavigation()

    await user.click(screen.getByRole('button', { name: '设置' }))

    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener('todolist:open-settings', listener)
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
