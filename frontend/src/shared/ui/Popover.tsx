import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { getPopoverPosition } from './popover-position'

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface PopoverProps {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  onOpenChange(open: boolean): void
  children: ReactNode
}

export function Popover({ open, anchorRef, onOpenChange, children }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()
  const anchorId = `${popoverId}-anchor`

  useClientLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const previous = {
      hasPopup: anchor.getAttribute('aria-haspopup'),
      expanded: anchor.getAttribute('aria-expanded'),
      controls: anchor.getAttribute('aria-controls'),
    }
    const ownsId = anchor.id.length === 0
    if (ownsId) anchor.id = anchorId
    anchor.setAttribute('aria-haspopup', 'dialog')
    anchor.setAttribute('aria-expanded', String(open))
    anchor.setAttribute('aria-controls', popoverId)
    popoverRef.current?.setAttribute(
      'aria-labelledby',
      `${anchor.id} ${popoverId}-label`,
    )

    return () => {
      restoreAttribute(anchor, 'aria-haspopup', previous.hasPopup)
      restoreAttribute(anchor, 'aria-expanded', previous.expanded)
      restoreAttribute(anchor, 'aria-controls', previous.controls)
      if (ownsId && anchor.id === anchorId) anchor.removeAttribute('id')
    }
  }, [anchorId, anchorRef, open, popoverId])

  useClientLayoutEffect(() => {
    if (!open) return

    const updatePosition = () => {
      if (!anchorRef.current || !popoverRef.current) return

      const anchor = anchorRef.current.getBoundingClientRect()
      const popover = popoverRef.current
      const { left, top } = getPopoverPosition({
        anchor,
        popover: { width: popover.offsetWidth, height: popover.offsetHeight },
        viewport: {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        },
      })

      popover.style.left = `${left}px`
      popover.style.top = `${top}px`
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
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

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={popoverRef}
      id={popoverId}
      role="dialog"
      aria-label="浮层"
      tabIndex={-1}
      className="fixed z-50 min-w-52 rounded-[var(--radius-panel)] border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[var(--shadow-panel)] focus:outline-none motion-safe:animate-[popover-enter_var(--motion-overlay)_both]"
    >
      <span id={`${popoverId}-label`} className="sr-only">
        浮层
      </span>
      {children}
    </div>,
    document.body,
  )
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}
