import { type FC, useState, useEffect, useCallback, useRef } from 'react'
import type { Todo, CreateTodoDTO } from '../../types/todo'

interface TaskDialogProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateTodoDTO) => void
  initialData?: Todo | null
  isSubmitting: boolean
}

const MAX_TITLE_LENGTH = 200

export const TaskDialog: FC<TaskDialogProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  isSubmitting,
}) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<CreateTodoDTO['priority']>('medium')
  const [dueDate, setDueDate] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const dialogRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const isEditMode = !!initialData

  // Reset form when dialog opens or initialData changes
  useEffect(() => {
    if (isOpen) {
      setTitle(initialData?.title || '')
      setDescription(initialData?.description || '')
      setPriority(initialData?.priority || 'medium')
      // Only set due_date from existing data, don't prefill for new tasks
      setDueDate(initialData?.due_date ? initialData.due_date.slice(0, 10) : '')
      setErrors({})
      // Focus title input after animation
      requestAnimationFrame(() => {
        titleInputRef.current?.focus()
      })
    }
  }, [isOpen, initialData])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {}
    const trimmedTitle = title.trim()

    if (!trimmedTitle) {
      newErrors.title = 'Title is required'
    } else if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      newErrors.title = `Title must be ${MAX_TITLE_LENGTH} characters or less`
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [title])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!validate()) return
      onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_date: dueDate || undefined,
      })
    },
    [title, description, priority, dueDate, validate, onSubmit],
  )

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose()
      }
    },
    [onClose],
  )

  if (!isOpen) return null

  return (
    <div
      data-testid="task-dialog-overlay"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[15vh] backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        data-testid="task-dialog"
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl mx-4"
        role="dialog"
        aria-modal="true"
        aria-label={isEditMode ? 'Edit task' : 'Create task'}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {isEditMode ? 'Edit Task' : 'New Task'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--color-text-secondary)] hover:bg-gray-100 transition-colors"
            aria-label="Close dialog"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Title */}
          <div>
            <label
              htmlFor="task-title"
              className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
            >
              Title <span className="text-[var(--color-danger)]">*</span>
            </label>
            <input
              ref={titleInputRef}
              id="task-title"
              data-testid="task-title-input"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                if (errors.title) setErrors((prev) => ({ ...prev, title: '' }))
              }}
              maxLength={MAX_TITLE_LENGTH + 10}
              placeholder="What needs to be done?"
              className={`w-full rounded-lg border px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] transition-colors ${
                errors.title
                  ? 'border-[var(--color-danger)]'
                  : 'border-[var(--color-border)]'
              }`}
            />
            {errors.title && (
              <p
                data-testid="title-error"
                className="mt-1 text-xs text-[var(--color-danger)]"
              >
                {errors.title}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="task-description"
              className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
            >
              Description
            </label>
            <textarea
              id="task-description"
              data-testid="task-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Add a description (optional)"
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] transition-colors resize-none"
            />
          </div>

          {/* Priority & Due Date row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Priority */}
            <div>
              <label
                htmlFor="task-priority"
                className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
              >
                Priority
              </label>
              <select
                id="task-priority"
                data-testid="task-priority-select"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as CreateTodoDTO['priority'])
                }
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] transition-colors"
              >
                <option value="high">&#128308; High</option>
                <option value="medium">&#128993; Medium</option>
                <option value="low">&#9898; Low</option>
              </select>
            </div>

            {/* Due Date */}
            <div>
              <label
                htmlFor="task-due-date"
                className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
              >
                Due Date
              </label>
              <input
                id="task-due-date"
                data-testid="task-due-date-input"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="task-submit-button"
              disabled={isSubmitting}
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Saving...
                </span>
              ) : isEditMode ? (
                'Save Changes'
              ) : (
                'Create Task'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
