import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Dialog } from '../../shared/ui/Dialog'
import { useAgentSessionContext } from './agent-session-context'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
}

export default function CommandPalette({ onOpenAgent }: { onOpenAgent(): void }) {
  const session = useAgentSessionContext()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.shiftKey || event.key.toLowerCase() !== 'k' || event.ctrlKey) return
      const metaShortcut = event.metaKey && !event.altKey
      const altShortcut = event.altKey && !event.metaKey
      if (!metaShortcut && !altShortcut) return
      if (altShortcut && isEditableTarget(event.target)) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

  function submit() {
    const message = draft.trim()
    if (!message || !session.canSend) return
    if (!session.send(message)) return
    setDraft('')
    onOpenAgent()
    setOpen(false)
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <Dialog
      open={open}
      title="快速询问"
      description="告诉智能助手你想完成什么"
      onOpenChange={setOpen}
      initialFocusRef={inputRef}
      overlayClassName="command-palette-mask"
      panelClassName="command-palette max-w-[630px] rounded-[var(--radius-dialog)]"
      bodyClassName="command-palette__body"
      overlayTestId="command-palette-mask"
      footer={
        <><span>Shift + Enter 换行</span><button type="button" onClick={submit} disabled={!draft.trim() || !session.canSend}>发送给 Agent <kbd>↵</kbd></button></>
      }
    >
      <textarea
        ref={inputRef}
        aria-label="快速询问内容"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="告诉智能助手你想完成什么…"
        rows={3}
      />
    </Dialog>
  )
}
