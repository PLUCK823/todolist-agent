import { createContext, useContext } from 'react'
import type { AgentSessionValue } from './agent.types'

export const AgentSessionContext = createContext<AgentSessionValue | null>(null)

export function useAgentSessionContext(): AgentSessionValue {
  const context = useContext(AgentSessionContext)
  if (!context) throw new Error('useAgentSessionContext must be used within AgentSessionProvider')
  return context
}
