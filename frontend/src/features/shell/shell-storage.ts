import type { ShellState } from './shell-context'

export const SHELL_STORAGE_KEY = 'todolist:shell'

export const DEFAULT_SHELL_STATE: ShellState = {
  navExpanded: false,
  agentExpanded: true,
}

export function parseShellState(value: string | null): ShellState | null {
  if (value === null) return null

  try {
    const parsed: unknown = JSON.parse(value)
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
    // Invalid persisted data is ignored by every storage entry point.
  }

  return null
}

export function readShellState(): ShellState {
  try {
    return parseShellState(window.localStorage.getItem(SHELL_STORAGE_KEY))
      ?? DEFAULT_SHELL_STATE
  } catch {
    return DEFAULT_SHELL_STATE
  }
}

export function writeShellState(state: ShellState): void {
  try {
    window.localStorage.setItem(SHELL_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Privacy modes and full quotas must not make shell controls unusable.
  }
}
