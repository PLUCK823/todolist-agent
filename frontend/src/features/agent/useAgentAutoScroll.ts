import { useCallback, useEffect, useRef, type RefObject } from 'react'

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
