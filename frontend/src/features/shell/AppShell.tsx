import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Outlet, useLocation } from 'react-router-dom'
import AgentPanel from '../agent/AgentPanel'
import { AgentSessionBoundary } from '../agent/AgentSessionContext'
import CommandPalette from '../agent/CommandPalette'
import { IconButton } from '../../shared/ui/IconButton'
import NavigationRail from './NavigationRail'
import { useShell } from './shell-context'
import SettingsDialog from '../preferences/SettingsDialog'

type ShellStyle = CSSProperties & {
  '--nav-width': string
  '--agent-width': string
}

function AppShellContent() {
  const { navExpanded, agentExpanded, closeAgent, openAgent, headerActionsElement } = useShell()
  const location = useLocation()
  const [agentDraft, setAgentDraft] = useState('')
  const sparkRef = useRef<HTMLButtonElement>(null)
  const restoreSparkFocusRef = useRef(false)
  const showPanel = agentExpanded && location.pathname !== '/assistant'

  const collapseAgent = useCallback(() => {
    restoreSparkFocusRef.current = true
    closeAgent()
  }, [closeAgent])

  useEffect(() => {
    if (agentExpanded || !restoreSparkFocusRef.current) return
    restoreSparkFocusRef.current = false
    sparkRef.current?.focus()
  }, [agentExpanded])

  useEffect(() => {
    if (!showPanel) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || !(window.matchMedia?.('(max-width: 1000px)').matches ?? false)) return
      event.preventDefault()
      collapseAgent()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [collapseAgent, showPanel])

  const style: ShellStyle = {
    '--nav-width': navExpanded
      ? 'var(--nav-width-expanded)'
      : 'var(--nav-width-collapsed)',
    '--agent-width': showPanel ? 'var(--agent-width-expanded)' : '0px',
  }

  const spark = !agentExpanded && location.pathname !== '/assistant' ? (
    <IconButton buttonRef={sparkRef} label="展开智能助手" tone="primary" icon={<span className="agent-spark">✦</span>} onClick={openAgent} />
  ) : null

  return (
    <div className="app-shell" data-testid="app-shell" style={style}>
      <NavigationRail />
      <main className="app-shell__main">
        <Outlet />
      </main>
      {showPanel ? <><button type="button" className="agent-drawer-backdrop" aria-label="关闭智能助手遮罩" onClick={collapseAgent} /><div className="app-shell__agent" data-testid="agent-column"><AgentPanel onCollapse={collapseAgent} draft={agentDraft} onDraftChange={setAgentDraft} /></div></> : null}
      {spark && headerActionsElement ? createPortal(spark, headerActionsElement) : spark ? <div className="shell-header-actions-fallback">{spark}</div> : null}
      <CommandPalette onOpenAgent={location.pathname === '/assistant' ? () => undefined : openAgent} />
      <SettingsDialog />
    </div>
  )
}

export default function AppShell() {
  return <AgentSessionBoundary><AppShellContent /></AgentSessionBoundary>
}
