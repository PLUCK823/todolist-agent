import type { AgentSessionStatus, AgentStep } from './agent.types'

export interface AgentStatusPresentation {
  label: string
  tone: 'online' | 'busy' | 'attention' | 'offline' | 'complete'
  isError: boolean
}

const presentations: Record<AgentSessionStatus, AgentStatusPresentation> = {
  idle: { label: '在线 · 随时处理任务', tone: 'online', isError: false },
  connecting: { label: '正在连接智能助手', tone: 'busy', isError: false },
  running: { label: '正在执行任务', tone: 'busy', isError: false },
  waiting_confirmation: { label: '等待你的确认', tone: 'attention', isError: false },
  failed: { label: '任务未完成 · 请查看详情', tone: 'attention', isError: true },
  done: { label: '任务已完成', tone: 'complete', isError: false },
}

const connectionFailureCodes = new Set(['CONNECTION_TIMEOUT', 'CONNECTION_CLOSED', 'SOCKET_ERROR'])

export function getAgentStatusPresentation(status: AgentSessionStatus, steps: AgentStep[] = []): AgentStatusPresentation {
  if (status !== 'failed') return presentations[status]
  const failedSteps = steps.filter((step) => step.status === 'failed')
  const hasConnectionFailure = failedSteps.some((step) => (
    step.id === 'client-connection' || (step.errorCode !== undefined && connectionFailureCodes.has(step.errorCode))
  ))
  if (hasConnectionFailure) {
    return { label: '连接异常 · 当前离线', tone: 'offline', isError: true }
  }
  if (failedSteps.length) {
    return { label: '任务执行遇到问题 · 查看详情', tone: 'attention', isError: true }
  }
  return presentations.failed
}
