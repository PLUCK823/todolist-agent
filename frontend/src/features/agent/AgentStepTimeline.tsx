import { useEffect, useState } from 'react'
import { Button } from '../../shared/ui/Button'
import type { AgentCapabilities, AgentStep } from './agent.types'
import { safeSerializeAgentResult } from './agent-display'

const statusLabels: Record<AgentStep['status'], string> = {
  waiting: '等待中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
  waiting_confirmation: '等待确认',
}

function formatDuration(durationMs: number) {
  return durationMs < 1000 ? `${durationMs} 毫秒` : `${(durationMs / 1000).toFixed(1)} 秒`
}

function ActionResult({ label, content, truncated }: { label: string; content: string; truncated?: boolean }) {
  return (
    <section className="agent-step__result" aria-label={`${label} 执行结果`}>
      <span>{label}</span>
      <pre>{content}</pre>
      {truncated ? <small>结果已截断</small> : null}
    </section>
  )
}

function AgentStepItem({ step, retryAllowed, confirmationAllowed, actionPending, onRetry, onConfirm, onReject }: {
  step: AgentStep
  retryAllowed: boolean
  confirmationAllowed: boolean
  actionPending: boolean
  onRetry(stepId: string): void
  onConfirm(confirmationId: string): void
  onReject(confirmationId: string): void
}) {
  const [now, setNow] = useState(() => Date.now())
  const startedAt = step.startedAt ? Date.parse(step.startedAt) : Number.NaN
  useEffect(() => {
    if (step.status !== 'running' || !Number.isFinite(startedAt)) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [startedAt, step.status])

  const elapsed = step.durationMs ?? (Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : undefined)
  return (
    <li className="agent-step" data-status={step.status}>
      <span className="agent-step__marker" aria-hidden="true" />
      <div className="agent-step__body">
        <div className="agent-step__heading">
          <strong>{step.label}</strong>
          <span>{statusLabels[step.status]}</span>
        </div>
        {elapsed !== undefined ? <time className="agent-step__timer tabular-nums" aria-hidden="true">{formatDuration(elapsed)}</time> : null}
        {step.tool ? <code className="agent-step__tool">{step.tool}</code> : null}
        {step.errorMessage ? <p className="agent-step__error">{step.errorMessage}</p> : null}
        {step.result !== undefined || step.resultPreview !== undefined ? (
          <ActionResult
            label={step.action ?? step.tool ?? step.label}
            content={step.result !== undefined ? safeSerializeAgentResult(step.result) : step.resultPreview ?? ''}
            truncated={step.resultTruncated}
          />
        ) : null}
        {step.status === 'failed' && step.retryable && retryAllowed ? (
          <Button variant="secondary" size="sm" disabled={actionPending} onClick={() => onRetry(step.id)} aria-label={`重试${step.label}`}>重试</Button>
        ) : null}
        {step.status === 'waiting_confirmation' && step.confirmationId && confirmationAllowed ? (
          <div className="agent-step__confirmation">
            <p>{step.confirmationMessage}</p>
            <div>
              <Button variant="ghost" size="sm" disabled={actionPending} onClick={() => onReject(step.confirmationId!)} aria-label={`取消${step.label}`}>取消</Button>
              <Button size="sm" disabled={actionPending} onClick={() => onConfirm(step.confirmationId!)} aria-label={`确认${step.label}`}>确认</Button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  )
}

export default function AgentStepTimeline({ steps, canRetry, activeRetryStepId, activeConfirmationId, pendingActionId, onRetry, onConfirm, onReject }: {
  steps: AgentStep[]
  capabilities?: AgentCapabilities
  canRetry?(stepId: string): boolean
  activeRetryStepId?: string | null
  activeConfirmationId?: string | null
  pendingActionId?: string
  onRetry(stepId: string): void
  onConfirm(confirmationId: string): void
  onReject(confirmationId: string): void
}) {
  if (!steps.length) return null
  const retryStepId = activeRetryStepId === undefined
    ? steps.find((step) => step.status === 'failed' && canRetry?.(step.id) === true)?.id
    : activeRetryStepId
  const confirmationId = activeConfirmationId === undefined
    ? steps.filter((step) => step.status === 'waiting_confirmation' && step.confirmationId).at(-1)?.confirmationId
    : activeConfirmationId
  return (
    <ol className="agent-timeline" aria-label="Agent 执行步骤">
      {steps.map((step) => <AgentStepItem
        key={step.id}
        step={step}
        retryAllowed={step.id === retryStepId}
        confirmationAllowed={step.confirmationId === confirmationId}
        actionPending={Boolean(pendingActionId) && (pendingActionId === step.id || pendingActionId === step.confirmationId)}
        onRetry={onRetry}
        onConfirm={onConfirm}
        onReject={onReject}
      />)}
    </ol>
  )
}
