import { Outlet } from 'react-router-dom'
import NavigationRail from './NavigationRail'
import type { AgentMessage } from './AgentPanel'
import AgentPanel from './AgentPanel'
import { useState, useCallback } from 'react'

interface AppShellProps {
  /** Whether to show the AgentPanel. Defaults to true. */
  showAgentPanel?: boolean
  /** Initial messages for the AgentPanel. */
  initialMessages?: AgentMessage[]
  /** Callback when user sends a message in the AgentPanel. */
  onAgentSend?: (message: string) => void
  /** Whether the agent is currently processing. */
  isAgentLoading?: boolean
}

export default function AppShell({
  showAgentPanel = true,
  initialMessages,
  onAgentSend,
  isAgentLoading = false,
}: AppShellProps) {
  const [messages, setMessages] = useState<AgentMessage[]>(initialMessages ?? [])

  // Sync external initialMessages if provided
  const effectiveMessages = initialMessages !== undefined ? initialMessages : messages

  const handleSend = useCallback(
    (message: string) => {
      const userMsg: AgentMessage = {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])

      if (onAgentSend) {
        onAgentSend(message)
      }
    },
    [onAgentSend],
  )

  return (
    <div className="flex min-h-screen bg-[var(--color-app-bg)]">
      {/* Left: Navigation Rail */}
      <NavigationRail />

      {/* Center: Main content area */}
      <main className="ml-[72px] flex-1 p-6 transition-[margin] duration-200">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm">
          <Outlet />
        </div>
      </main>

      {/* Right: Agent Panel */}
      {showAgentPanel && (
        <div className="w-[320px] shrink-0 transition-[width] duration-200">
          <div className="fixed right-0 top-0 h-screen w-[320px]">
            <AgentPanel
              messages={effectiveMessages}
              onSend={handleSend}
              isLoading={isAgentLoading}
            />
          </div>
        </div>
      )}
    </div>
  )
}
