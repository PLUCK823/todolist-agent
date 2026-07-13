import type { CSSProperties } from 'react'
import { Outlet } from 'react-router-dom'
import AgentPanelCompatibility from './AgentPanelCompatibility'
import NavigationRail from './NavigationRail'
import { useShell } from './shell-context'

type ShellStyle = CSSProperties & {
  '--nav-width': string
  '--agent-width': string
}

export default function AppShell() {
  const { navExpanded, agentExpanded } = useShell()

  const style: ShellStyle = {
    '--nav-width': navExpanded
      ? 'var(--nav-width-expanded)'
      : 'var(--nav-width-collapsed)',
    '--agent-width': agentExpanded ? 'var(--agent-width-expanded)' : '0px',
  }

  return (
    <div className="app-shell" data-testid="app-shell" style={style}>
      <NavigationRail />
      <main className="app-shell__main">
        <Outlet />
      </main>
      <AgentPanelCompatibility expanded={agentExpanded} />
    </div>
  )
}
