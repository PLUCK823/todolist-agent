import { type FC, useState, useCallback } from 'react'
import type { Todo } from '../../types/todo'

interface TaskCardProps {
  todo: Todo
  onComplete: (todo: Todo) => void
  onUncomplete: (todo: Todo) => void
  onEdit: (todo: Todo) => void
  onDelete: (todo: Todo) => void
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

function formatDueDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  const due = new Date(dateStr)
  const now = new Date()
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffMs = dueDay.getTime() - nowDay.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    const abs = Math.abs(diffDays)
    if (abs === 1) return 'Yesterday'
    return `${abs} days ago`
  }
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays <= 7) return `In ${diffDays} days`
  return `${MONTHS[due.getMonth()]} ${due.getDate()}`
}

const PRIORITY_MAP = {
  high: {
    label: 'High',
    dot: 'bg-[var(--color-high-priority)]',
    badge: 'bg-red-50 text-[var(--color-high-priority)]',
  },
  medium: {
    label: 'Med',
    dot: 'bg-[var(--color-medium-priority)]',
    badge: 'bg-yellow-50 text-[var(--color-medium-priority)]',
  },
  low: {
    label: 'Low',
    dot: 'bg-[var(--color-low-priority)]',
    badge: 'bg-gray-100 text-[var(--color-low-priority)]',
  },
} as const

export const TaskCard: FC<TaskCardProps> = ({
  todo,
  onComplete,
  onUncomplete,
  onEdit,
  onDelete,
}) => {
  const [showActions, setShowActions] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const pri = PRIORITY_MAP[todo.priority]
  const dueLabel = formatDueDate(todo.due_date)
  const isOverdue =
    todo.due_date !== null &&
    !todo.completed &&
    new Date(todo.due_date) < new Date(new Date().toDateString())

  const handleCheckboxChange = useCallback(() => {
    if (todo.completed) {
      onUncomplete(todo)
    } else {
      onComplete(todo)
    }
  }, [todo, onComplete, onUncomplete])

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (confirmDelete) {
        onDelete(todo)
        setConfirmDelete(false)
      } else {
        setConfirmDelete(true)
        setTimeout(() => setConfirmDelete(false), 3000)
      }
    },
    [todo, onDelete, confirmDelete],
  )

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onEdit(todo)
    },
    [todo, onEdit],
  )

  return (
    <div
      data-testid="task-card"
      className={`
        group relative rounded-xl border border-[var(--color-border)] bg-white
        px-5 py-4 transition-all duration-200 cursor-pointer
        hover:shadow-md hover:border-[var(--color-primary)]/30
        ${todo.completed ? 'opacity-60' : ''}
      `}
      onClick={() => onEdit(todo)}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => {
        setShowActions(false)
        setConfirmDelete(false)
      }}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          type="button"
          data-testid="task-checkbox"
          onClick={(e) => {
            e.stopPropagation()
            handleCheckboxChange()
          }}
          className={`
            mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full
            border-2 transition-colors duration-150
            ${
              todo.completed
                ? 'border-[var(--color-success)] bg-[var(--color-success)] text-white'
                : 'border-[var(--color-border)] hover:border-[var(--color-primary)] bg-white'
            }
          `}
          aria-label={todo.completed ? 'Mark as incomplete' : 'Mark as complete'}
        >
          {todo.completed && (
            <span className="text-xs font-bold leading-none">&#10003;</span>
          )}
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              data-testid="task-title"
              className={`text-sm font-semibold text-[var(--color-text-primary)] truncate ${
                todo.completed ? 'line-through' : ''
              }`}
            >
              {todo.title}
            </h3>
            {/* Priority badge */}
            <span
              data-testid="priority-badge"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${pri.badge}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${pri.dot}`} />
              {pri.label}
            </span>
          </div>

          {/* Description preview */}
          {todo.description && (
            <p
              data-testid="task-description"
              className="mt-1 text-xs text-[var(--color-text-secondary)] line-clamp-2"
            >
              {todo.description}
            </p>
          )}

          {/* Due date */}
          {dueLabel && (
            <span
              data-testid="task-due-date"
              className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${
                isOverdue
                  ? 'text-[var(--color-danger)]'
                  : 'text-[var(--color-text-secondary)]'
              }`}
            >
              <span aria-hidden="true">&#9200;</span>
              {dueLabel}
              {isOverdue && ' (overdue)'}
            </span>
          )}
        </div>

        {/* Action buttons - visible on hover */}
        <div
          data-testid="task-actions"
          className={`flex shrink-0 items-center gap-1 transition-opacity duration-150 ${
            showActions ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            type="button"
            data-testid="edit-button"
            onClick={handleEdit}
            className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)] transition-colors"
            aria-label="Edit task"
            title="Edit"
          >
            &#9998;
          </button>
          <button
            type="button"
            data-testid="delete-button"
            onClick={handleDelete}
            className={`rounded-lg p-1.5 transition-colors ${
              confirmDelete
                ? 'bg-red-50 text-[var(--color-danger)]'
                : 'text-[var(--color-text-secondary)] hover:bg-red-50 hover:text-[var(--color-danger)]'
            }`}
            aria-label={confirmDelete ? 'Confirm delete' : 'Delete task'}
            title={confirmDelete ? 'Click again to confirm' : 'Delete'}
          >
            &#128465;
          </button>
        </div>
      </div>
    </div>
  )
}
