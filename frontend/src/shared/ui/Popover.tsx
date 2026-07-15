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
  ariaLabel?: string
  children: ReactNode
}

export function Popover({ open, anchorRef, onOpenChange, ariaLabel = '浮层', children }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()
  const anchorId = `${popoverId}-anchor`
  const initialOpenRef = useRef(open)
  const managedExpandedValueRef = useRef<string | null>(null)

  useClientLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const previous = {
      hasPopup: anchor.getAttribute('aria-haspopup'),
      expanded: anchor.getAttribute('aria-expanded'),
      controls: anchor.getAttribute('aria-controls'),
    }
    const managed = {
      hasPopup: 'dialog',
      expanded: String(initialOpenRef.current),
      controls: popoverId,
    }
    const ownsId = anchor.id.length === 0
    if (ownsId) anchor.id = anchorId
    anchor.setAttribute('aria-haspopup', managed.hasPopup)
    anchor.setAttribute('aria-expanded', managed.expanded)
    anchor.setAttribute('aria-controls', managed.controls)
    managedExpandedValueRef.current = managed.expanded

    return () => {
      restoreManagedAttribute(
        anchor,
        'aria-haspopup',
        managed.hasPopup,
        previous.hasPopup,
      )
      const managedExpanded = managedExpandedValueRef.current
      if (managedExpanded !== null) {
        restoreManagedAttribute(
          anchor,
          'aria-expanded',
          managedExpanded,
          previous.expanded,
        )
      }
      restoreManagedAttribute(
        anchor,
        'aria-controls',
        managed.controls,
        previous.controls,
      )
      if (ownsId && anchor.id === anchorId) anchor.removeAttribute('id')
      managedExpandedValueRef.current = null
    }
  }, [anchorId, anchorRef, popoverId])

  useClientLayoutEffect(() => {
    const anchor = anchorRef.current
    const managedExpanded = managedExpandedValueRef.current
    if (!anchor || managedExpanded === null) return

    if (anchor.getAttribute('aria-expanded') !== managedExpanded) {
      managedExpandedValueRef.current = null
      return
    }

    const nextExpanded = String(open)
    anchor.setAttribute('aria-expanded', nextExpanded)
    managedExpandedValueRef.current = nextExpanded
  }, [anchorRef, open])

  useClientLayoutEffect(() => {
    if (!open) return

    const updatePosition = () => {
      if (!anchorRef.current || !popoverRef.current) return

      const anchor = anchorRef.current.getBoundingClientRect()
      const popover = popoverRef.current
      if (ariaLabel === '浮层') {
        popover.setAttribute(
          'aria-labelledby',
          `${anchorRef.current.id} ${popoverId}-label`,
        )
      } else {
        popover.removeAttribute('aria-labelledby')
      }
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
  }, [anchorRef, ariaLabel, open, popoverId])

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
      aria-label={ariaLabel}
      tabIndex={-1}
      className="fixed z-50 w-[210px] animate-[popover-enter_var(--motion-overlay)_both] rounded-[var(--radius-popover)] border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text)] shadow-[var(--shadow-panel)] focus:outline-none"
    >
      <span id={`${popoverId}-label`} className="sr-only">
        {ariaLabel}
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

function restoreManagedAttribute(
  element: HTMLElement,
  name: string,
  managedValue: string,
  previousValue: string | null,
) {
  if (element.getAttribute(name) === managedValue) {
    restoreAttribute(element, name, previousValue)
  }
}
