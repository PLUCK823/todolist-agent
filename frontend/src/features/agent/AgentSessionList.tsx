import { useRef, useState, type FormEvent, type RefObject } from 'react'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { IconButton } from '../../shared/ui/IconButton'
import { Popover } from '../../shared/ui/Popover'
import { TextField } from '../../shared/ui/TextField'
import type { AgentSessionSummary } from './agent.types'

interface SessionGroup {
  label: '今天' | '最近 7 天' | '更早'
  sessions: AgentSessionSummary[]
}

interface DialogTarget {
  session: AgentSessionSummary
  returnTarget: HTMLButtonElement | null
}

export interface AgentSessionListProps {
  sessions: AgentSessionSummary[]
  selectedSessionId?: string
  isLoading: boolean
  historyError?: string
  now?: Date
  onSelect(sessionId: string): void
  onCreate(): void | Promise<void>
  onRetry(): void
  onRename(sessionId: string, title: string): Promise<void>
  onDelete(sessionId: string): Promise<void>
}

function localStartOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function groupAgentSessions(sessions: AgentSessionSummary[], now: Date): SessionGroup[] {
  const today = localStartOfDay(now)
  const recentBoundary = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
  const grouped: Record<SessionGroup['label'], AgentSessionSummary[]> = {
    今天: [],
    '最近 7 天': [],
    更早: [],
  }

  sessions.forEach((item) => {
    const date = localStartOfDay(new Date(item.lastMessageAt))
    if (date >= today) grouped.今天.push(item)
    else if (date >= recentBoundary) grouped['最近 7 天'].push(item)
    else grouped.更早.push(item)
  })

  return (Object.keys(grouped) as SessionGroup['label'][])
    .map((label) => ({ label, sessions: grouped[label] }))
    .filter((group) => group.sessions.length > 0)
}

function MoreIcon() {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg>
}

