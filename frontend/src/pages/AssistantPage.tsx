import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import ConfirmDialog from '../components/common/ConfirmDialog'
import AgentSessionList from '../features/agent/AgentSessionList'
import AgentTurn from '../features/agent/AgentTurn'
import { useAgentSessionContext } from '../features/agent/agent-session-context'
import { getAgentStatusPresentation, getTodoToolPresentation } from '../features/agent/agent-status'
import type { AgentTurnStatus } from '../features/agent/agent.types'
import { getAgentScrollRevision, useAgentAutoScroll } from '../features/agent/useAgentAutoScroll'
import { useExpandableTextarea } from '../features/agent/useExpandableTextarea'
import { useShell } from '../features/shell/shell-context'
import { Button } from '../shared/ui/Button'

const turnStatusLabels: Record<AgentTurnStatus, string> = {
  running: '运行中',
  waiting_confirmation: '等待确认',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
}

export default function AssistantPage() {
  const session = useAgentSessionContext()
  const { agentExpanded, setAgentExpanded } = useShell()
  const restoreExpanded = useRef(agentExpanded)
  const [draft, setDraft] = useState('')
  const [clearOpen, setClearOpen] = useState(false)
  const [clearError, setClearError] = useState('')
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false)
  const {
    ref: composerRef,
    reset: resetComposer,
    onPointerDown: handleComposerPointerDown,
    onPointerUp: handleComposerPointerUp,
  } = useExpandableTextarea(draft)
  const agentStatus = getAgentStatusPresentation(session.status, session.steps)
  const todoStatus = getTodoToolPresentation(session.steps)
  const turns = useMemo(
    () => session.turns.map((turn, index) => ({ turn, index })).sort((a, b) => a.turn.ordinal - b.turn.ordinal || a.index - b.index).map(({ turn }) => turn),
    [session.turns],
  )
  const currentTurn = turns.at(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const revision = getAgentScrollRevision(session)
  const latestMessage = session.messages.at(-1)
  const latestUserMessage = [...session.messages].reverse().find((message) => message.role === 'user')
  const autoScroll = useAgentAutoScroll(scrollRef, endRef, revision, {
    forceFollowKey: session.displayedSessionId ?? 'new-session',
    userMessageKey: latestUserMessage?.id,
    messageKey: latestMessage?.id,
  })
  const active = session.status === 'connecting' || session.status === 'running' || session.status === 'waiting_confirmation'

  useEffect(() => {
    const shouldRestore = restoreExpanded.current
    setAgentExpanded(false)
    return () => setAgentExpanded(shouldRestore)
  }, [setAgentExpanded])

  function send() {
    const message = draft.trim()
    if (!message || !session.canSend) return
    if (session.send(message)) {
      setDraft('')
      resetComposer()
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    send()
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    send()
  }

  async function clear() {
    setClearError('')
    try {
      await session.clear()
      setClearOpen(false)
    } catch {
      setClearError('清空失败，对话记录已保留。')
    }
  }

  const sessionList = (
    <AgentSessionList
      sessions={session.sessions}
      selectedSessionId={session.displayedSessionId}
      isLoading={session.isHistoryLoading}
      historyError={session.historyError}
      onSelect={(sessionId) => { setMobileSessionsOpen(false); session.selectSession(sessionId) }}
      onCreate={() => session.createSession()}
      onRetry={() => { void session.reloadHistory() }}
      onRename={session.renameSession}
      onDelete={session.deleteSession}
    />
  )

  return (
    <div className="assistant-workspace">
      <aside id="assistant-session-drawer" className="assistant-sessions" data-open={mobileSessionsOpen || undefined} aria-label="会话列表">
        <header>
          <span className="agent-spark" aria-hidden="true">✦</span><strong>Agent</strong>
          <button type="button" className="assistant-sessions__close" aria-label="关闭会话列表" onClick={() => setMobileSessionsOpen(false)}>×</button>
        </header>
        {sessionList}
        <section aria-label="工具连接状态">
          <p>工具连接</p>
          <div data-tone={todoStatus.tone} role={todoStatus.isError ? 'alert' : undefined}><span aria-hidden="true" /> <strong>Todo API</strong><small>{todoStatus.label}</small></div>
          <div data-tone={agentStatus.tone} role={agentStatus.isError ? 'alert' : undefined}><span aria-hidden="true" /> <strong>Agent Stream</strong><small>{agentStatus.label}</small></div>
        </section>
      </aside>

      <section className="assistant-conversation" id="current">
        <header className="assistant-conversation__header">
          <Button
            className="assistant-sessions__open"
            variant="ghost"
            size="sm"
            aria-label="打开会话列表"
            aria-controls="assistant-session-drawer"
            aria-expanded={mobileSessionsOpen}
            onClick={() => setMobileSessionsOpen(true)}
          >会话</Button>
          <div><p>WORKSPACE / TODAY</p><h1>智能助手</h1><span>{agentStatus.label}</span></div>
          <Button variant="ghost" size="sm" disabled={session.isClearing || !session.displayedSessionId} onClick={() => { setClearError(''); setClearOpen(true) }}>
            {session.isClearing ? '正在清空…' : '清空对话'}
          </Button>
        </header>

        <div
          ref={scrollRef}
          className="assistant-conversation__scroll"
          role="log"
          aria-label="会话内容"
          aria-live={session.isHistoryLoading ? 'off' : 'polite'}
          aria-busy={session.isHistoryLoading || undefined}
          onScroll={autoScroll.onScroll}
        >
          <div className="assistant-conversation__content">
          {clearError ? <p className="assistant-clear-error" role="alert">{clearError}</p> : null}
          {session.historyError ? <p className="assistant-history-error" role="alert">{session.historyError}，对话记录已保留。</p> : null}
          {session.isHistoryLoading ? <p className="assistant-history-loading" role="status">正在加载会话…</p> : null}
          {!turns.length && !session.isHistoryLoading ? (
            <div className="assistant-empty"><span aria-hidden="true">✦</span><h2>从一句话开始</h2><p>创建任务、调整安排，或让我梳理今天的优先级。</p></div>
          ) : null}
          {turns.map((turn) => {
            const isCurrent = turn.id === currentTurn?.id
            const pendingConfirmationId = isCurrent
              ? turn.steps.find((step) => step.status === 'waiting_confirmation' && step.confirmationId)?.confirmationId
              : undefined
            return (
              <AgentTurn
                key={turn.id}
                turn={turn}
                pendingConfirmationId={pendingConfirmationId}
                canRetry={isCurrent ? session.canRetry : undefined}
                canConfirm={isCurrent ? session.canConfirm : undefined}
                onRetry={isCurrent ? session.retry : undefined}
                onConfirm={isCurrent ? session.confirm : undefined}
                onReject={isCurrent ? session.reject : undefined}
              />
            )
          })}
          {autoScroll.showReturnToBottom ? (
            <Button className="assistant-scroll-return" size="sm" variant="secondary" onClick={autoScroll.returnToBottom}>
              {autoScroll.hasNewMessage ? '有新消息，回到底部' : '回到底部'}
            </Button>
          ) : null}
          <div ref={endRef} className="assistant-conversation__end" aria-hidden="true" />
          </div>
        </div>

        <form className="assistant-composer" onSubmit={submit}>
          <textarea
            ref={composerRef}
            className="assistant-composer__input"
            aria-label="智能助手消息"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            onPointerDown={handleComposerPointerDown}
            onPointerUp={handleComposerPointerUp}
            placeholder="告诉智能助手你想完成什么…"
            rows={2}
            disabled={!session.canSend}
          />
          <footer>
            <span>Enter 发送 · Shift + Enter 换行</span>
            {active ? (
              <Button type="button" variant="secondary" aria-label="取消执行" onClick={session.cancel}>取消</Button>
            ) : (
              <Button type="submit" disabled={!draft.trim() || !session.canSend} aria-label="发送消息">发送 <span aria-hidden="true">↗</span></Button>
            )}
          </footer>
        </form>
      </section>

      <aside className="assistant-inspector" aria-label="会话检查器">
        <p>当前回合</p>
        <h2>{currentTurn ? turnStatusLabels[currentTurn.status] : '等待新指令'}</h2>
        <p>{currentTurn ? `${currentTurn.steps.length} 个步骤` : '发送指令后将在对话区显示执行过程'}</p>
      </aside>

      <ConfirmDialog
        isOpen={clearOpen}
        title="清空当前会话"
        message="将删除当前会话及其执行记录，此操作无法撤销。"
        confirmLabel="确认清空"
        onConfirm={() => { void clear() }}
        onCancel={() => { if (!session.isClearing) setClearOpen(false) }}
        pending={session.isClearing}
      />
    </div>
  )
}
