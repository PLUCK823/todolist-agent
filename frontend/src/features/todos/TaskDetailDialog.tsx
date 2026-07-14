import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import type { Todo } from './todo.types'
import { formatAppDateTime } from './time-contract'

interface TaskDetailDialogProps {
  open: boolean
  todo: Todo
  onOpenChange(open: boolean): void
  onEdit(): void
}

const priorityLabels = { high: '高优先级', medium: '中优先级', low: '低优先级' }

function formatDate(value: string | null) {
  if (!value) return '未设置'
  return formatAppDateTime(value)
}

export function TaskDetailDialog({ open, todo, onOpenChange, onEdit }: TaskDetailDialogProps) {
  return (
    <Dialog
      open={open}
      title="任务详情"
      description={todo.title}
      onOpenChange={onOpenChange}
      footer={<Button onClick={onEdit}>编辑任务</Button>}
    >
      <div className="min-w-0 grid gap-5 text-sm">
        <dl className="m-0">
          <div>
          <dt className="font-semibold text-[var(--text-secondary)]">描述</dt>
          <dd className="mb-0 ml-0 mt-1 break-words whitespace-pre-wrap leading-6 text-[var(--text)]">
            {todo.description || '暂无描述'}
          </dd>
          </div>
        </dl>
        <dl className="m-0 grid grid-cols-2 gap-4 rounded-xl bg-[var(--surface-subtle)] p-4">
          <div><dt className="text-[var(--text-secondary)]">优先级</dt><dd className="m-0 mt-1 font-semibold">{priorityLabels[todo.priority]}</dd></div>
          <div><dt className="text-[var(--text-secondary)]">截止时间</dt><dd className="m-0 mt-1 font-semibold">{formatDate(todo.due_date)}</dd></div>
          <div><dt className="text-[var(--text-secondary)]">状态</dt><dd className="m-0 mt-1 font-semibold">{todo.completed ? '已完成' : '进行中'}</dd></div>
          <div><dt className="text-[var(--text-secondary)]">更新时间</dt><dd className="m-0 mt-1 font-semibold">{formatDate(todo.updated_at)}</dd></div>
        </dl>
      </div>
    </Dialog>
  )
}
