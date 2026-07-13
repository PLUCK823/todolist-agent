import { useState, type FormEvent } from 'react'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { TextField } from '../../shared/ui/TextField'
import { getApiErrorMessage } from './todo.api'
import type { Todo, TodoFormDTO, TodoPriority } from './todo.types'
import {
  APP_TIME_ZONE,
  dateTimeLocalToUtcRfc3339,
  utcRfc3339ToDateTimeLocal,
} from './time-contract'

interface TaskDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  todo?: Todo | null
  initialDueDate?: string
  timeZone?: string
  onOpenChange(open: boolean): void
  onSubmit(data: TodoFormDTO): Promise<void>
}

function toLocalInput(date: string | null | undefined, timeZone: string) {
  if (!date) return ''
  return utcRfc3339ToDateTimeLocal(date, timeZone)
}

export function TaskDialog({
  open,
  mode,
  todo,
  initialDueDate,
  timeZone = APP_TIME_ZONE,
  onOpenChange,
  onSubmit,
}: TaskDialogProps) {
  const [title, setTitle] = useState(todo?.title ?? '')
  const [description, setDescription] = useState(todo?.description ?? '')
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState(initialDueDate ?? toLocalInput(todo?.due_date, timeZone))
  const [validationError, setValidationError] = useState('')
  const [dueDateError, setDueDateError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) {
      setValidationError('请输入任务标题')
      return
    }
    setValidationError('')
    setDueDateError('')
    setRequestError('')
    let normalizedDueDate: string | null | undefined
    try {
      normalizedDueDate = dueDate
        ? dateTimeLocalToUtcRfc3339(dueDate, timeZone)
        : mode === 'edit' ? null : undefined
    } catch (error) {
      if (error instanceof RangeError) {
        setDueDateError('截止时间不存在，请重新选择')
        return
      }
      throw error
    }
    setSubmitting(true)
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        priority,
        ...(normalizedDueDate !== undefined ? { due_date: normalizedDueDate } : {}),
      })
    } catch (error) {
      setRequestError(getApiErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const dialogTitle = mode === 'create' ? '新建任务' : '编辑任务'
  return (
    <Dialog
      open={open}
      title={dialogTitle}
      description={mode === 'create' ? '记录下一件值得完成的事。' : '调整任务内容与安排。'}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next)
      }}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="task-form" disabled={submitting}>
            {submitting ? '保存中…' : mode === 'create' ? '创建任务' : '保存修改'}
          </Button>
        </>
      }
    >
      <form id="task-form" className="grid gap-5" onSubmit={handleSubmit}>
        <TextField
          autoFocus
          label="任务标题"
          value={title}
          maxLength={200}
          error={validationError}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">
          <span>任务描述</span>
          <textarea
            value={description}
            rows={4}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full resize-y rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2.5 text-sm font-normal leading-6 text-[var(--text)] placeholder:text-[var(--control-placeholder)] focus:border-[var(--primary)] focus:outline-none focus:shadow-[var(--focus-ring)]"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">
            <span>优先级</span>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as TodoPriority)}
              className="min-h-11 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm font-normal text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:shadow-[var(--focus-ring)]"
            >
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
          <TextField
            label="截止时间"
            type="datetime-local"
            value={dueDate}
            error={dueDateError}
            onChange={(event) => {
              setDueDate(event.target.value)
              if (dueDateError) setDueDateError('')
            }}
          />
        </div>
        {requestError ? (
          <p role="alert" className="m-0 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-[var(--danger-action)]">
            {requestError}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
