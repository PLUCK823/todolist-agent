import { useEffect, useState } from 'react'
import { Button } from '../../shared/ui/Button'
import type { AgentCapabilities, AgentStep } from './agent.types'

const statusLabels: Record<AgentStep['status'], string> = {
  waiting: '等待中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  waiting_confirmation: '等待确认',
}

function formatDuration(durationMs: number) {
  return durationMs < 1000 ? `${durationMs} 毫秒` : `${(durationMs / 1000).toFixed(1)} 秒`
}

function ActionResult({ action, result }: { action: string; result: Record<string, unknown> }) {
  return (
    <section className="agent-step__result" aria-label={`${action} 执行结果`}>
      <span>{action}</span>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </section>
  )
}

function AgentStepItem({ step, capabilities, onRetry, onConfirm, onReject }: {
  step: AgentStep
  capabilities: AgentCapabilities
  onRetry(stepId: string): void
  onConfirm(confirmationId: string): void
  onReject(confirmationId: string): void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (step.status !== 'running' || !step.startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [step.startedAt, step.status])

  const elapsed = step.durationMs ?? (step.startedAt ? Math.max(0, now - Date.parse(step.startedAt)) : undefined)
  return (
    <li className="agent-step" data-status={step.status}>
      <span className="agent-step__marker" aria-hidden="true" />
      <div className="agent-step__body">
        <div className="agent-step__heading">
          <strong>{step.label}</strong>
          <span>{statusLabels[step.status]}</span>
        </div>
        {elapsed !== undefined ? <time className="agent-step__timer tabular-nums">{formatDuration(elapsed)}</time> : null}
        {step.tool ? <code className="agent-step__tool">{step.tool}</code> : null}
        {step.errorMessage ? <p className="agent-step__error" role="alert">{step.errorMessage}</p> : null}
        {step.action && step.result ? <ActionResult action={step.action} result={step.result} /> : null}
        {step.status === 'failed' && step.retryable && capabilities.supportsStepRetry ? (
          <Button variant="secondary" size="sm" onClick={() => onRetry(step.id)} aria-label={`重试${step.label}`}>重试</Button>
        ) : null}
        {step.status === 'waiting_confirmation' && step.confirmationId ? (
          <div className="agent-step__confirmation">
            <p>{step.confirmationMessage}</p>
            <div>
              <Button variant="ghost" size="sm" onClick={() => onReject(step.confirmationId!)} aria-label={`取消${step.label}`}>取消</Button>
              <Button size="sm" onClick={() => onConfirm(step.confirmationId!)} aria-label={`确认${step.label}`}>确认</Button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  )
}

export default function AgentStepTimeline({ steps, capabilities, onRetry, onConfirm, onReject }: {
  steps: AgentStep[]
  capabilities: AgentCapabilities
  onRetry(stepId: string): void
  onConfirm(confirmationId: string): void
  onReject(confirmationId: string): void
}) {
  if (!steps.length) return null
  return (
    <ol className="agent-timeline" aria-label="Agent 执行步骤">
      {steps.map((step) => <AgentStepItem key={step.id} step={step} capabilities={capabilities} onRetry={onRetry} onConfirm={onConfirm} onReject={onReject} />)}
    </ol>
  )
}
