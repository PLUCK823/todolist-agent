import { useMemo, useRef, useState } from 'react'
import ConfirmDialog from '../../components/common/ConfirmDialog'
import { useDebounce } from '../../hooks/useDebounce'
import { ShellHeaderActionsSlot } from '../shell/ShellHeaderActions'
import { Button } from '../../shared/ui/Button'
import { useToast } from '../../shared/ui/toast-context'
import { getApiErrorMessage } from './todo.api'
import {
  useCompleteTodo,
  useCreateTodo,
  useDeleteTodo,
  useTodos,
  useTodoSummary,
  useUncompleteTodo,
  useUpdateTodo,
  useBatchDeleteTodos,
  useBatchSetTodoStatus,
  useBatchUpdateTodos,
} from './todo.queries'
import { TaskCard } from './TaskCard'
import { TaskDetailDialog } from './TaskDetailDialog'
import { TaskDialog } from './TaskDialog'
import { TaskFilters } from './TaskFilters'
import { BatchActionBar } from './BatchActionBar'
import { BatchEditDialog } from './BatchEditDialog'
import type { CreateTodoDTO, Todo, TodoFilters, TodoFormDTO, UpdateTodoDTO } from './todo.types'

const PAGE_SIZE = 10

function formatToday() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')} 年 ${get('month')} 月 ${get('day')} 日 · ${get('weekday')}`
}

function isSoon(todo: Todo) {
  if (!todo.due_date || todo.completed) return false
  const now = Date.now()
  const due = new Date(todo.due_date).getTime()
  return due <= now + 3 * 24 * 60 * 60 * 1000
}

function SummaryCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[0_1px_0_rgb(32_37_56_/_2%)]">
      <strong className="block text-xl tracking-[-.03em] text-[var(--text)]">{value}</strong>
      <span className="mt-1 block text-xs text-[var(--text-secondary)]">{label}</span>
    </div>
  )
}

function TaskGroup({ title, todos, onOpen, onToggle, onDelete, pendingToggleIds, selectionMode, selectedIds, onSelect }: {
  title: string
  todos: Todo[]
  onOpen(todo: Todo): void
  onToggle(todo: Todo): void
  onDelete(todo: Todo): void
  pendingToggleIds?: ReadonlySet<number>
  selectionMode: boolean
  selectedIds: ReadonlySet<number>
  onSelect(todo: Todo): void
}) {
  if (!todos.length) return null
  return (
    <section className="grid gap-2" aria-labelledby={`group-${title}`}>
      <header className="flex items-center justify-between px-0.5">
        <h2 id={`group-${title}`} className="m-0 text-xs font-bold tracking-[.02em] text-[var(--text)]">{title}</h2>
        <span className="text-[11px] text-[var(--text-secondary)]">{todos.length} 项</span>
      </header>
      <div className="grid gap-2">
        {todos.map((todo) => <TaskCard key={todo.id} todo={todo} togglePending={pendingToggleIds?.has(todo.id)} selectionMode={selectionMode} selected={selectedIds.has(todo.id)} onSelect={onSelect} onOpen={onOpen} onToggle={onToggle} onDelete={onDelete} />)}
      </div>
    </section>
  )
}