function SessionItem({
  session,
  selected,
  disabled,
  selectRef,
  onSelect,
  onRename,
  onDelete,
}: {
  session: AgentSessionSummary
  selected: boolean
  disabled: boolean
  selectRef(element: HTMLButtonElement | null): void
  onSelect(): void
  onRename(returnTarget: HTMLButtonElement | null): void
  onDelete(returnTarget: HTMLButtonElement | null): void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <li className="agent-session-list__item" data-current={selected || undefined}>
      <button
        ref={selectRef}
        type="button"
        className="agent-session-list__select"
        aria-label={`打开会话：${session.title}`}
        aria-current={selected ? 'page' : undefined}
        disabled={disabled}
        onClick={onSelect}
      >
        {session.title}
      </button>
      <IconButton
        buttonRef={triggerRef}
        label={`打开“${session.title}”会话操作`}
        icon={<MoreIcon />}
        size="sm"
        disabled={disabled}
        className="agent-session-list__more"
        onClick={() => setOpen((value) => !value)}
      />
      <Popover open={open} anchorRef={triggerRef} onOpenChange={setOpen} ariaLabel={`“${session.title}”会话操作`}>
        <div className="agent-session-list__actions">
          <button type="button" onClick={() => { const target = triggerRef.current; setOpen(false); onRename(target) }}>重命名会话</button>
          <button type="button" onClick={() => { const target = triggerRef.current; setOpen(false); onDelete(target) }}>删除会话</button>
        </div>
      </Popover>
    </li>
  )
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function AgentSessionList({
  sessions,
  selectedSessionId,
  isLoading,
  historyError,
  now = new Date(),
  onSelect,
  onCreate,
  onRetry,
  onRename,
  onDelete,
}: AgentSessionListProps) {
  const [renameTarget, setRenameTarget] = useState<DialogTarget>()
  const [deleteTarget, setDeleteTarget] = useState<DialogTarget>()
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [renamePending, setRenamePending] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const newSessionRef = useRef<HTMLButtonElement>(null)
  const sessionRefs = useRef(new Map<string, HTMLButtonElement>())
  const groups = groupAgentSessions(sessions, now)

  const focusAfterDialog = (target: DialogTarget) => {
    window.setTimeout(() => {
      const sessionItem = sessionRefs.current.get(target.session.id)
      const candidates = [target.returnTarget, sessionItem, newSessionRef.current]
      candidates.find((candidate) => candidate?.isConnected && !candidate.disabled)?.focus()
    }, 0)
  }

  const openRename = (item: AgentSessionSummary, returnTarget: HTMLButtonElement | null) => {
    setRenameValue(item.title)
    setRenameError('')
    setRenameTarget({ session: item, returnTarget })
  }

  const closeRename = () => {
    if (renamePending || !renameTarget) return
    const target = renameTarget
    setRenameTarget(undefined)
    setRenameError('')
    focusAfterDialog(target)
  }

  const submitRename = async (event: FormEvent) => {
    event.preventDefault()
    if (!renameTarget || renamePending) return
    const title = renameValue.trim()
    if (title.length < 1 || title.length > 160) {
      setRenameError('请输入 1 到 160 个字符。')
      return
    }
    setRenameError('')
    setRenamePending(true)
    try {
      await onRename(renameTarget.session.id, title)
      const target = renameTarget
      setRenameTarget(undefined)
      focusAfterDialog(target)
    } catch (error) {
      setRenameError(errorMessage(error, '重命名失败，请重试。'))
    } finally {
      setRenamePending(false)
    }
  }

  const openDelete = (item: AgentSessionSummary, returnTarget: HTMLButtonElement | null) => {
    setDeleteError('')
    setDeleteTarget({ session: item, returnTarget })
  }

  const closeDelete = () => {
    if (deletePending || !deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(undefined)
    setDeleteError('')
    focusAfterDialog(target)
  }

  const submitDelete = async () => {
    if (!deleteTarget || deletePending) return
    setDeleteError('')
    setDeletePending(true)
    const visualSessionIds = groups.flatMap((group) => group.sessions.map((item) => item.id))
    const targetIndex = visualSessionIds.indexOf(deleteTarget.session.id)
    const fallbackIds = [visualSessionIds[targetIndex + 1], visualSessionIds[targetIndex - 1]].filter(Boolean)
    try {
      await onDelete(deleteTarget.session.id)
      setDeleteTarget(undefined)
      window.setTimeout(() => {
        const fallback = fallbackIds
          .map((id) => sessionRefs.current.get(id))
          .find((candidate) => candidate?.isConnected && !candidate.disabled)
        const newSession = newSessionRef.current
        ;(fallback ?? (newSession?.isConnected && !newSession.disabled ? newSession : undefined))?.focus()
      }, 0)
    } catch (error) {
      setDeleteError(errorMessage(error, '删除失败，请重试。'))
    } finally {
      setDeletePending(false)
    }
  }

  return (
    <nav className="agent-session-list" aria-label="Agent 会话" aria-busy={isLoading || undefined}>
      <Button buttonRef={newSessionRef} variant="secondary" className="agent-session-list__new" aria-label="新建会话" disabled={isLoading} onClick={() => void onCreate()}>
        ＋ 新建会话
      </Button>
      {historyError ? (
        <div className="agent-session-list__error" role="alert">
          <p>{historyError}</p>
          <Button size="sm" variant="secondary" onClick={onRetry} aria-label="重试加载会话">重试</Button>
        </div>
      ) : null}
      {groups.map((group) => (
        <section key={group.label} className="agent-session-list__group" role="group" aria-label={group.label}>
          <h2>{group.label}</h2>
          <ul>
            {group.sessions.map((item) => (
              <SessionItem
                key={item.id}
                session={item}
                selected={item.id === selectedSessionId}
                disabled={isLoading}
                selectRef={(element) => {
                  if (element) sessionRefs.current.set(item.id, element)
                  else sessionRefs.current.delete(item.id)
                }}
                onSelect={() => onSelect(item.id)}
                onRename={(returnTarget) => openRename(item, returnTarget)}
                onDelete={(returnTarget) => openDelete(item, returnTarget)}
              />
            ))}
          </ul>
        </section>
      ))}
      {!sessions.length && !isLoading ? <p className="agent-session-list__empty">还没有会话</p> : null}
      {isLoading ? <p className="agent-session-list__loading" role="status">正在加载会话…</p> : null}

      <Dialog
        open={Boolean(renameTarget)}
        title="重命名会话"
        onOpenChange={(open) => { if (!open) closeRename() }}
        initialFocusRef={renameInputRef as RefObject<HTMLElement | null>}
        footer={(
          <>
            <Button variant="ghost" disabled={renamePending} onClick={closeRename}>取消</Button>
            <Button type="submit" form="agent-session-rename-form" disabled={renamePending} aria-label="保存名称">
              {renamePending ? '保存中…' : '保存'}
            </Button>
          </>
        )}
      >
        <form id="agent-session-rename-form" onSubmit={(event) => void submitRename(event)}>
          <TextField
            label="会话名称"
            inputRef={renameInputRef}
            value={renameValue}
            disabled={renamePending}
            error={renameError}
            onChange={(event) => { setRenameValue(event.target.value); if (renameError) setRenameError('') }}
          />
        </form>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        title="删除会话"
        description="将永久删除这段会话及其执行记录，此操作无法撤销。"
        onOpenChange={(open) => { if (!open) closeDelete() }}
        initialFocusRef={deleteCancelRef as RefObject<HTMLElement | null>}
        footer={(
          <>
            <Button buttonRef={deleteCancelRef} variant="secondary" disabled={deletePending} onClick={closeDelete} aria-label="取消删除">取消</Button>
            <Button variant="danger" disabled={deletePending} onClick={() => void submitDelete()} aria-label="确认删除会话">
              {deletePending ? '删除中…' : '删除'}
            </Button>
          </>
        )}
      >
        <p>会话“{deleteTarget?.session.title}”将从历史记录中移除。</p>
        {deleteError ? <p className="agent-session-list__dialog-error" role="alert">{deleteError}</p> : null}
      </Dialog>
    </nav>
  )
}
