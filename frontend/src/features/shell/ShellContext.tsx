import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ShellContext,
  type ShellContextValue,
  type ShellState,
} from './shell-context'

const SHELL_STORAGE_KEY = 'todolist:shell'

const DEFAULT_SHELL_STATE: ShellState = {
  navExpanded: false,
  agentExpanded: true,
}

function loadShellState(): ShellState {
  try {
    const stored = window.localStorage.getItem(SHELL_STORAGE_KEY)
    if (!stored) return DEFAULT_SHELL_STATE

    const parsed: unknown = JSON.parse(stored)
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'navExpanded' in parsed
      && 'agentExpanded' in parsed
      && typeof parsed.navExpanded === 'boolean'
      && typeof parsed.agentExpanded === 'boolean'
    ) {
      return {
        navExpanded: parsed.navExpanded,
        agentExpanded: parsed.agentExpanded,
      }
    }
  } catch {
    // Corrupt browser state should never prevent the application from loading.
  }

  return DEFAULT_SHELL_STATE
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShellState>(loadShellState)

  useEffect(() => {
    window.localStorage.setItem(SHELL_STORAGE_KEY, JSON.stringify(state))
  }, [state])

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
    () => ({ ...state, toggleNav, openAgent, closeAgent }),
    [closeAgent, openAgent, state, toggleNav],
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}
