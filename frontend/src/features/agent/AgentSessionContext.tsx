import { useQueryClient } from '@tanstack/react-query'
import { useContext, useEffect, useRef, type ReactNode } from 'react'
import { todoKeys } from '../todos/todo.queries'
import type { AgentSessionValue } from './agent.types'
import { useAgentSession } from './useAgentSession'
import { AgentSessionContext } from './agent-session-context'

function SessionEffects({ value, children }: { value: AgentSessionValue; children: ReactNode }) {
  const queryClient = useQueryClient()
  const activeTurn = value.turns.at(-1)
  const activeSteps = activeTurn?.steps ?? value.steps
  const latestUserMessage = [...(activeTurn?.messages ?? value.messages)].reverse().find((message) => message.role === 'user')
  const turnKey = `${value.displayedSessionId ?? value.sessionId ?? 'local'}:${activeTurn?.id ?? latestUserMessage?.id ?? 'initial'}`
  const seenActions = useRef<{ turnKey: string; ids: Set<string> }>({ turnKey, ids: new Set() })

  useEffect(() => {
    if (seenActions.current.turnKey !== turnKey) {
      seenActions.current = { turnKey, ids: new Set() }
    }
    for (const step of activeSteps) {
      if (!step.action || step.status !== 'completed' || seenActions.current.ids.has(step.id)) continue
      seenActions.current.ids.add(step.id)
      void queryClient.invalidateQueries({ queryKey: todoKeys.all })
    }
  }, [activeSteps, queryClient, turnKey])

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
