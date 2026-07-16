import { useCallback, useLayoutEffect, useRef } from 'react'

export const COMPOSER_DEFAULT_HEIGHT = 56
export const COMPOSER_AUTO_MAX_HEIGHT = 220

export function useExpandableTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const manualHeight = useRef<number | null>(null)
  const pointerStartHeight = useRef<number | null>(null)

  const sizeToContent = useCallback(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    const automaticHeight = Math.min(
      Math.max(element.scrollHeight, COMPOSER_DEFAULT_HEIGHT),
      COMPOSER_AUTO_MAX_HEIGHT,
    )
    const height = Math.max(automaticHeight, manualHeight.current ?? 0)
    element.style.height = `${height}px`
    element.style.overflowY = element.scrollHeight > height ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(sizeToContent, [sizeToContent, value])

  const reset = useCallback(() => {
    manualHeight.current = null
    const element = ref.current
    if (!element) return
    element.style.height = `${COMPOSER_DEFAULT_HEIGHT}px`
    element.style.overflowY = 'hidden'
  }, [])

  return {
    ref,
    reset,
    onPointerDown: () => {
      pointerStartHeight.current = ref.current?.offsetHeight ?? null
    },
    onPointerUp: () => {
      const element = ref.current
      if (!element || pointerStartHeight.current === null) return
      if (element.offsetHeight !== pointerStartHeight.current) {
        manualHeight.current = Math.max(COMPOSER_DEFAULT_HEIGHT, element.offsetHeight)
      }
      pointerStartHeight.current = null
      element.style.overflowY = element.scrollHeight > element.offsetHeight ? 'auto' : 'hidden'
    },
  }
}
