import { useMemo, useRef, useState } from 'react'
import { Button } from '../shared/ui/Button'
import { useToast } from '../shared/ui/toast-context'
import { getApiErrorMessage } from '../features/todos/todo.api'
import {
  useCompleteTodo,
  useCreateTodo,
  useUpcomingTodos,
  useUncompleteTodo,
  useUpdateTodo,
} from '../features/todos/todo.queries'
import { TaskDetailDialog } from '../features/todos/TaskDetailDialog'
import { TaskDialog } from '../features/todos/TaskDialog'
import { UpcomingTimeline } from '../features/todos/UpcomingTimeline'
import { localDateKey, upcomingUtcRange } from '../features/todos/upcoming-calendar'
import type { CreateTodoDTO, Todo, TodoFormDTO } from '../features/todos/todo.types'

interface UpcomingPageProps {
  now?: Date
}

export default function UpcomingPage({ now = new Date() }: UpcomingPageProps) {
  const [showCompleted, setShowCompleted] = useState(false)
  const [selectedDateKey, setSelectedDateKey] = useState(() => localDateKey(now))
  const [createOpen, setCreateOpen] = useState(false)
  const [detailTodo, setDetailTodo] = useState<Todo | null>(null)
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  const [pendingToggleIds, setPendingToggleIds] = useState<ReadonlySet<number>>(new Set())
  const toggleGuardsRef = useRef(new Set<number>())
  const toast = useToast()
  const range = upcomingUtcRange(now)
  const query = useUpcomingTodos(range.dueFrom, range.dueTo)
  const createMutation = useCreateTodo()
  const updateMutation = useUpdateTodo()
  const completeMutation = useCompleteTodo()
  const uncompleteMutation = useUncompleteTodo()
  const todos = useMemo(
    () => (query.data?.items ?? []).filter((todo) => todo.due_date && (showCompleted || !todo.completed)),
    [query.data, showCompleted],
  )

  async function create(data: TodoFormDTO) {
    const dto: CreateTodoDTO = {
      title: data.title,
      description: data.description,
      priority: data.priority,
      ...(typeof data.due_date === 'string' ? { due_date: data.due_date } : {}),
    }
    await createMutation.mutateAsync(dto)
    setCreateOpen(false)
    toast.addToast('success', '安排已创建')
  }

  async function update(data: TodoFormDTO) {
    if (!editingTodo) return
    await updateMutation.mutateAsync({ id: editingTodo.id, dto: data })
    setEditingTodo(null)
    toast.addToast('success', '安排已更新')
  }

  function toggle(todo: Todo) {
    if (toggleGuardsRef.current.has(todo.id)) return
    toggleGuardsRef.current.add(todo.id)
    setPendingToggleIds((current) => new Set(current).add(todo.id))
    const mutation = todo.completed ? uncompleteMutation : completeMutation
    void mutation.mutateAsync(todo.id)
      .catch((error) => toast.addToast('error', getApiErrorMessage(error)))
      .finally(() => {
        toggleGuardsRef.current.delete(todo.id)
        setPendingToggleIds((current) => {
          const next = new Set(current)
          next.delete(todo.id)
          return next
        })
      })
  }

  return (
    <main className="mx-auto w-full max-w-[1120px] px-7 py-7 xl:px-9">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="m-0 text-[11px] font-bold tracking-[.18em] text-[var(--text-secondary)]">接下来 7 天</p>
          <h1 className="mb-0 mt-2 text-[28px] font-extrabold tracking-[-.04em] text-[var(--text)]">近期安排</h1>
          <p className="mb-0 mt-1 text-sm text-[var(--text-secondary)]">按时间查看即将到来的任务</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--text-secondary)] focus-within:shadow-[var(--focus-ring)]">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
              className="h-4 w-4 accent-[var(--primary-action)]"
            />
            显示已完成
          </label>
          <Button onClick={() => setCreateOpen(true)} leadingIcon={<span className="text-lg leading-none">＋</span>}>
            添加安排
          </Button>
        </div>
      </header>

      {query.isLoading ? (
        <div role="status" aria-label="正在加载近期安排" className="mt-5 grid gap-3">
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }, (_, index) => <div key={index} className="h-[74px] animate-pulse rounded-[var(--radius-panel)] border border-[var(--border)] bg-white/70" />)}
          </div>
          <div className="h-24 animate-pulse rounded-[var(--radius-panel)] border border-[var(--border)] bg-white/70" />
        </div>
      ) : query.isError ? (
        <section role="alert" className="mt-5 rounded-[var(--radius-panel)] border border-red-100 bg-red-50 p-7 text-center">
          <h2 className="m-0 text-base font-bold text-[var(--text)]">暂时无法加载近期安排</h2>
          <p className="mb-4 mt-2 text-sm text-[var(--text-secondary)]">{getApiErrorMessage(query.error)}</p>
          <Button size="sm" onClick={() => query.refetch()}>重新加载</Button>
        </section>
      ) : (
        <UpcomingTimeline
          now={now}
          todos={todos}
          selectedDateKey={selectedDateKey}
          onSelectedDateChange={setSelectedDateKey}
          pendingToggleIds={pendingToggleIds}
          onOpen={setDetailTodo}
          onToggle={toggle}
        />
      )}

      {createOpen ? (
        <TaskDialog
          key={`create-${selectedDateKey}`}
          open
          mode="create"
          initialDueDate={`${selectedDateKey}T09:00`}
          onOpenChange={setCreateOpen}
          onSubmit={create}
        />
      ) : null}
      {detailTodo ? (
        <TaskDetailDialog
          open
          todo={detailTodo}
          onOpenChange={(next) => { if (!next) setDetailTodo(null) }}
          onEdit={() => {
            setEditingTodo(detailTodo)
            setDetailTodo(null)
          }}
        />
      ) : null}
      {editingTodo ? (
        <TaskDialog
          key={`edit-${editingTodo.id}`}
          open
          mode="edit"
          todo={editingTodo}
          onOpenChange={(next) => { if (!next) setEditingTodo(null) }}
          onSubmit={update}
        />
      ) : null}
    </main>
  )
}
