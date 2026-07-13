import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

export interface PopoverProps {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  onOpenChange(open: boolean): void
  children: ReactNode
}

export function Popover({ open, anchorRef, onOpenChange, children }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !popoverRef.current) return

    const anchor = anchorRef.current.getBoundingClientRect()
    const popover = popoverRef.current
    const gap = 8
    const viewportPadding = 12
    const availableWidth = document.documentElement.clientWidth
    const left = Math.min(
      Math.max(viewportPadding, anchor.left),
      Math.max(viewportPadding, availableWidth - popover.offsetWidth - viewportPadding),
    )

    popover.style.left = `${left}px`
    popover.style.top = `${anchor.bottom + gap}px`
  }, [anchorRef, open])

  useEffect(() => {
    if (!open) return

    const firstFocusable = popoverRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    ;(firstFocusable ?? popoverRef.current)?.focus()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        !popoverRef.current?.contains(target) &&
        !anchorRef.current?.contains(target)
      ) {
        onOpenChange(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
        anchorRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchorRef, onOpenChange, open])

  if (!open) return null

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="浮层内容"
      tabIndex={-1}
      className="fixed z-50 min-w-52 rounded-[var(--radius-panel)] border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[var(--shadow-panel)] focus:outline-none motion-safe:animate-[popover-enter_var(--motion-overlay)_both]"
    >
      {children}
    </div>,
    document.body,
  )
}
