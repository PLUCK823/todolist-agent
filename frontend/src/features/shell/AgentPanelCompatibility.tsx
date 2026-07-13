import { useCallback, useEffect, useState, type TransitionEvent } from 'react'
import AgentPanel, { type AgentMessage } from '../../components/layout/AgentPanel'

const AGENT_EXIT_MS = 480

type AgentPresence = 'entered' | 'exiting' | 'exited'

export default function AgentPanelCompatibility({ expanded }: { expanded: boolean }) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [draft, setDraft] = useState('')
  const [presence, setPresence] = useState<AgentPresence>(expanded ? 'entered' : 'exited')
  const [previousExpanded, setPreviousExpanded] = useState(expanded)

  if (expanded !== previousExpanded) {
    setPreviousExpanded(expanded)
    setPresence(expanded ? 'entered' : 'exiting')
  }

  useEffect(() => {
    if (presence !== 'exiting') return

    const timeout = window.setTimeout(() => {
      setPresence((current) => current === 'exiting' ? 'exited' : current)
    }, AGENT_EXIT_MS)

    return () => window.clearTimeout(timeout)
  }, [presence])

  const handleSend = useCallback((message: string) => {
    setMessages((current) => [
      ...current,
      { role: 'user', content: message, timestamp: new Date().toISOString() },
    ])
  }, [])

  const finishExit = useCallback(() => {
    if (!expanded) setPresence('exited')
  }, [expanded])

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) finishExit()
  }

  if (presence === 'exited') return null

  const exiting = presence === 'exiting'

  return (
    <div
      className="app-shell__agent"
      data-testid="agent-column"
      data-state={presence}
      aria-hidden={exiting}
      inert={exiting}
      onTransitionEnd={handleTransitionEnd}
    >
      <AgentPanel
        messages={messages}
        onSend={handleSend}
        isLoading={false}
        draft={draft}
        onDraftChange={setDraft}
      />
    </div>
  )
}
