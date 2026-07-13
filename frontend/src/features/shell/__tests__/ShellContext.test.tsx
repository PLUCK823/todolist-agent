import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShellProvider } from '../ShellContext'
import { useShell } from '../shell-context'

function ShellHarness() {
  const shell = useShell()

  return (
    <div>
      <output aria-label="导航状态">{shell.navExpanded ? 'expanded' : 'collapsed'}</output>
      <output aria-label="智能助手状态">{shell.agentExpanded ? 'expanded' : 'collapsed'}</output>
      <button type="button" onClick={shell.toggleNav}>展开导航</button>
      <button type="button" onClick={shell.closeAgent}>收起智能助手</button>
      <button type="button" onClick={shell.openAgent}>展开智能助手</button>
    </div>
  )
}

function renderShell() {
  return render(
    <ShellProvider>
      <ShellHarness />
    </ShellProvider>,
  )
}

describe('ShellContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to a collapsed navigation and expanded agent', () => {
    renderShell()

    expect(screen.getByLabelText('导航状态')).toHaveTextContent('collapsed')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('expanded')
  })

  it('persists navigation and agent state changes', async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole('button', { name: '展开导航' }))
    await user.click(screen.getByRole('button', { name: '收起智能助手' }))

    expect(localStorage.getItem('todolist:shell')).toBe(
      JSON.stringify({ navExpanded: true, agentExpanded: false }),
    )
  })

  it('restores a valid persisted state after remounting', () => {
    localStorage.setItem(
      'todolist:shell',
      JSON.stringify({ navExpanded: true, agentExpanded: false }),
    )

    renderShell()

    expect(screen.getByLabelText('导航状态')).toHaveTextContent('expanded')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('collapsed')
  })

  it('uses safe defaults when persisted storage is malformed', () => {
    localStorage.setItem('todolist:shell', '{not-json')

    renderShell()

    expect(screen.getByLabelText('导航状态')).toHaveTextContent('collapsed')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('expanded')
  })

  it('uses safe defaults when persisted properties are not booleans', () => {
    localStorage.setItem(
      'todolist:shell',
      JSON.stringify({ navExpanded: 'yes', agentExpanded: null }),
    )

    renderShell()

    expect(screen.getByLabelText('导航状态')).toHaveTextContent('collapsed')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('expanded')
  })
})
