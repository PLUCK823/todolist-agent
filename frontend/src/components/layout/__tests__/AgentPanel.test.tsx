import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import AgentPanel from '../AgentPanel'
import type { AgentMessage } from '../AgentPanel'

const mockMessages: AgentMessage[] = [
  { role: 'user', content: '帮我创建一个明天到期的任务', timestamp: '2026-07-13T10:00:00Z' },
  { role: 'assistant', content: '好的，已为你创建任务"完成报告"，截止日期为明天。', timestamp: '2026-07-13T10:00:02Z' },
]

describe('AgentPanel', () => {
  it('renders the header title', () => {
    render(<AgentPanel messages={[]} onSend={vi.fn()} isLoading={false} />)
    expect(screen.getByText('AI 助手')).toBeInTheDocument()
  })

  it('has correct aside landmark role', () => {
    render(<AgentPanel messages={[]} onSend={vi.fn()} isLoading={false} />)
    const aside = screen.getByRole('complementary', { name: 'AI 助手面板' })
    expect(aside).toBeInTheDocument()
  })

  it('renders empty state when there are no messages', () => {
    render(<AgentPanel messages={[]} onSend={vi.fn()} isLoading={false} />)
    expect(screen.getByText(/输入你想做的事情/)).toBeInTheDocument()
  })

  it('renders user and assistant messages', () => {
    render(<AgentPanel messages={mockMessages} onSend={vi.fn()} isLoading={false} />)
    expect(screen.getByText('帮我创建一个明天到期的任务')).toBeInTheDocument()
    expect(screen.getByText('好的，已为你创建任务"完成报告"，截止日期为明天。')).toBeInTheDocument()
  })

  it('renders timestamps on messages when provided', () => {
    render(<AgentPanel messages={mockMessages} onSend={vi.fn()} isLoading={false} />)
    const times = screen.getAllByRole('time')
    expect(times).toHaveLength(2)
  })

  it('does not render timestamps when not provided', () => {
    const noTimestamps: AgentMessage[] = [
      { role: 'user', content: 'hello' },
    ]
    render(<AgentPanel messages={noTimestamps} onSend={vi.fn()} isLoading={false} />)
    expect(screen.queryByRole('time')).not.toBeInTheDocument()
  })

  it('renders a textarea for input', () => {
    render(<AgentPanel messages={[]} onSend={vi.fn()} isLoading={false} />)
    const textarea = screen.getByLabelText('消息输入框')
    expect(textarea).toBeInTheDocument()
    expect(textarea.tagName).toBe('TEXTAREA')
  })

  it('renders a send button', () => {
    render(<AgentPanel messages={[]} onSend={vi.fn()} isLoading={false} />)
    const sendButton = screen.getByLabelText('发送消息')
    expect(sendButton).toBeInTheDocument()
    expect(sendButton.tagName).toBe('BUTTON')
  })

  it('send button is disabled when input is empty', () => {
    render(<AgentPanel messages={[]} onSend={vi.fn()} isLoading={false} />)
    const sendButton = screen.getByLabelText('发送消息')
    expect(sendButton).toBeDisabled()
  })

  it('calls onSend when send button is clicked with text', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()

    render(<AgentPanel messages={[]} onSend={onSend} isLoading={false} />)
    const textarea = screen.getByLabelText('消息输入框')
    const sendButton = screen.getByLabelText('发送消息')

    await user.type(textarea, '添加一个任务')
    expect(sendButton).not.toBeDisabled()

    await user.click(sendButton)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('添加一个任务')
  })

  it('calls onSend when Enter is pressed (without Shift)', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()

    render(<AgentPanel messages={[]} onSend={onSend} isLoading={false} />)
    const textarea = screen.getByLabelText('消息输入框')

    await user.type(textarea, '完成项目报告')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('完成项目报告')
  })

  it('clears input after sending', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()

    render(<AgentPanel messages={[]} onSend={onSend} isLoading={false} />)
    const textarea = screen.getByLabelText('消息输入框') as HTMLTextAreaElement

    await user.type(textarea, '测试消息')
    expect(textarea.value).toBe('测试消息')

    await user.keyboard('{Enter}')
    expect(textarea.value).toBe('')
  })

  it('disables input and send button when isLoading is true', () => {
    render(<AgentPanel messages={[]} onSend={vi.fn()} isLoading={true} />)
    const textarea = screen.getByLabelText('消息输入框')
    const sendButton = screen.getByLabelText('发送消息')

    expect(textarea).toBeDisabled()
    expect(sendButton).toBeDisabled()
  })

  it('shows loading indicator when isLoading is true', () => {
    render(<AgentPanel messages={[]} onSend={vi.fn()} isLoading={true} />)
    expect(screen.getByLabelText('AI 思考中')).toBeInTheDocument()
  })

  it('does not show loading indicator when isLoading is false', () => {
    render(<AgentPanel messages={[]} onSend={vi.fn()} isLoading={false} />)
    expect(screen.queryByLabelText('AI 思考中')).not.toBeInTheDocument()
  })

  it('does not call onSend when isLoading and send button is clicked', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()

    render(<AgentPanel messages={[]} onSend={onSend} isLoading={true} />)
    const sendButton = screen.getByLabelText('发送消息')

    await user.click(sendButton)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('renders messages area with correct ARIA attributes', () => {
    render(<AgentPanel messages={mockMessages} onSend={vi.fn()} isLoading={false} />)
    const messagesArea = screen.getByRole('log')
    expect(messagesArea).toHaveAttribute('aria-live', 'polite')
    expect(messagesArea).toHaveAttribute('aria-label', '对话消息')
  })

  it('has correct fixed panel width', () => {
    render(<AgentPanel messages={[]} onSend={vi.fn()} isLoading={false} />)
    const aside = screen.getByRole('complementary', { name: 'AI 助手面板' })
    expect(aside.className).toContain('w-[320px]')
    expect(aside.className).toContain('fixed')
  })
})
