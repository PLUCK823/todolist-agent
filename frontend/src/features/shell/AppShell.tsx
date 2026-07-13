import { useCallback, useState, type CSSProperties } from 'react'
import { Outlet } from 'react-router-dom'
import AgentPanel, { type AgentMessage } from '../../components/layout/AgentPanel'
import NavigationRail from './NavigationRail'
import { useShell } from './shell-context'

type ShellStyle = CSSProperties & {
  '--nav-width': string
  '--agent-width': string
}

export default function AppShell() {
  const { navExpanded, agentExpanded } = useShell()
  const [messages, setMessages] = useState<AgentMessage[]>([])

  const handleAgentSend = useCallback((message: string) => {
    setMessages((current) => [
      ...current,
      { role: 'user', content: message, timestamp: new Date().toISOString() },
    ])
  }, [])

  const style: ShellStyle = {
    '--nav-width': navExpanded ? '210px' : '68px',
    '--agent-width': agentExpanded ? '340px' : '0px',
  }

  return (
    <div className="app-shell" data-testid="app-shell" style={style}>
      <NavigationRail />
      <main className="app-shell__main">
        <Outlet />
      </main>
      {agentExpanded && (
        <div className="app-shell__agent" data-testid="agent-column">
          <AgentPanel messages={messages} onSend={handleAgentSend} isLoading={false} />
        </div>
      )}
    </div>
  )
}
