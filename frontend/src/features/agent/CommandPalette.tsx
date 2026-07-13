import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../../shared/ui/IconButton'
import { useAgentSessionContext } from './agent-session-context'

const focusableSelector = 'button:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export default function CommandPalette({ onOpenAgent }: { onOpenAgent(): void }) {
  const session = useAgentSessionContext()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.altKey) || event.ctrlKey) return
      event.preventDefault()
      if (!open) {
        restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [open])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    return () => restoreFocusRef.current?.focus()
  }, [open])

  function submit() {
    const message = draft.trim()
    if (!message) return
    session.send(message)
    setDraft('')
    onOpenAgent()
    close()
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus()
    }
  }

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      className="command-palette-mask"
      data-testid="command-palette-mask"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}
    >
      <div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <header>
          <div><span className="agent-spark" aria-hidden="true">✦</span><h2 id={titleId}>快速询问</h2></div>
          <IconButton label="关闭快速询问" icon={<span aria-hidden="true">×</span>} onClick={close} />
        </header>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }}
          placeholder="告诉智能助手你想完成什么…"
          rows={3}
        />
        <footer><span>Shift + Enter 换行</span><button type="button" onClick={submit} disabled={!draft.trim()}>发送给 Agent <kbd>↵</kbd></button></footer>
      </div>
    </div>,
    document.body,
  )
}
