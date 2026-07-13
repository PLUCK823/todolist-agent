import { useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Outlet, useLocation } from 'react-router-dom'
import AgentPanel from '../agent/AgentPanel'
import { AgentSessionBoundary } from '../agent/AgentSessionContext'
import CommandPalette from '../agent/CommandPalette'
import { IconButton } from '../../shared/ui/IconButton'
import NavigationRail from './NavigationRail'
import { useShell } from './shell-context'

type ShellStyle = CSSProperties & {
  '--nav-width': string
  '--agent-width': string
}

function AppShellContent() {
  const { navExpanded, agentExpanded, closeAgent, openAgent, headerActionsElement } = useShell()
  const location = useLocation()
  const [agentDraft, setAgentDraft] = useState('')
  const showPanel = agentExpanded && location.pathname !== '/assistant'

  const style: ShellStyle = {
    '--nav-width': navExpanded
      ? 'var(--nav-width-expanded)'
      : 'var(--nav-width-collapsed)',
    '--agent-width': showPanel ? 'var(--agent-width-expanded)' : '0px',
  }

  const spark = !agentExpanded && location.pathname !== '/assistant' ? (
    <IconButton label="展开智能助手" tone="primary" icon={<span className="agent-spark">✦</span>} onClick={openAgent} />
  ) : null

  return (
    <div className="app-shell" data-testid="app-shell" style={style}>
      <NavigationRail />
      <main className="app-shell__main">
        <Outlet />
      </main>
      {showPanel ? <div className="app-shell__agent" data-testid="agent-column"><AgentPanel onCollapse={closeAgent} draft={agentDraft} onDraftChange={setAgentDraft} /></div> : null}
      {spark && headerActionsElement ? createPortal(spark, headerActionsElement) : spark ? <div className="shell-header-actions-fallback">{spark}</div> : null}
      <CommandPalette onOpenAgent={location.pathname === '/assistant' ? () => undefined : openAgent} />
    </div>
  )
}

export default function AppShell() {
  return <AgentSessionBoundary><AppShellContent /></AgentSessionBoundary>
}
