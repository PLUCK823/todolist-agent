import { createContext, useContext } from 'react'

export interface ShellState {
  navExpanded: boolean
  agentExpanded: boolean
}

export interface ShellContextValue extends ShellState {
  toggleNav(): void
  openAgent(): void
  closeAgent(): void
}

export const ShellContext = createContext<ShellContextValue | null>(null)

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext)
  if (!context) {
    throw new Error('useShell must be used within a <ShellProvider>')
  }
  return context
}
