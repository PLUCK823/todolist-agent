import { useEffect, useRef, useState, type FormEvent } from 'react'
import AgentStepTimeline from '../features/agent/AgentStepTimeline'
import { useAgentSessionContext } from '../features/agent/agent-session-context'
import { getAgentStatusPresentation } from '../features/agent/agent-status'
import { useShell } from '../features/shell/shell-context'
import { Button } from '../shared/ui/Button'

export default function AssistantPage() {
  const session = useAgentSessionContext()
  const { agentExpanded, setAgentExpanded } = useShell()
  const restoreExpanded = useRef(agentExpanded)
  const [draft, setDraft] = useState('')
  const [clearError, setClearError] = useState('')
  const agentStatus = getAgentStatusPresentation(session.status, session.steps)

  useEffect(() => {
    const shouldRestore = restoreExpanded.current
    setAgentExpanded(false)
    return () => setAgentExpanded(shouldRestore)
  }, [setAgentExpanded])

  function submit(event: FormEvent) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || !session.canSend) return
    if (session.send(message)) setDraft('')
  }

  async function clear() {
    setClearError('')
    try { await session.clear() } catch { setClearError('清空失败，对话记录已保留。') }
  }

  return (
    <main className="assistant-workspace">
      <aside className="assistant-sessions">
        <header><span className="agent-spark" aria-hidden="true">✦</span><strong>Agent</strong></header>
        <nav aria-label="Agent 会话">
          <p>会话</p>
          <a href="#current" aria-current="page"><span>今天</span><strong>{session.messages.at(-1)?.content || '新对话'}</strong><small>{session.sessionId ? '当前会话' : '尚未开始'}</small></a>
        </nav>
        <section aria-label="工具连接状态">
          <p>工具连接</p>
          <div><span aria-hidden="true" /> <strong>Todo API</strong><small>已连接</small></div>
          <div data-tone={agentStatus.tone} role={agentStatus.isError ? 'alert' : undefined}><span aria-hidden="true" /> <strong>Agent Stream</strong><small>{agentStatus.label}</small></div>
        </section>
      </aside>

      <section className="assistant-conversation" id="current">
        <header>
          <div><p>WORKSPACE / TODAY</p><h1>智能助手</h1><span>{agentStatus.label}</span></div>
          <Button variant="ghost" size="sm" disabled={session.isClearing} onClick={() => void clear()}>{session.isClearing ? '正在清空…' : '清空对话'}</Button>
        </header>
        {clearError ? <p className="assistant-clear-error" role="alert">{clearError}</p> : null}
        <div className="assistant-conversation__scroll" role="log" aria-live="polite">
          {!session.messages.length ? <div className="assistant-empty"><span aria-hidden="true">✦</span><h2>从一句话开始</h2><p>创建任务、调整安排，或让我梳理今天的优先级。</p></div> : null}
          {session.messages.map((message) => <article key={message.id} className="assistant-message" data-role={message.role}><span>{message.role === 'assistant' ? '✦' : '你'}</span><div><p>{message.content}</p><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div></article>)}
        </div>
        <form className="assistant-composer" onSubmit={submit}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="告诉智能助手你想完成什么…" rows={4} disabled={!session.canSend} />
          <footer><span>Agent 会展示调用工具与等待结果的全过程</span><Button type="submit" disabled={!draft.trim() || !session.canSend} aria-label="发送消息">发送 <span aria-hidden="true">↗</span></Button></footer>
        </form>
      </section>

      <aside className="assistant-inspector" aria-label="执行详情">
        <p>执行详情</p>
        <h2>{session.steps.length ? '当前任务轨迹' : '等待新指令'}</h2>
        <AgentStepTimeline steps={session.steps} capabilities={session.capabilities} onRetry={session.retry} onConfirm={session.confirm} onReject={session.reject} />
      </aside>
    </main>
  )
}
