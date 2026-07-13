import { useState, useRef, useEffect, type FormEvent } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

const WELCOME_MESSAGE: Message = {
  role: 'assistant',
  content: '你好！我是你的智能待办助手。你可以告诉我任何关于任务的事情，比如：\n\n- "帮我创建一个高优先级的任务：明天下午开会"\n- "显示我所有未完成的任务"\n- "把「买牛奶」标记为已完成"',
  timestamp: new Date().toISOString(),
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    } catch {
      // scrollIntoView not supported in test environment (jsdom)
      messagesEndRef.current?.scrollIntoView?.()
    }
  }, [messages])

  const handleSend = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    const userMsg: Message = {
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsLoading(true)

    // Simulate agent response (in production this calls the real API)
    setTimeout(() => {
      const assistantMsg: Message = {
        role: 'assistant',
        content: `收到！你说的是："${trimmed}"。\n\n（Agent 服务正在开发中，此功能即将上线。届时你可以通过 WebSocket 实时看到 Agent 的思考和执行过程。）`,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, assistantMsg])
      setIsLoading(false)
    }, 1500)
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#f7f7f9' }}>
      {/* Header */}
      <div
        className="px-6 py-4 border-b flex items-center gap-3"
        style={{ borderColor: '#e5e7eb', backgroundColor: '#ffffff' }}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-lg font-bold"
          style={{ backgroundColor: '#7165ea' }}
        >
          AI
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#1a1a2e' }}>
            智能助手
          </h1>
          <p className="text-xs" style={{ color: '#6b7280' }}>
            {isLoading ? '正在思考...' : '随时为你服务'}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'text-white'
                  : 'bg-white border'
              }`}
              style={
                msg.role === 'user'
                  ? { backgroundColor: '#7165ea' }
                  : { borderColor: '#e5e7eb', color: '#1a1a2e' }
              }
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div
              className="bg-white border rounded-xl px-4 py-3"
              style={{ borderColor: '#e5e7eb' }}
            >
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#7165ea', animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#7165ea', animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#7165ea', animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t bg-white" style={{ borderColor: '#e5e7eb' }}>
        <form onSubmit={handleSend} className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入你想做的事情，比如：帮我创建一个任务..."
            className="flex-1 px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2"
            style={{
              borderColor: '#e5e7eb',
              color: '#1a1a2e',
            }}
            disabled={isLoading}
            onFocus={(e) => (e.target.style.borderColor = '#7165ea')}
            onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-6 py-3 rounded-xl text-white font-medium text-sm transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#7165ea' }}
          >
            发送
          </button>
        </form>
      </div>
    </div>
  )
}
