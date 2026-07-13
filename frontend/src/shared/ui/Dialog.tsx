import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './IconButton'
import { isTopOverlay, registerOverlay } from './overlay-stack'

export interface DialogProps {
  open: boolean
  title: string
  description?: string
  onOpenChange(open: boolean): void
  children: ReactNode
  footer?: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
  overlayClassName?: string
  panelClassName?: string
  bodyClassName?: string
  overlayTestId?: string
}

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function Dialog({
  open,
  title,
  description,
  onOpenChange,
  children,
  footer,
  initialFocusRef,
  overlayClassName = '',
  panelClassName = '',
  bodyClassName = '',
  overlayTestId,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const overlayRootRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const overlayIdRef = useRef(Symbol('dialog'))
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return

    const activeElement = document.activeElement
    restoreFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null
    const overlayRoot = overlayRootRef.current
    const dialog = dialogRef.current
    if (!overlayRoot || !dialog) return

    const focusElement = initialFocusRef?.current ?? dialog
    focusElement.focus()
    const unregister = registerOverlay({
      id: overlayIdRef.current,
      root: overlayRoot,
      focusElement,
      restoreFocusTo: restoreFocusRef.current,
    })

    return () => {
      unregister()
      restoreFocusRef.current = null
    }
  }, [initialFocusRef, open])

  useEffect(() => {
    if (!open) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopOverlay(overlayIdRef.current)) {
        event.preventDefault()
        onOpenChange(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onOpenChange, open])

  if (!open || typeof document === 'undefined') return null

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1)

    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || active === dialogRef.current)) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      ref={overlayRootRef}
      data-testid={overlayTestId}
      className={`fixed inset-0 z-50 grid place-items-center bg-[rgb(24_28_43_/_48%)] p-4 backdrop-blur-[3px] motion-safe:animate-[overlay-enter_var(--motion-overlay)_both] ${overlayClassName}`}
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          isTopOverlay(overlayIdRef.current)
        ) {
          onOpenChange(false)
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`max-h-[min(760px,calc(100vh-2rem))] w-full max-w-lg overflow-auto rounded-[var(--radius-panel)] border border-white/80 bg-white shadow-[var(--shadow-overlay)] focus:outline-none focus-visible:shadow-[var(--shadow-overlay),var(--focus-ring)] motion-safe:animate-[panel-enter_var(--motion-overlay)_both] ${panelClassName}`}
      >
        <header className="flex items-start justify-between gap-5 border-b border-[var(--border)] px-6 pb-4 pt-5">
          <div>
            <h2 id={titleId} className="m-0 text-lg font-bold tracking-[-.015em] text-[var(--text)]">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mb-0 mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton
            label={`关闭${title}`}
            icon={
              <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            }
            size="sm"
            onClick={() => onOpenChange(false)}
          />
        </header>
        <div className={`px-6 py-5 ${bodyClassName}`}>{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface-subtle)]/55 px-6 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
