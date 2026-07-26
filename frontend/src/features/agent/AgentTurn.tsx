import { useEffect, useId, useRef, useState } from 'react'
import { AgentMarkdown } from './AgentMarkdown'
import AgentStepTimeline from './AgentStepTimeline'
import type { AgentStep, AgentTurn as AgentTurnModel, AgentTurnStatus } from './agent.types'

const turnStatusLabels: Record<AgentTurnStatus, string> = {
  running: '运行中',
  waiting_confirmation: '等待确认',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
}

const stepStatusPriority: AgentStep['status'][] = [
  'failed',
  'waiting_confirmation',
  'interrupted',
  'running',
  'waiting',
  'completed',
]

const stepStatusLabels: Record<AgentStep['status'], string> = {
  waiting: '等待中',
  running: '运行中',
  waiting_confirmation: '等待确认',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
}

function isAttentionStatus(status: AgentTurnStatus) {
  return status !== 'completed'
}

function aggregateStatus(turn: AgentTurnModel) {
  if (turn.status !== 'completed') return turnStatusLabels[turn.status]
  const status = stepStatusPriority.find((candidate) => turn.steps.some((step) => step.status === candidate))
  return status ? stepStatusLabels[status] : turnStatusLabels[turn.status]
}

function formatTotalDuration(steps: AgentStep[]) {
  const duration = steps.reduce((total, step) => total + (step.durationMs ?? 0), 0)
  if (duration === 0) return null
  return duration < 1000 ? `${duration} 毫秒` : `${(duration / 1000).toFixed(1)} 秒`
}

export interface AgentTurnProps {
  turn: AgentTurnModel
  pendingConfirmationId?: string
  canRetry?(stepId: string): boolean
  canConfirm?(confirmationId: string): boolean
  onRetry?(stepId: string): void
  onConfirm?(confirmationId: string): boolean | Promise<boolean>
  onReject?(confirmationId: string): boolean | Promise<boolean>
}

const noop = () => undefined

export default function AgentTurn({
  turn,
  pendingConfirmationId,
  canRetry,
  canConfirm,
  onRetry = noop,
  onConfirm,
  onReject,
}: AgentTurnProps) {
  const disclosureId = useId()
  const buttonId = `${disclosureId}-button`
  const regionId = `${disclosureId}-region`
  const previousStatus = useRef(turn.status)
  const [expanded, setExpanded] = useState(() => isAttentionStatus(turn.status))
  const [pendingAction, setPendingAction] = useState<{ key: string; id: string }>()
  const [submittingAction, setSubmittingAction] = useState<{ key: string; id: string }>()
  const [actionError, setActionError] = useState<{ key: string; message: string }>()

  useEffect(() => {
    if (previousStatus.current === turn.status) return
    previousStatus.current = turn.status
    setExpanded(isAttentionStatus(turn.status))
  }, [turn.status])

  const userMessages = turn.messages.filter((message) => message.role === 'user')
  const assistantMessages = turn.messages.filter((message) => message.role === 'assistant')
  const auxiliaryMessages = turn.messages.filter((message) => message.role === 'system' || message.role === 'tool')
  const totalDuration = formatTotalDuration(turn.steps)
  const retryAllowed = (stepId: string) => canRetry?.(stepId) === true
  const activeRetryStepId = turn.resultUncertain
    ? null
    : turn.steps.find((step) => step.status === 'failed' && step.retryable && retryAllowed(step.id))?.id ?? null
  const matchingConfirmationId = turn.resultUncertain
    || turn.status !== 'waiting_confirmation'
    || !onConfirm
    || !onReject
    || !pendingConfirmationId
    ? null
    : turn.steps.find((step) => step.status === 'waiting_confirmation' && step.confirmationId === pendingConfirmationId)?.confirmationId ?? null
  const activeConfirmationId = matchingConfirmationId && canConfirm?.(matchingConfirmationId) === true
    ? matchingConfirmationId
    : null
  const actionableKey = `${activeRetryStepId ?? ''}:${activeConfirmationId ?? ''}`

  const acceptedActionId = pendingAction?.key === actionableKey ? pendingAction.id : undefined
  const submittingActionId = submittingAction?.key === actionableKey ? submittingAction.id : undefined
  const pendingActionId = acceptedActionId ?? submittingActionId
  const visibleActionError = actionError?.key === actionableKey ? actionError.message : undefined

  const submitRetry = (stepId: string) => {
    if (pendingActionId) return
    setPendingAction({ key: actionableKey, id: stepId })
    onRetry(stepId)
  }
  const submitConfirmation = async (confirmationId: string, approved: boolean) => {
    if (pendingActionId) return
    const submission = { key: actionableKey, id: confirmationId }
    setActionError(undefined)
    setSubmittingAction(submission)
    try {
      const accepted = await (approved ? onConfirm?.(confirmationId) : onReject?.(confirmationId))
      if (accepted === true) setPendingAction(submission)
      else setActionError({ key: actionableKey, message: '操作未发送，请重试。' })
    } catch (error) {
      setActionError({
        key: actionableKey,
        message: error instanceof Error && error.message ? error.message : '操作未发送，请重试。',
      })
    } finally {
      setSubmittingAction((current) => current?.key === submission.key && current.id === submission.id ? undefined : current)
    }
  }

  return (
    <section className="agent-turn" data-testid={`agent-turn-${turn.id}`} data-status={turn.status}>
      {userMessages.map((message) => (
        <article key={message.id} className="agent-turn__message agent-turn__message--user" data-role="user" aria-label="用户消息">
          <p>{message.content}</p>
        </article>
      ))}
      {assistantMessages.map((message) => (
        <article key={message.id} className="agent-turn__message agent-turn__message--assistant" data-role="assistant" aria-label="助手回复">
          <AgentMarkdown content={message.content} />
        </article>
      ))}
      <div className="agent-turn__details" data-part="execution-details">
        {turn.resultUncertain ? (
          <p className="agent-turn__uncertain" role="alert">操作可能已生效，请检查任务状态。</p>
        ) : null}
        {visibleActionError ? <p className="agent-turn__uncertain" role="alert">{visibleActionError}</p> : null}
        <button
          id={buttonId}
          type="button"
          className="agent-turn__disclosure"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>执行详情</span>
          <span>{turn.steps.length} 个步骤</span>
          <span>{aggregateStatus(turn)}</span>
          {totalDuration ? <span className="tabular-nums">{totalDuration}</span> : null}
          <span className="agent-turn__chevron" aria-hidden="true">⌄</span>
        </button>
        <div
          id={regionId}
          className="agent-turn__region"
          role="region"
          aria-labelledby={buttonId}
          hidden={!expanded}
        >
          {auxiliaryMessages.length ? (
            <section className="agent-turn__auxiliary" aria-label="辅助执行消息">
              {auxiliaryMessages.map((message) => <p key={message.id}>{message.content}</p>)}
            </section>
          ) : null}
          <AgentStepTimeline
            steps={turn.steps}
            canRetry={retryAllowed}
            activeRetryStepId={activeRetryStepId}
            activeConfirmationId={activeConfirmationId}
            pendingActionId={pendingActionId}
            onRetry={submitRetry}
            onConfirm={(confirmationId) => { void submitConfirmation(confirmationId, true) }}
            onReject={(confirmationId) => { void submitConfirmation(confirmationId, false) }}
          />
        </div>
      </div>
    </section>
  )
}
