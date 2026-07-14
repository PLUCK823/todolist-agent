import { useRef, useState, type KeyboardEvent } from 'react'
import { IconButton } from '../../shared/ui/IconButton'
import AgentStepTimeline from './AgentStepTimeline'
import { useAgentSessionContext } from './agent-session-context'
import { getAgentStatusPresentation } from './agent-status'
import { formatAgentMessageTime } from './agent-display'
import { getAgentScrollRevision, useAgentAutoScroll } from './useAgentAutoScroll'

const suggestions = ['查看未完成任务', '创建明日计划']

function SendIcon() {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="m3.5 4 13 6-13 6 2-6-2-6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M5.5 10h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
}

export default function AgentPanel({ onCollapse, draft: controlledDraft, onDraftChange }: { onCollapse(): void; draft?: string; onDraftChange?(draft: string): void }) {
  const session = useAgentSessionContext()
  const [internalDraft, setInternalDraft] = useState('')
  const [clearError, setClearError] = useState('')
  const draft = controlledDraft ?? internalDraft
  const setDraft = onDraftChange ?? setInternalDraft
  const endRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const status = getAgentStatusPresentation(session.status, session.steps)

  const revision = getAgentScrollRevision(session)
  const onScroll = useAgentAutoScroll(bodyRef, endRef, revision)

  function send() {
    const message = draft.trim()
    if (!message || !session.canSend) return
    if (session.send(message)) setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  async function clearConversation() {
    setClearError('')
    try { await session.clear() } catch { setClearError('清空失败，对话记录已保留。') }
  }

  return (
    <aside className="agent-panel" aria-label="智能助手面板">
      <header className="agent-panel__header">
        <IconButton label="收起智能助手" tone="primary" icon={<span className="agent-spark">✦</span>} onClick={onCollapse} />
        <div><h2>智能助手</h2><p role={status.isError ? 'alert' : 'status'} data-tone={status.tone}><span aria-hidden="true" />{status.label}</p></div>
        <button type="button" className="agent-panel__clear" disabled={session.isClearing} onClick={() => void clearConversation()}>{session.isClearing ? '清空中…' : '清空对话'}</button>
      </header>

      <div ref={bodyRef} className="agent-panel__body" role="log" aria-live="polite" aria-label="对话消息" onScroll={onScroll}>
        {clearError ? <p className="agent-panel__clear-error" role="alert">{clearError}</p> : null}
        {!session.messages.length ? (
          <section className="agent-panel__welcome">
            <span className="agent-panel__eyebrow">TODAY / FOCUS</span>
            <h3>今天要做什么？</h3>
            <p>直接告诉我你的想法。我会把每一步执行状态清晰地留在这里。</p>
          </section>
        ) : null}
        <div className="agent-panel__suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion} disabled={!session.canSend} onClick={() => session.send(suggestion)}>{suggestion}</button>)}</div>
        {session.messages.map((message) => {
          const time = formatAgentMessageTime(message.createdAt)
          return (
          <article key={message.id} className="agent-message" data-role={message.role}>
            <p>{message.content}</p>
            {time ? <time dateTime={message.createdAt}>{time}</time> : null}
          </article>
          )
        })}
        <AgentStepTimeline steps={session.steps} capabilities={session.capabilities} canRetry={session.canRetry} onRetry={session.retry} onConfirm={session.confirm} onReject={session.reject} />
        <div ref={endRef} />
      </div>

      <footer className="agent-panel__composer">
        <div>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="输入消息或指令…" aria-label="消息输入框" rows={2} disabled={!session.canSend} />
          <IconButton label="发送消息" tone="primary" icon={<SendIcon />} disabled={!draft.trim() || !session.canSend} onClick={send} />
        </div>
        <p>Enter 发送 · Shift + Enter 换行</p>
      </footer>
    </aside>
  )
}
