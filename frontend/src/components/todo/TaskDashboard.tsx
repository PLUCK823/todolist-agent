import { type FC, useState, useCallback, useMemo } from 'react'
import type { Todo, TodoFilters, CreateTodoDTO, UpdateTodoDTO } from '../../types/todo'
import {
  useTodos,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
  useCompleteTodo,
  useUncompleteTodo,
} from '../../hooks/useTodos'
import { useDebounce } from '../../hooks/useDebounce'
import { TaskCard } from './TaskCard'
import { TaskDialog } from './TaskDialog'
import { FilterPopover } from './FilterPopover'

const PAGE_SIZE = 10

export const TaskDashboard: FC = () => {
  // ---- UI state ----
  const [filters, setFilters] = useState<TodoFilters>({
    page: 1,
    page_size: PAGE_SIZE,
  })
  const [keyword, setKeyword] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)

  // Debounced keyword so we don't fire queries on every keystroke
  const debouncedKeyword = useDebounce(keyword, 300)

  // Merge debounced keyword into filters
  const effectiveFilters = useMemo<TodoFilters>(
    () => ({
      ...filters,
      keyword: debouncedKeyword || undefined,
      page_size: filters.page_size || PAGE_SIZE,
    }),
    [filters, debouncedKeyword],
  )

  // ---- Data fetching ----
  const { data, isLoading, isError, error, refetch } = useTodos(effectiveFilters)

  const todos: Todo[] = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / (filters.page_size || PAGE_SIZE)))

  // ---- Mutations ----
  const createMutation = useCreateTodo()
  const updateMutation = useUpdateTodo()
  const deleteMutation = useDeleteTodo()
  const completeMutation = useCompleteTodo()
  const uncompleteMutation = useUncompleteTodo()

  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    completeMutation.isPending ||
    uncompleteMutation.isPending

  // ---- Handlers: Dialog ----
  const openCreateDialog = useCallback(() => {
    setEditingTodo(null)
    setDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((todo: Todo) => {
    setEditingTodo(todo)
    setDialogOpen(true)
  }, [])

  const closeDialog = useCallback(() => {
    if (isMutating) return
    setDialogOpen(false)
    setEditingTodo(null)
  }, [isMutating])

  const handleSubmitDialog = useCallback(
    (dto: CreateTodoDTO) => {
      if (editingTodo) {
        // Update existing
        updateMutation.mutate(
          { id: editingTodo.id, dto: dto as UpdateTodoDTO },
          {
            onSuccess: () => closeDialog(),
          },
        )
      } else {
        // Create new
        createMutation.mutate(dto, {
          onSuccess: () => closeDialog(),
        })
      }
    },
    [editingTodo, createMutation, updateMutation, closeDialog],
  )

  // ---- Handlers: CRUD ----
  const handleComplete = useCallback(
    (todo: Todo) => {
      completeMutation.mutate(todo.id)
    },
    [completeMutation],
  )

  const handleUncomplete = useCallback(
    (todo: Todo) => {
      uncompleteMutation.mutate(todo.id)
    },
    [uncompleteMutation],
  )

  const handleDelete = useCallback(
    (todo: Todo) => {
      deleteMutation.mutate(todo.id)
    },
    [deleteMutation],
  )

  // ---- Handlers: Pagination ----
  const goToPage = useCallback(
    (page: number) => {
      if (page < 1 || page > totalPages) return
      setFilters((prev) => ({ ...prev, page }))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [totalPages],
  )

  // ---- Handlers: Filters ----
  const handleFilterChange = useCallback((newFilters: TodoFilters) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
  }, [])

  const hasActiveFilters = filters.completed !== undefined || filters.priority !== undefined

  // ---- Render helpers ----
  const pageNumbers = useMemo(() => {
    const pages: number[] = []
    const maxVisible = 5
    let start = Math.max(1, (filters.page || 1) - Math.floor(maxVisible / 2))
    const end = Math.min(totalPages, start + maxVisible - 1)
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1)
    }
    for (let i = start; i <= end; i++) {
      pages.push(i)
    }
    return pages
  }, [filters.page, totalPages])

  // ---- Render ----
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
          My Tasks
        </h1>
        {total > 0 && (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {total} task{total !== 1 ? 's' : ''}
            {hasActiveFilters && ' (filtered)'}
          </p>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5">
        {/* Search */}
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] text-sm pointer-events-none select-none">
            &#128269;
          </span>
          <input
            type="text"
            data-testid="search-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Search tasks..."
            className="w-full rounded-xl border border-[var(--color-border)] bg-white pl-9 pr-4 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] transition-colors"
          />
        </div>

        {/* Filter toggle */}
        <div className="relative">
          <button
            type="button"
            data-testid="filter-toggle"
            onClick={() => setFilterOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
              filterOpen || hasActiveFilters
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]'
                : 'border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50'
            }`}
          >
            <span>&#9776;</span>
            <span>Filter</span>
            {hasActiveFilters && (
              <span className="flex h-2 w-2 rounded-full bg-[var(--color-primary)]" />
            )}
          </button>
          <FilterPopover
            key={`${filterOpen ? 'open' : 'closed'}-${JSON.stringify(filters)}`}
            filters={filters}
            onFilterChange={handleFilterChange}
            isOpen={filterOpen}
            onClose={() => setFilterOpen(false)}
          />
        </div>

        {/* Sort indicator */}
        {filters.sort_by && filters.sort_by !== 'created_at' && (
          <span className="text-xs text-[var(--color-text-secondary)] bg-gray-100 rounded-lg px-2 py-1 shrink-0">
            {filters.sort_by === 'priority' ? 'Priority' : 'Due date'}{' '}
            {filters.order === 'asc' ? '↑' : '↓'}
          </span>
        )}

        {/* Create button */}
        <button
          type="button"
          data-testid="create-task-button"
          onClick={openCreateDialog}
          className="shrink-0 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-hover)] transition-colors shadow-sm"
        >
          + New Task
        </button>
      </div>

      {/* Content area */}
      <div data-testid="task-list-area">
        {/* Loading state */}
        {isLoading && (
          <div data-testid="loading-state" className="space-y-3 py-8">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-[var(--color-border)] bg-white px-5 py-4"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-5 w-5 rounded-full bg-gray-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-gray-200" />
                    <div className="h-3 w-1/2 rounded bg-gray-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {!isLoading && isError && (
          <div
            data-testid="error-state"
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <span className="text-4xl mb-4">&#9888;</span>
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
              Something went wrong
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4 max-w-sm">
              {error instanceof Error ? error.message : 'Failed to load tasks. Please try again.'}
            </p>
            <button
              type="button"
              data-testid="retry-button"
              onClick={() => refetch()}
              className="rounded-lg bg-[var(--color-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-hover)] transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && todos.length === 0 && (
          <div
            data-testid="empty-state"
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <span className="text-5xl mb-4">&#128203;</span>
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
              No tasks yet
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-5 max-w-sm">
              {keyword || hasActiveFilters
                ? 'No tasks match your filters. Try adjusting your search or clear the filters.'
                : 'Click the button above to create your first task!'}
            </p>
            {(keyword || hasActiveFilters) && (
              <button
                type="button"
                data-testid="clear-filters-button"
                onClick={() => {
                  setKeyword('')
                  setFilters({ page: 1, page_size: PAGE_SIZE })
                }}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-gray-50 transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {/* Task list */}
        {!isLoading && !isError && todos.length > 0 && (
          <div data-testid="task-list" className="space-y-3">
            {todos.map((todo) => (
              <TaskCard
                key={todo.id}
                todo={todo}
                onComplete={handleComplete}
                onUncomplete={handleUncomplete}
                onEdit={openEditDialog}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!isLoading && !isError && totalPages > 1 && (
        <div
          data-testid="pagination"
          className="flex items-center justify-center gap-1.5 mt-8"
        >
          <button
            type="button"
            data-testid="page-prev"
            onClick={() => goToPage((filters.page || 1) - 1)}
            disabled={(filters.page || 1) <= 1}
            className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            &#8249; Prev
          </button>

          {pageNumbers.map((p) => (
            <button
              key={p}
              type="button"
              data-testid={`page-${p}`}
              onClick={() => goToPage(p)}
              className={`min-w-[2.25rem] rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                p === (filters.page || 1)
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-gray-100'
              }`}
            >
              {p}
            </button>
          ))}

          <button
            type="button"
            data-testid="page-next"
            onClick={() => goToPage((filters.page || 1) + 1)}
            disabled={(filters.page || 1) >= totalPages}
            className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next &#8250;
          </button>
        </div>
      )}

      {/* Dialog */}
      <TaskDialog
        key={`${dialogOpen ? 'open' : 'closed'}-${editingTodo?.id ?? 'new'}`}
        isOpen={dialogOpen}
        onClose={closeDialog}
        onSubmit={handleSubmitDialog}
        initialData={editingTodo}
        isSubmitting={isMutating}
      />
    </div>
  )
}