export function TaskDashboard() {
  const [filters, setFilters] = useState<TodoFilters>({ page: 1, page_size: PAGE_SIZE })
  const [keyword, setKeyword] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailTodo, setDetailTodo] = useState<Todo | null>(null)
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  const [deletingTodo, setDeletingTodo] = useState<Todo | null>(null)
  const [pendingToggleIds, setPendingToggleIds] = useState<ReadonlySet<number>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<Map<number, Todo>>(new Map())
  const [batchEditOpen, setBatchEditOpen] = useState(false)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const toggleGuardsRef = useRef(new Set<number>())
  const deleteGuardRef = useRef(false)
  const debouncedKeyword = useDebounce(keyword, 300)
  const toast = useToast()
  const effectiveFilters = useMemo(() => ({
    ...filters,
    keyword: debouncedKeyword.trim() || undefined,
  }), [debouncedKeyword, filters])

  const query = useTodos(effectiveFilters)
  const summary = useTodoSummary()
  const createMutation = useCreateTodo()
  const updateMutation = useUpdateTodo()
  const deleteMutation = useDeleteTodo()
  const completeMutation = useCompleteTodo()
  const uncompleteMutation = useUncompleteTodo()
  const batchStatusMutation = useBatchSetTodoStatus()
  const batchUpdateMutation = useBatchUpdateTodos()
  const batchDeleteMutation = useBatchDeleteTodos()
  const todos = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const completed = todos.filter((todo) => todo.completed)
  const active = todos.filter((todo) => !todo.completed)
  const soon = active.filter(isSoon)
  const later = active.filter((todo) => !isSoon(todo))
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(keyword || filters.completed !== undefined || filters.priority)
  const selectedIds = useMemo(() => new Set(selected.keys()), [selected])
  const allCurrentSelected = todos.length > 0 && todos.every((todo) => selected.has(todo.id))
  const batchPending = batchStatusMutation.isPending || batchUpdateMutation.isPending || batchDeleteMutation.isPending
  function clearSelection() {
    setSelected(new Map())
    setSelectionMode(false)
  }

  function toggleSelection(todo: Todo) {
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(todo.id)) next.delete(todo.id)
      else if (next.size < 100) next.set(todo.id, todo)
      else toast.addToast('error', '一次最多选择 100 项任务')
      return next
    })
  }

  function toggleCurrentPage() {
    setSelected((current) => {
      const next = new Map(current)
      if (allCurrentSelected) todos.forEach((todo) => next.delete(todo.id))
      else {
        const missing = todos.filter((todo) => !next.has(todo.id))
        if (next.size + missing.length > 100) { toast.addToast('error', '一次最多选择 100 项任务'); return current }
        missing.forEach((todo) => next.set(todo.id, todo))
      }
      return next
    })
  }

  async function batchStatus(completed: boolean) {
    try {
      await batchStatusMutation.mutateAsync({ ids: [...selected.keys()], completed })
      toast.addToast('success', completed ? '所选任务已完成' : '所选任务已恢复')
      clearSelection()
    } catch (error) { toast.addToast('error', getApiErrorMessage(error)) }
  }

  async function batchUpdate(patch: UpdateTodoDTO) {
    try {
      await batchUpdateMutation.mutateAsync([...selected.keys()].map((id) => ({ id, ...patch })))
      setBatchEditOpen(false)
      toast.addToast('success', '所选任务已更新')
      clearSelection()
    } catch (error) { toast.addToast('error', getApiErrorMessage(error)); throw error }
  }

  async function batchDelete() {
    try {
      await batchDeleteMutation.mutateAsync([...selected.keys()])
      setBatchDeleteOpen(false)
      toast.addToast('success', '所选任务已删除')
      clearSelection()
    } catch (error) { toast.addToast('error', getApiErrorMessage(error)) }
  }

  async function create(data: TodoFormDTO) {
    const dto: CreateTodoDTO = {
      title: data.title,
      description: data.description,
      priority: data.priority,
      ...(typeof data.due_date === 'string' ? { due_date: data.due_date } : {}),
    }
    await createMutation.mutateAsync(dto)
    setCreateOpen(false)
    toast.addToast('success', '任务已创建')
  }

  async function update(data: TodoFormDTO) {
    if (!editingTodo) return
    await updateMutation.mutateAsync({ id: editingTodo.id, dto: data })
    setEditingTodo(null)
    toast.addToast('success', '任务已更新')
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

  async function remove() {
    if (!deletingTodo || deleteGuardRef.current) return
    deleteGuardRef.current = true
    try {
      await deleteMutation.mutateAsync(deletingTodo.id)
      if ((filters.page ?? 1) > 1 && todos.length === 1) {
        setFilters((current) => ({ ...current, page: Math.max(1, (current.page ?? 1) - 1) }))
      }
      setDeletingTodo(null)
      toast.addToast('success', '任务已删除')
    } catch (error) {
      toast.addToast('error', getApiErrorMessage(error))
    } finally {
      deleteGuardRef.current = false
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-7 py-7 xl:px-9">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="m-0 text-[11px] font-bold tracking-[.18em] text-[var(--text-secondary)]">{formatToday()}</p>
          <h1 className="mb-0 mt-2 text-[28px] font-extrabold tracking-[-.04em] text-[var(--text)]">今天，保持专注</h1>
          <p className="mb-0 mt-1 text-sm text-[var(--text-secondary)]">还有 {summary.active} 项任务等待完成</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => { if (selectionMode) clearSelection(); else setSelectionMode(true) }}>{selectionMode ? '退出选择' : '选择任务'}</Button>
          <Button variant="secondary" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))} leadingIcon={<span>✦</span>}>快速询问 <kbd>⌘K</kbd></Button>
          <Button onClick={() => setCreateOpen(true)} leadingIcon={<span className="text-lg leading-none">＋</span>}>新建任务</Button>
          <ShellHeaderActionsSlot />
        </div>
      </header>

      <section aria-label="任务摘要" className="mt-5 grid grid-cols-3 gap-3">
        <SummaryCard value={summary.total} label="全部任务" />
        <SummaryCard value={summary.active} label="进行中" />
        <SummaryCard value={summary.completed} label="已完成" />
      </section>

      <div className="mt-4">
        <TaskFilters filters={filters} onChange={(next) => { clearSelection(); setFilters(next) }} keyword={keyword} onKeywordChange={(value) => { clearSelection(); setKeyword(value); setFilters((current) => ({ ...current, page: 1 })) }} />
      </div>

      <div className="mt-5 min-h-64">
        {selectionMode && todos.length ? <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]"><input type="checkbox" aria-label="选择当前页" checked={allCurrentSelected} onChange={toggleCurrentPage} className="h-4 w-4 accent-[var(--primary)]" />选择当前页（已选 {selected.size}/100）</label> : null}
        {query.isLoading ? (
          <div role="status" className="grid gap-2" aria-label="正在加载任务">
            {[1, 2, 3].map((item) => <div key={item} className="h-[58px] animate-pulse rounded-[var(--radius-panel)] border border-[var(--border)] bg-[color:var(--surface)]/70" />)}
          </div>
        ) : query.isError ? (
          <section role="alert" className="rounded-[var(--radius-panel)] border border-[var(--danger-surface-border)] bg-[var(--danger-surface)] p-7 text-center">
            <h2 className="m-0 text-base font-bold text-[var(--text)]">暂时无法加载任务</h2>
            <p className="mb-4 mt-2 text-sm text-[var(--text-secondary)]">{getApiErrorMessage(query.error)}</p>
            <Button size="sm" onClick={() => query.refetch()}>重新加载</Button>
          </section>
        ) : todos.length === 0 ? (
          <section className="rounded-[var(--radius-panel)] border border-dashed border-[var(--border-strong)] bg-[color:var(--surface)]/55 p-10 text-center">
            <h2 className="m-0 text-base font-bold">{hasFilters ? '没有符合条件的任务' : '还没有任务'}</h2>
            <p className="mb-4 mt-2 text-sm text-[var(--text-secondary)]">{hasFilters ? '换个关键词或清除筛选后再试。' : '从一件清晰的小事开始。'}</p>
            {hasFilters ? <Button variant="secondary" size="sm" onClick={() => { setKeyword(''); setFilters({ page: 1, page_size: PAGE_SIZE }) }}>清除筛选</Button> : <Button size="sm" onClick={() => setCreateOpen(true)}>新建任务</Button>}
          </section>
        ) : (
          <div className="grid gap-5">
            <TaskGroup title="即将到期" todos={soon} pendingToggleIds={pendingToggleIds} selectionMode={selectionMode} selectedIds={selectedIds} onSelect={toggleSelection} onOpen={setDetailTodo} onToggle={toggle} onDelete={setDeletingTodo} />
            <TaskGroup title="稍后处理" todos={later} pendingToggleIds={pendingToggleIds} selectionMode={selectionMode} selectedIds={selectedIds} onSelect={toggleSelection} onOpen={setDetailTodo} onToggle={toggle} onDelete={setDeletingTodo} />
            <TaskGroup title="已完成" todos={completed} pendingToggleIds={pendingToggleIds} selectionMode={selectionMode} selectedIds={selectedIds} onSelect={toggleSelection} onOpen={setDetailTodo} onToggle={toggle} onDelete={setDeletingTodo} />
          </div>
        )}
      </div>

      {totalPages > 1 ? (
        <nav aria-label="任务分页" className="mt-6 flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" disabled={(filters.page ?? 1) <= 1} onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) - 1 }))}>上一页</Button>
          <span className="px-2 text-xs text-[var(--text-secondary)]">第 {filters.page ?? 1} / {totalPages} 页</span>
          <Button variant="secondary" size="sm" disabled={(filters.page ?? 1) >= totalPages} onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}>下一页</Button>
        </nav>
      ) : null}

      {createOpen ? <TaskDialog key="create" open mode="create" onOpenChange={setCreateOpen} onSubmit={create} /> : null}
      {detailTodo ? <TaskDetailDialog open todo={detailTodo} onOpenChange={(next) => { if (!next) setDetailTodo(null) }} onEdit={() => { setEditingTodo(detailTodo); setDetailTodo(null) }} /> : null}
      {editingTodo ? <TaskDialog key={`edit-${editingTodo.id}`} open mode="edit" todo={editingTodo} onOpenChange={(next) => { if (!next) setEditingTodo(null) }} onSubmit={update} /> : null}
      <BatchActionBar count={selected.size} pending={batchPending} onComplete={() => void batchStatus(true)} onRestore={() => void batchStatus(false)} onEdit={() => setBatchEditOpen(true)} onDelete={() => setBatchDeleteOpen(true)} onClear={clearSelection} />
      {batchEditOpen ? <BatchEditDialog open count={selected.size} pending={batchUpdateMutation.isPending} onOpenChange={setBatchEditOpen} onSubmit={batchUpdate} /> : null}
      <ConfirmDialog isOpen={batchDeleteOpen} title="批量删除任务" message={<>确定删除已选择的 {selected.size} 项任务吗？此操作无法撤销。</>} confirmLabel={batchDeleteMutation.isPending ? '删除中…' : '确认删除'} confirmDisabled={batchDeleteMutation.isPending} pending={batchDeleteMutation.isPending} onCancel={() => { if (!batchDeleteMutation.isPending) setBatchDeleteOpen(false) }} onConfirm={() => { if (!batchDeleteMutation.isPending) void batchDelete() }} variant="danger" />
      <ConfirmDialog
        isOpen={deletingTodo !== null}
        title="删除任务"
        message={<>确定删除“{deletingTodo?.title}”吗？此操作无法撤销。</>}
        confirmLabel={deleteMutation.isPending ? '删除中…' : '确认删除'}
        confirmDisabled={deleteMutation.isPending}
        pending={deleteMutation.isPending}
        onCancel={() => { if (!deleteMutation.isPending) setDeletingTodo(null) }}
        onConfirm={() => { if (!deleteMutation.isPending) void remove() }}
        variant="danger"
      />
    </div>
  )
}
