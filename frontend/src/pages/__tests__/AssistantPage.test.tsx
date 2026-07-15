import { beforeEach, describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
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
    status: 'done', canSend: true, isClearing: false, capabilities: { supportsStepRetry: false }, send: vi.fn().mockReturnValue(true), canRetry: vi.fn().mockReturnValue(false), retry: vi.fn(),
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
    expect(screen.getAllByText('查询未完成任务')).toHaveLength(1)
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

  it('shows the real failed connection state instead of claiming the tools are online', () => {
    renderPage({
      status: 'failed',
      messages: [{ id: 'u', role: 'user', content: '保留请求', createdAt: '2026-07-14T00:00:00Z' }],
      steps: [{ id: 'client-connection', label: '连接智能助手', status: 'failed', errorCode: 'CONNECTION_CLOSED', errorMessage: '连接已断开' }],
    })
    expect(within(screen.getByLabelText('工具连接状态')).getByRole('alert')).toHaveTextContent('连接异常')
    expect(screen.getAllByText('保留请求')[0]).toBeVisible()
    expect(screen.queryByText('Agent Stream在线')).not.toBeInTheDocument()
  })

  it('derives Todo API status from observed tool steps and hides invalid timestamps', () => {
    renderPage({
      messages: [{ id: 'bad-date', role: 'assistant', content: '仍可显示', createdAt: 'invalid' }],
      steps: [{ id: 'tool-failed', label: '调用 Todo', status: 'failed', tool: 'list_todos', errorMessage: '接口异常' }],
      status: 'failed',
    })
    const tools = screen.getByLabelText('工具连接状态')
    expect(within(tools).getByText('调用异常')).toBeVisible()
    expect(screen.queryByText(/Invalid Date|NaN/)).not.toBeInTheDocument()
  })

  it('keeps the single interactive timeline inside the conversation at every viewport', () => {
    renderPage({ steps: [{ id: 'confirm', label: '删除任务', status: 'waiting_confirmation', confirmationId: 'c', confirmationMessage: '确认删除？' }] })
    const conversation = screen.getByRole('log')
    expect(within(conversation).getByRole('button', { name: '确认删除任务' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: '确认删除任务' })).toHaveLength(1)
    expect(screen.getAllByLabelText('Agent 执行步骤')).toHaveLength(1)
  })

  it('reports an in-flight Todo tool call instead of an unverified connection', () => {
    renderPage({ status: 'running', steps: [{ id: 'tool', label: '查询', status: 'running', tool: 'list_todos' }] })
    expect(within(screen.getByLabelText('工具连接状态')).getByText('正在调用')).toBeVisible()
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

  it('restores the exact collapsed state even if the standalone page opens Agent state internally', async () => {
    localStorage.setItem('todolist.preferences', JSON.stringify({ language: 'zh-CN', theme: 'system', agentStartsOpen: false, reducedMotion: null }))
    localStorage.setItem('todolist:shell', JSON.stringify({ navExpanded: false, agentExpanded: false }))
    const user = userEvent.setup()
    const value = makeSession()
    function Harness() {
      const [show, setShow] = useState(true)
      const { agentExpanded, openAgent } = useShell()
      return <><output>{agentExpanded ? '展开' : '收起'}</output><button onClick={openAgent}>内部展开</button><button onClick={() => setShow(false)}>离开</button>{show ? <AssistantPage /> : null}</>
    }
    renderWithProviders(<ShellProvider><AgentSessionProvider value={value}><Harness /></AgentSessionProvider></ShellProvider>)
    await user.click(screen.getByRole('button', { name: '内部展开' }))
    await user.click(screen.getByRole('button', { name: '离开' }))
    expect(await screen.findByText('收起')).toBeVisible()
  })
})
