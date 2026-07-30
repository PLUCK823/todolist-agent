import { useState, type FormEvent } from 'react'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import type { TodoPriority, UpdateTodoDTO } from './todo.types'

interface BatchEditDialogProps {
  open: boolean
  count: number
  pending: boolean
  onOpenChange(open: boolean): void
  onSubmit(patch: UpdateTodoDTO): Promise<void>
}

export function BatchEditDialog({ open, count, pending, onOpenChange, onSubmit }: BatchEditDialogProps) {
  const [usePriority, setUsePriority] = useState(false)
  const [priority, setPriority] = useState<TodoPriority>('medium')
  const [useDescription, setUseDescription] = useState(false)
  const [description, setDescription] = useState('')
  const [clearDueDate, setClearDueDate] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const patch: UpdateTodoDTO = {
      ...(usePriority ? { priority } : {}),
      ...(useDescription ? { description: description.trim() } : {}),
      ...(clearDueDate ? { due_date: null } : {}),
    }
    if (!Object.keys(patch).length) { setError('请至少选择一个要修改的字段'); return }
    setError('')
    await onSubmit(patch)
  }

  return (
    <Dialog open={open} title="批量编辑任务" description={`同一修改将原子应用到已选择的 ${count} 项任务。`} onOpenChange={(next) => { if (!pending) onOpenChange(next) }} footer={<><Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" form="batch-edit-form" disabled={pending}>{pending ? '保存中…' : '应用修改'}</Button></>}>
      <form id="batch-edit-form" className="grid gap-4" onSubmit={submit}>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={usePriority} onChange={(event) => setUsePriority(event.target.checked)} />修改优先级</label>
        <select aria-label="批量优先级" disabled={!usePriority} value={priority} onChange={(event) => setPriority(event.target.value as TodoPriority)} className="min-h-10 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm">
          <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
        </select>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={useDescription} onChange={(event) => setUseDescription(event.target.checked)} />修改描述</label>
        <textarea aria-label="批量任务描述" disabled={!useDescription} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="resize-y rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={clearDueDate} onChange={(event) => setClearDueDate(event.target.checked)} />清除截止时间</label>
        {error ? <p role="alert" className="m-0 text-sm text-[var(--danger-surface-text)]">{error}</p> : null}
      </form>
    </Dialog>
  )
}
