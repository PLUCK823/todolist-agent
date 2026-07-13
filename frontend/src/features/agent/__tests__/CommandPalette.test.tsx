import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AgentSessionProvider } from '../AgentSessionContext'
import CommandPalette from '../CommandPalette'
import type { AgentSessionValue } from '../agent.types'

function renderPalette() {
  const send = vi.fn()
  const openAgent = vi.fn()
const session: AgentSessionValue = {
  canSend: true,
  isClearing: false,
    messages: [], steps: [], status: 'idle', capabilities: { supportsStepRetry: false },
    send, retry: vi.fn(), confirm: vi.fn(), reject: vi.fn(), resolveConfirmation: vi.fn(),
    cancel: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
  }
  render(<QueryClientProvider client={new QueryClient()}><AgentSessionProvider value={session}><button type="button">触发来源</button><CommandPalette onOpenAgent={openAgent} /></AgentSessionProvider></QueryClientProvider>)
  return { send, openAgent }
}

describe('CommandPalette', () => {
  it.each(['{Meta>}k{/Meta}', '{Alt>}k{/Alt}'])('opens with %s and focuses the prompt', async (shortcut) => {
    const user = userEvent.setup()
    renderPalette()
    await user.keyboard(shortcut)
    expect(screen.getByRole('dialog', { name: '快速询问' })).toBeVisible()
    expect(screen.getByPlaceholderText('告诉智能助手你想完成什么…')).toHaveFocus()
  })

  it('closes with Escape and restores focus', async () => {
    const user = userEvent.setup()
    renderPalette()
    const trigger = screen.getByRole('button', { name: '触发来源' })
    trigger.focus()
    await user.keyboard('{Meta>}k{/Meta}')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '快速询问' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on its mask and traps Tab focus while open', async () => {
    const user = userEvent.setup()
    renderPalette()
    await user.keyboard('{Alt>}k{/Alt}')
    const dialog = screen.getByRole('dialog', { name: '快速询问' })
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await user.click(screen.getByTestId('command-palette-mask'))
    expect(screen.queryByRole('dialog', { name: '快速询问' })).not.toBeInTheDocument()
  })

  it('submits through the shared session, closes, and opens the Agent panel', async () => {
    const user = userEvent.setup()
    const { send, openAgent } = renderPalette()
    await user.keyboard('{Meta>}k{/Meta}')
    await user.type(screen.getByPlaceholderText('告诉智能助手你想完成什么…'), '整理明天的计划')
    await user.keyboard('{Enter}')
    expect(send).toHaveBeenCalledWith('整理明天的计划')
    expect(openAgent).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '快速询问' })).not.toBeInTheDocument()
  })
})
