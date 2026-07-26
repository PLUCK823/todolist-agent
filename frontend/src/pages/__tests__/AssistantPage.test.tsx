import { useState } from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSessionProvider } from '../../features/agent/AgentSessionContext'
import type { AgentSessionValue, AgentTurn } from '../../features/agent/agent.types'
import { ShellProvider } from '../../features/shell/ShellContext'
import { useShell } from '../../features/shell/shell-context'
import { renderWithProviders } from '../../test/render'
import AssistantPage from '../AssistantPage'

function makeTurn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    id: 'turn-1',
    ordinal: 1,
    status: 'completed',
    startedAt: '2026-07-26T08:00:00Z',
    completedAt: '2026-07-26T08:00:02Z',
    resultUncertain: false,
    messages: [
      { id: 'user-1', role: 'user', content: '列出今天的任务', createdAt: '2026-07-26T08:00:00Z' },
      { id: 'assistant-1', role: 'assistant', content: '完成。', createdAt: '2026-07-26T08:00:02Z' },
    ],
    steps: [{ id: 'step-1', label: '查询任务', status: 'completed', durationMs: 520 }],
    ...overrides,
  }
}

function makeSession(value: Partial<AgentSessionValue> = {}): AgentSessionValue {
  const turn = makeTurn()
  return {
    sessionId: 'today',
    selectedSessionId: 'today',
    displayedSessionId: 'today',
    messages: turn.messages,
    steps: turn.steps,
    turns: [turn],
    sessions: [{
      id: 'today', title: '今天的安排', createdAt: turn.startedAt,
      updatedAt: turn.completedAt!, lastMessageAt: turn.completedAt!,
    }],
    status: 'done',
    canSend: true,
    isClearing: false,
    capabilities: { supportsStepRetry: false },
    send: vi.fn().mockReturnValue(true),
    canRetry: vi.fn().mockReturnValue(false),
    retry: vi.fn(),
    canConfirm: vi.fn().mockReturnValue(false),
    confirm: vi.fn(),
    reject: vi.fn(),
    resolveConfirmation: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn().mockResolvedValue(undefined),
    isHistoryLoading: false,
    createSession: vi.fn().mockResolvedValue(undefined),
    selectSession: vi.fn(),
    renameSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    reloadHistory: vi.fn().mockResolvedValue(undefined),
    ...value,
  }
}

function renderPage(value: Partial<AgentSessionValue> = {}) {
  const session = makeSession(value)
  return {
    session,
    result: renderWithProviders(
      <ShellProvider><AgentSessionProvider value={session}><AssistantPage /></AgentSessionProvider></ShellProvider>,
    ),
  }
}

