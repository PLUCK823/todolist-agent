import { Button } from '../../shared/ui/Button'

interface BatchActionBarProps {
  count: number
  pending: boolean
  onComplete(): void
  onRestore(): void
  onEdit(): void
  onDelete(): void
  onClear(): void
}

export function BatchActionBar({ count, pending, onComplete, onRestore, onEdit, onDelete, onClear }: BatchActionBarProps) {
  if (!count) return null
  return (
    <div role="toolbar" aria-label="批量操作" className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 shadow-[var(--shadow-overlay)]">
      <strong className="px-2 text-sm text-[var(--text)]">已选择 {count} 项</strong>
      <Button size="sm" variant="secondary" disabled={pending} onClick={onComplete}>批量完成</Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={onRestore}>批量恢复</Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={onEdit}>批量编辑</Button>
      <Button size="sm" variant="danger" disabled={pending} onClick={onDelete}>批量删除</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onClear}>取消选择</Button>
    </div>
  )
}
