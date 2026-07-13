import { useQueryClient } from '@tanstack/react-query'
import { useContext, useEffect, useRef, type ReactNode } from 'react'
import { todoKeys } from '../todos/todo.queries'
import type { AgentSessionValue } from './agent.types'
import { useAgentSession } from './useAgentSession'
import { AgentSessionContext } from './agent-session-context'

function SessionEffects({ value, children }: { value: AgentSessionValue; children: ReactNode }) {
  const queryClient = useQueryClient()
  const seenActions = useRef(new Set<string>())

  useEffect(() => {
    for (const step of value.steps) {
      if (!step.action || step.status !== 'completed' || seenActions.current.has(step.id)) continue
      seenActions.current.add(step.id)
      void queryClient.invalidateQueries({ queryKey: todoKeys.all })
    }
  }, [queryClient, value.steps])

  return <AgentSessionContext.Provider value={value}>{children}</AgentSessionContext.Provider>
}

function LiveAgentSessionProvider({ children }: { children: ReactNode }) {
  const value = useAgentSession()
  return <SessionEffects value={value}>{children}</SessionEffects>
}

export function AgentSessionProvider({ children, value }: { children: ReactNode; value?: AgentSessionValue }) {
  return value
    ? <SessionEffects value={value}>{children}</SessionEffects>
    : <LiveAgentSessionProvider>{children}</LiveAgentSessionProvider>
}

export function AgentSessionBoundary({ children }: { children: ReactNode }) {
  const parent = useContext(AgentSessionContext)
  return parent ? children : <AgentSessionProvider>{children}</AgentSessionProvider>
}
