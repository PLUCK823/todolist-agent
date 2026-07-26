import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function mediaController(initial: boolean) {
  let matches = initial
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const media = {
    media: '(max-width: 860px)',
    get matches() { return matches },
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList
  return {
    media,
    set(next: boolean) {
      matches = next
      listeners.forEach((listener) => listener({ matches: next, media: media.media } as MediaQueryListEvent))
    },
  }
}

function renderRealAssistant(width: number, controller = mediaController(width <= 860), overrides: Partial<AgentSessionValue> = {}) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  vi.stubGlobal('matchMedia', vi.fn(() => controller.media))
  localStorage.setItem('todolist:shell', JSON.stringify({ navExpanded: true, agentExpanded: false }))
  const session = { ...makeSession(), ...overrides }
  const renderSession = (value: AgentSessionValue) => (
    <MemoryRouter initialEntries={['/assistant']}>
      <QueryClientProvider client={new QueryClient()}>
        <ShellProvider><AgentSessionProvider value={value}>
          <Routes><Route element={<AppShell />}><Route path="/assistant" element={<AssistantPage />} /></Route></Routes>
        </AgentSessionProvider></ShellProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
  const view = render(renderSession(session))
  return {
    ...view, session, controller,
    rerenderSession(next: Partial<AgentSessionValue>) {
      view.rerender(renderSession({ ...session, ...next }))
    },
  }
}

describe('AssistantPage real AppShell responsive width chain', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it.each([827, 761, 760, 390])('keeps controls reachable at a %ipx viewport without changing the expanded preference', async (width) => {
    const user = userEvent.setup()
    const { session } = renderRealAssistant(width)
    const shell = screen.getByTestId('app-shell')
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const workspace = document.querySelector('.assistant-workspace') as HTMLElement
    const conversation = document.querySelector('.assistant-conversation') as HTMLElement
    const openSessions = screen.getByRole('button', { name: '打开会话列表' })

    expect(shell).toHaveStyle({ '--nav-width': 'var(--nav-width-collapsed)' })
    expect(nav).toHaveAttribute('data-expanded', 'false')
    expect(screen.queryByRole('button', { name: '展开导航' })).not.toBeInTheDocument()
    expect(nav.querySelector('.nav-rail__label')).toHaveAttribute('data-state', 'collapsed')
    expect(nav.querySelector('.nav-rail__label')).toHaveAttribute('aria-hidden', 'true')
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
    expect(globalStyles).toMatch(/@media \(max-width:\s*860px\)[\s\S]*?\.assistant-workspace\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(globalStyles).not.toMatch(/\.app-shell:has\([^{]*assistant-workspace[^{]*\)\s*\{[^}]*--nav-width:\s*var\(--nav-width-collapsed\)\s*!important/)
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

  it('opens as a modal drawer, traps Tab, and returns focus on Escape', async () => {
    const user = userEvent.setup()
    renderRealAssistant(760)
    const opener = screen.getByRole('button', { name: '打开会话列表' })
    opener.focus()
    await user.keyboard('{Enter}')
    const drawer = screen.getByRole('complementary', { name: '会话列表' })
    const close = screen.getByRole('button', { name: '关闭会话列表' })
    const drawerButtons = Array.from(drawer.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))

    expect(close).toHaveFocus()
    expect(document.querySelector('.assistant-conversation')).toHaveAttribute('inert')
    expect(screen.getByRole('navigation', { name: '主导航' })).toHaveAttribute('inert')
    drawerButtons.at(-1)!.focus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(drawerButtons.at(-1)).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
    expect(opener).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes by mask or close control and restores the exact opener', async () => {
    const user = userEvent.setup()
    renderRealAssistant(760)
    const opener = screen.getByRole('button', { name: '打开会话列表' })
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: '关闭会话列表遮罩' }))
    await waitFor(() => expect(opener).toHaveFocus())

    await user.click(opener)
    await user.click(screen.getByRole('button', { name: '关闭会话列表' }))
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('cleans an open drawer when crossing above the compact breakpoint', async () => {
    const user = userEvent.setup()
    const controller = mediaController(true)
    renderRealAssistant(760, controller)
    const opener = screen.getByRole('button', { name: '打开会话列表' })
    await user.click(opener)
    expect(opener).toHaveAttribute('aria-expanded', 'true')

    act(() => controller.set(false))

    await waitFor(() => expect(opener).toHaveAttribute('aria-expanded', 'false'))
    await waitFor(() => expect(screen.getByRole('button', { name: '打开会话：今天计划' })).toHaveFocus())
    expect(document.querySelector('.assistant-conversation')).not.toHaveAttribute('inert')
  })

  it('restores the persisted expanded navigation preference above the assistant breakpoint', async () => {
    const controller = mediaController(true)
    renderRealAssistant(760, controller)
    const shell = screen.getByTestId('app-shell')
    const nav = screen.getByRole('navigation', { name: '主导航' })

    expect(nav).toHaveAttribute('data-expanded', 'false')
    expect(JSON.parse(localStorage.getItem('todolist:shell')!)).toMatchObject({ navExpanded: true })

    act(() => controller.set(false))

    await waitFor(() => expect(nav).toHaveAttribute('data-expanded', 'true'))
    expect(shell).toHaveStyle({ '--nav-width': 'var(--nav-width-expanded)' })
    expect(screen.getByRole('button', { name: '收起导航' })).toHaveAttribute('aria-expanded', 'true')
    expect(JSON.parse(localStorage.getItem('todolist:shell')!)).toMatchObject({ navExpanded: true })
  })

  it('does not expose a preference-mutating navigation toggle while compact', async () => {
    const controller = mediaController(true)
    renderRealAssistant(760, controller)

    expect(screen.queryByRole('button', { name: '展开导航' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('todolist:shell')!)).toMatchObject({ navExpanded: true })

    act(() => controller.set(false))

    const toggle = await screen.findByRole('button', { name: '收起导航' })
    expect(toggle).toBeEnabled()
    expect(JSON.parse(localStorage.getItem('todolist:shell')!)).toMatchObject({ navExpanded: true })
    await userEvent.click(toggle)
    expect(JSON.parse(localStorage.getItem('todolist:shell')!)).toMatchObject({ navExpanded: false })
  })

  it('hands loading fallback focus to the new-session action when history becomes usable', async () => {
    const user = userEvent.setup()
    const controller = mediaController(true)
    const { session, rerenderSession } = renderRealAssistant(760, controller, {
      sessionId: undefined,
      selectedSessionId: undefined,
      displayedSessionId: undefined,
      sessions: [], turns: [], messages: [], steps: [],
      isHistoryLoading: true, canSend: false,
    })
    await user.click(screen.getByRole('button', { name: '打开会话列表' }))
    expect(screen.getByRole('button', { name: '关闭会话列表' })).toHaveFocus()

    act(() => controller.set(false))

    const create = screen.getByRole('button', { name: '新建会话' })
    const fallback = document.querySelector('.assistant-conversation') as HTMLElement
    await waitFor(() => expect(fallback).toHaveFocus())
    expect(screen.getByRole('button', { name: '打开会话列表' })).not.toHaveFocus()

    rerenderSession({ isHistoryLoading: false, canSend: true })
    await waitFor(() => expect(create).toHaveFocus())
    expect(create).toBeVisible()
    expect(create).toBeEnabled()
    await user.click(create)
    expect(session.createSession).toHaveBeenCalledTimes(1)
  })

  it('does not steal focus after the user leaves a resize fallback', async () => {
    const controller = mediaController(true)
    const { rerenderSession } = renderRealAssistant(760, controller, {
      sessionId: undefined, selectedSessionId: undefined, displayedSessionId: undefined,
      sessions: [], turns: [], messages: [], steps: [], isHistoryLoading: true, canSend: false,
    })
    await userEvent.click(screen.getByRole('button', { name: '打开会话列表' }))
    act(() => controller.set(false))
    const fallback = document.querySelector('.assistant-conversation') as HTMLElement
    await waitFor(() => expect(fallback).toHaveFocus())
    const settings = screen.getByRole('button', { name: '设置' })
    settings.focus()

    rerenderSession({ isHistoryLoading: false, canSend: true })

    await waitFor(() => expect(settings).toHaveFocus())
  })

  it('removes media-query listeners when the assistant shell unmounts', () => {
    const controller = mediaController(true)
    const view = renderRealAssistant(760, controller)
    expect(controller.media.addEventListener).toHaveBeenCalled()

    view.unmount()

    expect(controller.media.removeEventListener).toHaveBeenCalledTimes(
      vi.mocked(controller.media.addEventListener).mock.calls.length,
    )
  })
})
