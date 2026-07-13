import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NavigationRail from '../NavigationRail'

function renderWithRouter(initialEntries: string[] = ['/tasks']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <NavigationRail />
    </MemoryRouter>,
  )
}

describe('NavigationRail', () => {
  it('renders the logo', () => {
    renderWithRouter()
    expect(screen.getByText('AT')).toBeInTheDocument()
  })

  it('renders all navigation items', () => {
    renderWithRouter()
    expect(screen.getByLabelText('任务')).toBeInTheDocument()
    expect(screen.getByLabelText('安排')).toBeInTheDocument()
    expect(screen.getByLabelText('助手')).toBeInTheDocument()
    expect(screen.getByLabelText('我的')).toBeInTheDocument()
  })

  it('has correct nav landmark role', () => {
    renderWithRouter()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(nav).toBeInTheDocument()
  })

  it('applies active styling to the current route', () => {
    renderWithRouter(['/tasks'])
    const tasksLink = screen.getByLabelText('任务')
    expect(tasksLink.className).toContain('var(--color-primary)')
  })

  it('does not apply active styling to inactive routes', () => {
    renderWithRouter(['/tasks'])
    const upcomingLink = screen.getByLabelText('安排')
    expect(upcomingLink.className).not.toContain('var(--color-primary)')
    expect(upcomingLink.className).toContain('var(--color-text-secondary)')
  })

  it('changes active item when navigating to a different route', () => {
    renderWithRouter(['/upcoming'])
    const upcomingLink = screen.getByLabelText('安排')
    expect(upcomingLink.className).toContain('var(--color-primary)')

    const tasksLink = screen.getByLabelText('任务')
    expect(tasksLink.className).toContain('var(--color-text-secondary)')
  })

  it('each nav link points to the correct route path', () => {
    renderWithRouter()
    const tasksLink = screen.getByLabelText('任务')
    const upcomingLink = screen.getByLabelText('安排')
    const assistantLink = screen.getByLabelText('助手')
    const profileLink = screen.getByLabelText('我的')

    expect(tasksLink).toHaveAttribute('href', '/tasks')
    expect(upcomingLink).toHaveAttribute('href', '/upcoming')
    expect(assistantLink).toHaveAttribute('href', '/assistant')
    expect(profileLink).toHaveAttribute('href', '/profile')
  })

  it('renders fixed position with correct width', () => {
    renderWithRouter()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(nav.className).toContain('fixed')
    expect(nav.className).toContain('w-[72px]')
  })

  it('renders icons for each nav item', () => {
    renderWithRouter()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(4)

    for (const link of links) {
      const svg = link.querySelector('svg')
      expect(svg).toBeInTheDocument()
    }
  })

  it('has label text below each icon', () => {
    renderWithRouter()
    expect(screen.getByText('任务')).toBeInTheDocument()
    expect(screen.getByText('安排')).toBeInTheDocument()
    expect(screen.getByText('助手')).toBeInTheDocument()
    expect(screen.getByText('我的')).toBeInTheDocument()
  })
})
