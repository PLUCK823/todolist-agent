import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { AgentMessage, AgentSessionStatus, AgentStep, AgentTurn } from './agent.types'

const FOLLOW_DISTANCE = 48

interface AgentScrollValue {
  status: AgentSessionStatus
  messages: AgentMessage[]
  steps: AgentStep[]
  displayedSessionId?: string
  turns?: AgentTurn[]
}

interface AgentAutoScrollOptions {
  forceFollowKey?: string
  userMessageKey?: string
  messageKey?: string
}

export function getAgentScrollRevision(value: AgentScrollValue) {
  const message = value.messages.at(-1)
  const step = value.steps.at(-1)
  const turn = value.turns?.at(-1)
  const turnMessage = turn?.messages.at(-1)
  const turnStep = turn?.steps.at(-1)
  return [
    value.displayedSessionId ?? '',
    value.status,
    turn?.id ?? '',
    turn?.status ?? '',
    message?.id ?? turnMessage?.id ?? '',
    message?.content.length ?? turnMessage?.content.length ?? 0,
    step?.id ?? turnStep?.id ?? '',
    step?.status ?? turnStep?.status ?? '',
    step?.durationMs ?? turnStep?.durationMs ?? '',
    step?.errorMessage?.length ?? turnStep?.errorMessage?.length ?? 0,
    step?.confirmationMessage?.length ?? turnStep?.confirmationMessage?.length ?? 0,
  ].join(':')
}

export function useAgentAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  endRef: RefObject<HTMLElement | null>,
  revision: string,
  options: AgentAutoScrollOptions = {},
) {
  const shouldFollow = useRef(true)
  const frameRef = useRef<number | undefined>(undefined)
  const previousForceKey = useRef(options.forceFollowKey)
  const previousUserMessageKey = useRef(options.userMessageKey)
  const previousMessageKey = useRef(options.messageKey)
  const [showReturnToBottom, setShowReturnToBottom] = useState(false)
  const [hasNewMessage, setHasNewMessage] = useState(false)

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [containerRef])

  const scheduleScroll = useCallback(() => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined
      scrollToBottom()
    })
  }, [scrollToBottom])

  const onScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= FOLLOW_DISTANCE
    shouldFollow.current = nearBottom
    if (nearBottom) {
      setShowReturnToBottom(false)
      setHasNewMessage(false)
    }
  }, [containerRef])

  const returnToBottom = useCallback(() => {
    shouldFollow.current = true
    setShowReturnToBottom(false)
    setHasNewMessage(false)
    scheduleScroll()
  }, [scheduleScroll])

  useEffect(() => {
    const forceChanged = previousForceKey.current !== options.forceFollowKey
    const userMessageChanged = previousUserMessageKey.current !== options.userMessageKey
    const messageChanged = previousMessageKey.current !== options.messageKey
    previousForceKey.current = options.forceFollowKey
    previousUserMessageKey.current = options.userMessageKey
    previousMessageKey.current = options.messageKey

    if (forceChanged || userMessageChanged) {
      shouldFollow.current = true
      setShowReturnToBottom(false)
      setHasNewMessage(false)
      scheduleScroll()
      return
    }
    if (shouldFollow.current) {
      scheduleScroll()
      return
    }
    setShowReturnToBottom(true)
    if (messageChanged) setHasNewMessage(true)
  }, [options.forceFollowKey, options.messageKey, options.userMessageKey, revision, scheduleScroll])

  useEffect(() => {
    const container = containerRef.current
    const content = endRef.current?.parentElement
    const handleResize = () => {
      if (shouldFollow.current) scheduleScroll()
    }
    window.addEventListener('resize', handleResize)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(handleResize)
    if (container) observer?.observe(container)
    if (content && content !== container) observer?.observe(content)
    return () => {
      window.removeEventListener('resize', handleResize)
      observer?.disconnect()
    }
  }, [containerRef, endRef, scheduleScroll])

  useEffect(() => () => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
  }, [])

  return { onScroll, showReturnToBottom, hasNewMessage, returnToBottom }
}
