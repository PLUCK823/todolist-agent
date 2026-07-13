import { type FC, useState, useEffect, useCallback, useRef } from 'react'
import type { TodoFilters } from '../../types/todo'

interface FilterPopoverProps {
  filters: TodoFilters
  onFilterChange: (filters: TodoFilters) => void
  isOpen: boolean
  onClose: () => void
}

type CompletionFilter = 'all' | 'active' | 'completed'
type PriorityFilter = 'all' | 'high' | 'medium' | 'low'
type SortBy = 'created_at' | 'priority' | 'due_date'
type SortOrder = 'asc' | 'desc'

interface SortOption {
  label: string
  sort_by: SortBy
  order: SortOrder
}

const SORT_OPTIONS: SortOption[] = [
  { label: 'Newest first', sort_by: 'created_at', order: 'desc' },
  { label: 'Oldest first', sort_by: 'created_at', order: 'asc' },
  { label: 'Priority (high-low)', sort_by: 'priority', order: 'desc' },
  { label: 'Priority (low-high)', sort_by: 'priority', order: 'asc' },
  { label: 'Due date (earliest)', sort_by: 'due_date', order: 'asc' },
  { label: 'Due date (latest)', sort_by: 'due_date', order: 'desc' },
]

const COMPLETION_OPTIONS: { value: CompletionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
]

const PRIORITY_OPTIONS: { value: PriorityFilter; label: string; color: string }[] = [
  { value: 'all', label: 'All', color: 'bg-[var(--color-text-secondary)]' },
  { value: 'high', label: 'High', color: 'bg-[var(--color-high-priority)]' },
  { value: 'medium', label: 'Medium', color: 'bg-[var(--color-medium-priority)]' },
  { value: 'low', label: 'Low', color: 'bg-[var(--color-low-priority)]' },
]

function completionToFilter(c: CompletionFilter): boolean | undefined {
  if (c === 'active') return false
  if (c === 'completed') return true
  return undefined
}

function filterToCompletion(completed: boolean | undefined): CompletionFilter {
  if (completed === false) return 'active'
  if (completed === true) return 'completed'
  return 'all'
}

export const FilterPopover: FC<FilterPopoverProps> = ({
  filters,
  onFilterChange,
  isOpen,
  onClose,
}) => {
  // Local draft state, initialized from current filters
  const [completion, setCompletion] = useState<CompletionFilter>(() =>
    filterToCompletion(filters.completed),
  )
  const [priority, setPriority] = useState<PriorityFilter>(() => filters.priority || 'all')
  const [selectedSortIndex, setSelectedSortIndex] = useState<number>(() => {
    const idx = SORT_OPTIONS.findIndex(
      (o) => o.sort_by === (filters.sort_by || 'created_at') && o.order === (filters.order || 'desc'),
    )
    return idx === -1 ? 0 : idx
  })

  const popoverRef = useRef<HTMLDivElement>(null)

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

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use mousedown so we capture before the filter button toggle re-opens
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen, onClose])

  const handleApply = useCallback(() => {
    const sortOpt = SORT_OPTIONS[selectedSortIndex]
    const newFilters: TodoFilters = {
      ...filters,
      completed: completionToFilter(completion),
      priority: priority === 'all' ? undefined : priority,
      sort_by: sortOpt.sort_by,
      order: sortOpt.order,
      page: 1, // reset to first page on filter change
    }
    onFilterChange(newFilters)
    onClose()
  }, [filters, completion, priority, selectedSortIndex, onFilterChange, onClose])

  const handleReset = useCallback(() => {
    setCompletion('all')
    setPriority('all')
    setSelectedSortIndex(0)
    // Immediately apply reset filters
    onFilterChange({ page: 1, page_size: filters.page_size || 20 })
    onClose()
  }, [filters.page_size, onFilterChange, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={popoverRef}
      data-testid="filter-popover"
      className="absolute top-full left-0 mt-2 w-80 rounded-xl border border-[var(--color-border)] bg-white shadow-lg z-40 p-5"
    >
      {/* Completion Status */}
      <fieldset className="mb-5">
        <legend className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
          Status
        </legend>
        <div className="flex gap-1.5">
          {COMPLETION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`completion-${opt.value}`}
              onClick={() => setCompletion(opt.value)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                completion === opt.value
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-gray-100 text-[var(--color-text-secondary)] hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Priority */}
      <fieldset className="mb-5">
        <legend className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
          Priority
        </legend>
        <div className="flex gap-1.5">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`priority-${opt.value}`}
              onClick={() => setPriority(opt.value)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                priority === opt.value
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-gray-100 text-[var(--color-text-secondary)] hover:bg-gray-200'
              }`}
            >
              {opt.value !== 'all' && (
                <span className={`h-1.5 w-1.5 rounded-full ${opt.color}`} />
              )}
              {opt.label}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Sort */}
      <fieldset className="mb-5">
        <legend className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
          Sort By
        </legend>
        <div className="space-y-1">
          {SORT_OPTIONS.map((opt, idx) => (
            <button
              key={`${opt.sort_by}-${opt.order}`}
              type="button"
              data-testid={`sort-${opt.sort_by}-${opt.order}`}
              onClick={() => setSelectedSortIndex(idx)}
              className={`w-full text-left rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedSortIndex === idx
                  ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          data-testid="filter-reset"
          onClick={handleReset}
          className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Reset
        </button>
        <button
          type="button"
          data-testid="filter-apply"
          onClick={handleApply}
          className="rounded-lg px-5 py-2 text-xs font-semibold text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] transition-colors shadow-sm"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