describe('AssistantPage', () => {
  beforeEach(() => localStorage.clear())

  it('connects the real session list CRUD callbacks and selection state', async () => {
    const user = userEvent.setup()
    const { session } = renderPage({
      sessions: [
        { id: 'today', title: '今天的安排', createdAt: '2026-07-26T08:00:00Z', updatedAt: '2026-07-26T08:01:00Z', lastMessageAt: '2026-07-26T08:01:00Z' },
        { id: 'older', title: '上周总结', createdAt: '2026-07-18T08:00:00Z', updatedAt: '2026-07-18T08:01:00Z', lastMessageAt: '2026-07-18T08:01:00Z' },
      ],
    })

    const navigation = screen.getByRole('navigation', { name: 'Agent 会话' })
    expect(within(navigation).getByRole('button', { name: '打开会话：今天的安排' })).toHaveAttribute('aria-current', 'page')
    await user.click(within(navigation).getByRole('button', { name: '打开会话：上周总结' }))
    expect(session.selectSession).toHaveBeenCalledWith('older')
    await user.click(within(navigation).getByRole('button', { name: '新建会话' }))
    expect(session.createSession).toHaveBeenCalledTimes(1)
  })

  it('keeps the displayed session marked current while a newly selected detail is loading', () => {
    renderPage({
      selectedSessionId: 'older',
      displayedSessionId: 'today',
      isHistoryLoading: true,
      sessions: [
        { id: 'today', title: '仍在显示', createdAt: '2026-07-26T08:00:00Z', updatedAt: '2026-07-26T08:01:00Z', lastMessageAt: '2026-07-26T08:01:00Z' },
        { id: 'older', title: '正在请求', createdAt: '2026-07-18T08:00:00Z', updatedAt: '2026-07-18T08:01:00Z', lastMessageAt: '2026-07-18T08:01:00Z' },
      ],
    })
    expect(screen.getByRole('button', { name: '打开会话：仍在显示' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '打开会话：正在请求' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('log', { name: '会话内容' })).toHaveAttribute('aria-live', 'off')
  })

  it('keeps the new-session recovery action available when there is no usable session', async () => {
    const user = userEvent.setup()
    const { session } = renderPage({
      sessionId: undefined, selectedSessionId: undefined, displayedSessionId: undefined,
      sessions: [], turns: [], messages: [], steps: [], status: 'failed', canSend: false,
    })
    const create = screen.getByRole('button', { name: '新建会话' })
    expect(create).toBeEnabled()
    await user.click(create)
    expect(session.createSession).toHaveBeenCalledTimes(1)
  })

  it('renders turns by ordinal with user, safe assistant Markdown, and per-reply disclosure order', () => {
    const second = makeTurn({
      id: 'turn-2', ordinal: 2,
      messages: [
        { id: 'user-2', role: 'user', content: '<b>用户原文</b>', createdAt: '2026-07-26T08:02:00Z' },
        { id: 'assistant-2', role: 'assistant', content: '| 任务 | 状态 |\n| --- | --- |\n| 原型 | 完成 |\n<script>alert(1)</script>', createdAt: '2026-07-26T08:02:02Z' },
      ],
      steps: [{ id: 'step-2', label: '整理任务', status: 'completed' }],
    })
    const first = makeTurn({ id: 'turn-1', ordinal: 1 })
    renderPage({ turns: [second, first], messages: [...second.messages, ...first.messages], steps: first.steps })

    const log = screen.getByRole('log', { name: '会话内容' })
    expect(within(log).getAllByTestId(/agent-turn-/).map((turn) => turn.dataset.testid)).toEqual([
      'agent-turn-turn-1', 'agent-turn-turn-2',
    ])
    const markdownTurn = within(log).getByTestId('agent-turn-turn-2')
    expect(within(markdownTurn).getByText('<b>用户原文</b>')).toBeVisible()
    expect(within(markdownTurn).getByRole('table')).toHaveTextContent('原型')
    expect(document.querySelector('script')).toBeNull()
    expect(Array.from(markdownTurn.children).map((node) => node.getAttribute('data-role') ?? node.getAttribute('data-part')))
      .toEqual(['user', 'assistant', 'execution-details'])
    expect(screen.getAllByLabelText('Agent 执行步骤')).toHaveLength(2)
    expect(screen.queryByText('当前任务轨迹')).not.toBeInTheDocument()
  })

  it('has exactly header, scroll region, and last compact composer in the conversation DOM', () => {
    renderPage()
    const conversation = document.querySelector('.assistant-conversation')!
    expect(Array.from(conversation.children).map((node) => node.className || node.tagName.toLowerCase()))
      .toEqual(['assistant-conversation__header', 'assistant-conversation__scroll', 'assistant-composer'])
    expect(conversation.lastElementChild).toHaveClass('assistant-composer')
    expect(screen.getByRole('log', { name: '会话内容' })).toHaveClass('assistant-conversation__scroll')
    expect(document.querySelectorAll('.assistant-conversation__scroll')).toHaveLength(1)
    expect(document.querySelector('.assistant-composer .assistant-scroll-return')).toBeNull()
  })

  it('keeps old turns during loading and errors, with busy/status semantics and retry in the session list', async () => {
    const user = userEvent.setup()
    const { session } = renderPage({ isHistoryLoading: true, historyError: '加载会话失败' })
    const log = screen.getByRole('log', { name: '会话内容' })
    expect(log).toHaveAttribute('aria-busy', 'true')
    expect(within(log).getByText('列出今天的任务')).toBeVisible()
    expect(within(log).getByRole('status')).toHaveTextContent('正在加载会话')
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('加载会话失败'))).toBe(true)
    await user.click(screen.getByRole('button', { name: '重试加载会话' }))
    expect(session.reloadHistory).toHaveBeenCalledTimes(1)
  })

  it('keeps the inspector read-only and aggregates only the current turn', () => {
    renderPage({
      turns: [makeTurn(), makeTurn({ id: 'turn-2', ordinal: 2, status: 'running', steps: [
        { id: 'a', label: '分析', status: 'completed' },
        { id: 'b', label: '更新', status: 'running' },
      ] })],
      status: 'running',
      canSend: false,
    })
    const inspector = screen.getByRole('complementary', { name: '会话检查器' })
    expect(inspector).toHaveTextContent('运行中')
    expect(inspector).toHaveTextContent('2 个步骤')
    expect(within(inspector).queryByRole('button')).not.toBeInTheDocument()
    expect(within(inspector).queryByLabelText('Agent 执行步骤')).not.toBeInTheDocument()
  })

  it('sends on Enter, preserves Shift+Enter, ignores IME composition, and trims whitespace', async () => {
    const user = userEvent.setup()
    const { session } = renderPage()
    const input = screen.getByRole('textbox', { name: '智能助手消息' })

    await user.type(input, '规划今日任务')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(session.send).not.toHaveBeenCalled()
    expect(input).toHaveValue('规划今日任务\n')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(session.send).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(session.send).toHaveBeenCalledWith('规划今日任务')
    expect(input).toHaveValue('')

    await user.type(input, '   ')
    await user.keyboard('{Enter}')
    expect(session.send).toHaveBeenCalledTimes(1)
  })

  it('disables mismatched/loading composers and exposes cancel while a request is active', async () => {
    const user = userEvent.setup()
    const { session } = renderPage({ status: 'running', canSend: false })
    expect(screen.getByRole('textbox', { name: '智能助手消息' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '取消执行' }))
    expect(session.cancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '发送消息' })).not.toBeInTheDocument()
  })

  it('confirms the header clear action before calling the shared session CRUD', async () => {
    const user = userEvent.setup()
    const { session } = renderPage()
    await user.click(screen.getByRole('button', { name: '清空对话' }))
    expect(session.clear).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: '清空当前会话' })
    await user.click(within(dialog).getByRole('button', { name: '确认清空' }))
    await waitFor(() => expect(session.clear).toHaveBeenCalledTimes(1))
  })

  it('collapses the side Agent on entry and restores the previous state on leave', async () => {
    const user = userEvent.setup()
    const value = makeSession()
    function Probe() {
      const { agentExpanded } = useShell()
      return <output>{agentExpanded ? '侧栏展开' : '侧栏收起'}</output>
    }
    function Harness() {
      const [show, setShow] = useState(true)
      return <><Probe /><button type="button" onClick={() => setShow(false)}>离开工作区</button>{show ? <AssistantPage /> : null}</>
    }
    renderWithProviders(<ShellProvider><AgentSessionProvider value={value}><Harness /></AgentSessionProvider></ShellProvider>)
    expect(await screen.findByText('侧栏收起')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '离开工作区' }))
    expect(await screen.findByText('侧栏展开')).toBeVisible()
  })
})
