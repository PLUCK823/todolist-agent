import type { AgentSessionStatus } from './agent.types'

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
  failed: { label: '连接异常 · 当前离线', tone: 'offline', isError: true },
  done: { label: '任务已完成', tone: 'complete', isError: false },
}

export function getAgentStatusPresentation(status: AgentSessionStatus): AgentStatusPresentation {
  return presentations[status]
}
