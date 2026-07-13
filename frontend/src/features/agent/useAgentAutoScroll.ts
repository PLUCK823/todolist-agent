import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { AgentMessage, AgentSessionStatus, AgentStep } from './agent.types'

export function getAgentScrollRevision(value: { status: AgentSessionStatus; messages: AgentMessage[]; steps: AgentStep[] }) {
  const message = value.messages.at(-1)
  const step = value.steps.at(-1)
  return [
    value.status,
    message?.id ?? '',
    message?.content.length ?? 0,
    step?.id ?? '',
    step?.status ?? '',
    step?.durationMs ?? '',
    step?.errorMessage?.length ?? 0,
    step?.confirmationMessage?.length ?? 0,
  ].join(':')
}

export function useAgentAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  endRef: RefObject<HTMLElement | null>,
  revision: string,
) {
  const shouldFollow = useRef(true)
  const onScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    shouldFollow.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 48
  }, [containerRef])

  useEffect(() => {
    if (!shouldFollow.current) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    endRef.current?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'end' })
  }, [endRef, revision])

  return onScroll
}
