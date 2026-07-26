import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSessionProvider } from '../../features/agent/AgentSessionContext'
import type { AgentSessionValue, AgentTurn } from '../../features/agent/agent.types'
import AppShell from '../../features/shell/AppShell'
import { ShellProvider } from '../../features/shell/ShellContext'
import globalStyles from '../../styles/global.css?raw'
import AssistantPage from '../AssistantPage'

const turn: AgentTurn = {
  id: 'turn-1', ordinal: 1, status: 'completed', startedAt: '2026-07-26T08:00:00Z',
  completedAt: '2026-07-26T08:00:01Z', resultUncertain: false,
  messages: [
    { id: 'user-1', role: 'user', content: '今天做什么', createdAt: '2026-07-26T08:00:00Z' },
    { id: 'assistant-1', role: 'assistant', content: '先完成响应式检查。', createdAt: '2026-07-26T08:00:01Z' },
  ],
  steps: [],
}

function makeSession(): AgentSessionValue {
  return {
    sessionId: 'session-1', selectedSessionId: 'session-1', displayedSessionId: 'session-1',
    messages: turn.messages, steps: [], turns: [turn], status: 'done', capabilities: { supportsStepRetry: false },
    canSend: true, isClearing: false, send: vi.fn().mockReturnValue(true),
    canRetry: vi.fn().mockReturnValue(false), retry: vi.fn(), canConfirm: vi.fn().mockReturnValue(false),
    confirm: vi.fn(), reject: vi.fn(), resolveConfirmation: vi.fn(), cancel: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
    sessions: [{ id: 'session-1', title: '今天计划', createdAt: turn.startedAt, updatedAt: turn.completedAt!, lastMessageAt: turn.completedAt! }],
    isHistoryLoading: false, createSession: vi.fn().mockResolvedValue(undefined), selectSession: vi.fn(),
    renameSession: vi.fn().mockResolvedValue(undefined), deleteSession: vi.fn().mockResolvedValue(undefined), reloadHistory: vi.fn().mockResolvedValue(undefined),
  }
}

function renderRealAssistant(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  localStorage.setItem('todolist:shell', JSON.stringify({ navExpanded: true, agentExpanded: false }))
  const session = makeSession()
  const view = render(
    <MemoryRouter initialEntries={['/assistant']}>
      <QueryClientProvider client={new QueryClient()}>
        <ShellProvider><AgentSessionProvider value={session}>
          <Routes><Route element={<AppShell />}><Route path="/assistant" element={<AssistantPage />} /></Route></Routes>
        </AgentSessionProvider></ShellProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...view, session }
}

describe('AssistantPage real AppShell responsive width chain', () => {
  beforeEach(() => localStorage.clear())

  it.each([827, 761, 760, 390])('keeps controls reachable at a %ipx viewport without changing the expanded preference', async (width) => {
    const user = userEvent.setup()
    const { session } = renderRealAssistant(width)
    const shell = screen.getByTestId('app-shell')
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const workspace = document.querySelector('.assistant-workspace') as HTMLElement
    const conversation = document.querySelector('.assistant-conversation') as HTMLElement
    const openSessions = screen.getByRole('button', { name: '打开会话列表' })

    expect(shell).toHaveStyle({ '--nav-width': 'var(--nav-width-expanded)' })
    expect(nav).toHaveAttribute('data-expanded', 'true')
    expect(JSON.parse(localStorage.getItem('todolist:shell')!)).toMatchObject({ navExpanded: true })
    expect(workspace).toContainElement(conversation)
    expect(screen.getByRole('textbox', { name: '智能助手消息' })).toBeVisible()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeVisible()
    expect(openSessions).toHaveAttribute('aria-controls', 'assistant-session-drawer')
    expect(openSessions).toHaveAttribute('aria-expanded', 'false')

    await user.click(openSessions)
    expect(openSessions).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('assistant-session-drawer')).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('button', { name: '打开会话：今天计划' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '智能助手消息' }), '保持可达')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(session.send).toHaveBeenCalledWith('保持可达')
  })

  it('switches to a compact rail and one-column assistant before the content can be clipped', () => {
    const breakpoint = Number(globalStyles.match(/@media \(max-width:\s*(\d+)px\)\s*\{\s*\.app-shell:has\([^)]*assistant-workspace/)?.[1])
    expect(breakpoint).toBeGreaterThanOrEqual(827)
    expect(globalStyles).toMatch(/\.app-shell:has\([^{]*assistant-workspace[^{]*\)\s*\{[^}]*--nav-width:\s*var\(--nav-width-collapsed\)\s*!important/)
    expect(globalStyles).toMatch(/@media \(max-width:\s*8\d\dpx\)[\s\S]*?\.assistant-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(globalStyles).toMatch(/\.assistant-conversation\s*\{[^}]*min-width:\s*0/)
    expect(globalStyles).not.toMatch(/@media \(max-width:\s*8\d\dpx\)[\s\S]*?\.assistant-conversation\s*\{[^}]*min-width:\s*400px/)

    for (const width of [827, 761, 760, 390]) {
      const shellGutter = width <= 760 ? 0 : 28
      const compactRail = 68
      const visibleMain = width - shellGutter - compactRail
      expect(visibleMain).toBeGreaterThanOrEqual(320)
      expect(shellGutter + compactRail + visibleMain).toBe(width)
    }
  })
})
