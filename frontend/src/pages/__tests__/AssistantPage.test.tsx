import { beforeEach, describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithProviders } from '../../test/render'
import { AgentSessionProvider } from '../../features/agent/AgentSessionContext'
import type { AgentSessionValue } from '../../features/agent/agent.types'
import { ShellProvider } from '../../features/shell/ShellContext'
import { useShell } from '../../features/shell/shell-context'
import AssistantPage from '../AssistantPage'

function makeSession(value?: Partial<AgentSessionValue>): AgentSessionValue {
  return {
    sessionId: 'today',
    messages: [{ id: 'welcome', role: 'assistant', content: '今天先做什么？', createdAt: '2026-07-14T00:00:00Z' }],
    steps: [{ id: 'search', label: '查询未完成任务', status: 'completed', durationMs: 520, tool: 'list_todos' }],
    status: 'done', capabilities: { supportsStepRetry: false }, send: vi.fn(), retry: vi.fn(),
    confirm: vi.fn(), reject: vi.fn(), resolveConfirmation: vi.fn(), cancel: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
    ...value,
  }
}

function renderPage(value?: Partial<AgentSessionValue>) {
  const session = makeSession(value)
  return { session, result: renderWithProviders(<ShellProvider><AgentSessionProvider value={session}><AssistantPage /></AgentSessionProvider></ShellProvider>) }
}

describe('AssistantPage', () => {
  beforeEach(() => localStorage.clear())
  it('renders the page title', () => {
    renderPage()
    expect(screen.getByText('智能助手')).toBeInTheDocument()
  })

  it('renders sessions, current conversation, tool state and step timeline', () => {
    renderPage()
    expect(screen.getByRole('navigation', { name: 'Agent 会话' })).toBeVisible()
    expect(screen.getAllByText('今天先做什么？')[0]).toBeVisible()
    expect(screen.getByText('Todo API')).toBeVisible()
    expect(screen.getAllByText('查询未完成任务')[0]).toBeVisible()
  })

  it('renders the input field', () => {
    renderPage()
    expect(screen.getByPlaceholderText('告诉智能助手你想完成什么…')).toBeInTheDocument()
  })

  it('sends with the shared session and clears history', async () => {
    const user = userEvent.setup()
    const { session } = renderPage()
    await user.type(screen.getByPlaceholderText('告诉智能助手你想完成什么…'), '规划今日任务')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(session.send).toHaveBeenCalledWith('规划今日任务')
    await user.click(screen.getByRole('button', { name: '清空对话' }))
    expect(session.clear).toHaveBeenCalledTimes(1)
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
