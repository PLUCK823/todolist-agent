import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ShellContext,
  type ShellContextValue,
  type ShellState,
} from './shell-context'
import {
  parseShellState,
  readShellState,
  SHELL_STORAGE_KEY,
  writeShellState,
} from './shell-storage'

export function ShellProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShellState>(readShellState)
  const [headerActionsElement, setHeaderActionsElement] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    writeShellState(state)
  }, [state])

  useEffect(() => {
    const syncShellState = (event: StorageEvent) => {
      if (event.key !== SHELL_STORAGE_KEY) return
      const nextState = parseShellState(event.newValue)
      if (nextState) setState(nextState)
    }

    window.addEventListener('storage', syncShellState)
    return () => window.removeEventListener('storage', syncShellState)
  }, [])

  const toggleNav = useCallback(() => {
    setState((current) => ({ ...current, navExpanded: !current.navExpanded }))
  }, [])

  const openAgent = useCallback(() => {
    setState((current) => ({ ...current, agentExpanded: true }))
  }, [])

  const closeAgent = useCallback(() => {
    setState((current) => ({ ...current, agentExpanded: false }))
  }, [])

  const value = useMemo<ShellContextValue>(
    () => ({ ...state, headerActionsElement, toggleNav, openAgent, closeAgent, setHeaderActionsElement }),
    [closeAgent, headerActionsElement, openAgent, state, toggleNav],
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}
