import { IconButton } from '../../shared/ui/IconButton'
import type { Todo } from './todo.types'

interface TaskCardProps {
  todo: Todo
  onOpen(todo: Todo): void
  onToggle(todo: Todo): void
  onDelete(todo: Todo): void
  togglePending?: boolean
}

const priority = {
  high: { label: '高', className: 'bg-red-50 text-[#9f2f29]' },
  medium: { label: '中', className: 'bg-amber-50 text-[#744800]' },
  low: { label: '低', className: 'bg-emerald-50 text-[#276347]' },
}

function formatDueDate(value: string | null) {
  if (!value) return '未设置截止时间'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

export function TaskCard({ todo, onOpen, onToggle, onDelete, togglePending = false }: TaskCardProps) {
  const badge = priority[todo.priority]

  return (
    <article
      className="group flex min-h-[58px] items-center gap-3 rounded-[var(--radius-panel)] border border-[var(--border)] bg-white px-3.5 py-3 text-left shadow-[0_1px_0_rgb(32_37_56_/_2%)] transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-[var(--border-strong)] hover:shadow-[0_10px_26px_rgb(32_37_56_/_8%)]"
    >
      <button
        type="button"
        aria-label={`${todo.completed ? '取消完成' : '完成任务'}：${todo.title}`}
        aria-pressed={todo.completed}
        aria-busy={togglePending || undefined}
        disabled={togglePending}
        onClick={() => onToggle(todo)}
        className={`grid h-8 w-8 flex-none place-items-center rounded-full border-[3px] text-xs font-bold transition-colors ${todo.completed ? 'border-[var(--success-action)] bg-[var(--success-action)] text-white' : 'border-[var(--control-border-strong)] bg-white text-transparent hover:border-[var(--primary)]'}`}
      >
        ✓
      </button>
      <button
        type="button"
        aria-label={`查看任务：${todo.title}`}
        onClick={() => onOpen(todo)}
        className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        <div className="flex items-center gap-2">
          <strong className={`truncate text-sm text-[var(--text)] ${todo.completed ? 'line-through' : ''}`}>{todo.title}</strong>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.className}`}>{badge.label}</span>
        </div>
        <p className="mb-0 mt-1 truncate text-xs text-[var(--text-secondary)]">
          {formatDueDate(todo.due_date)}{todo.description ? ` · ${todo.description}` : ''}
        </p>
      </button>
      <IconButton
        label={`删除任务：${todo.title}`}
        size="sm"
        onClick={() => onDelete(todo)}
        className="text-[var(--text-secondary)]"
        icon={<svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><path d="M4 6h12M8 3h4l1 3H7l1-3Zm-2 3 1 11h6l1-11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      />
    </article>
  )
}
