import { useState, useRef, useEffect, useCallback } from 'react'

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
}

interface AgentPanelProps {
  messages: AgentMessage[]
  onSend: (message: string) => void
  isLoading: boolean
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="AI 思考中">
      <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-text-secondary)]" style={{ animationDelay: '0ms' }} />
      <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-text-secondary)]" style={{ animationDelay: '150ms' }} />
      <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-text-secondary)]" style={{ animationDelay: '300ms' }} />
    </span>
  )
}

export default function AgentPanel({ messages, onSend, isLoading }: AgentPanelProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isLoading, scrollToBottom])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return
    onSend(trimmed)
    setInput('')
  }, [input, isLoading, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const formatTime = (timestamp?: string): string => {
    if (!timestamp) return ''
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  return (
    <aside
      className="fixed right-0 top-0 flex h-screen w-[320px] flex-col bg-[var(--color-agent-bg)] z-20"
      aria-label="AI 助手面板"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 px-5 py-4">
        <h2 className="text-base font-semibold text-white">AI 助手</h2>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4" role="log" aria-live="polite" aria-label="对话消息">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--color-text-secondary)]">
              输入你想做的事情，我会帮你管理任务
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`mb-4 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed break-words ${
                msg.role === 'user'
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-white/10 text-white'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.timestamp && (
                <time
                  className={`mt-1 block text-[10px] ${
                    msg.role === 'user'
                      ? 'text-white/60'
                      : 'text-white/40'
                  }`}
                  dateTime={msg.timestamp}
                >
                  {formatTime(msg.timestamp)}
                </time>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="mb-4 flex justify-start">
            <div className="max-w-[85%] rounded-lg bg-white/10 px-4 py-3">
              <LoadingDots />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-white/10 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送..."
            disabled={isLoading}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-50"
            aria-label="消息输入框"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="发送消息"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </aside>
  )
}
