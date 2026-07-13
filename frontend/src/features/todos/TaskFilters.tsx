import { useRef, useState } from 'react'
import { Popover } from '../../shared/ui/Popover'
import type { TodoFilters } from './todo.types'

interface TaskFiltersProps {
  filters: TodoFilters
  onChange(filters: TodoFilters): void
  keyword?: string
  onKeywordChange?(keyword: string): void
}

const optionClass = 'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-subtle)] focus-visible:shadow-[var(--focus-ring)]'

export function TaskFilters({ filters, onChange, keyword = '', onKeywordChange }: TaskFiltersProps) {
  const [open, setOpen] = useState<'status' | 'priority' | null>(null)
  const statusRef = useRef<HTMLButtonElement>(null)
  const priorityRef = useRef<HTMLButtonElement>(null)

  const statusLabel = filters.completed === undefined ? '全部状态' : filters.completed ? '已完成' : '进行中'
  const priorityLabel = filters.priority ? `${{ high: '高', medium: '中', low: '低' }[filters.priority]}优先级` : '优先级'

  function patch(next: Partial<TodoFilters>) {
    onChange({ ...filters, ...next, page: 1 })
    setOpen(null)
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(15rem,1fr)_auto_auto_auto]">
      <label className="relative block">
        <span className="sr-only">搜索任务</span>
        <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="m12.4 12.4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        <input
          type="search"
          name="todo-search"
          aria-label="搜索任务"
          autoComplete="off"
          value={keyword}
          onChange={(event) => onKeywordChange?.(event.target.value)}
          placeholder="搜索任务…"
          className="min-h-10 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-white pl-10 pr-3 text-sm text-[var(--text)] placeholder:text-[var(--text-secondary)] focus:border-[var(--primary)] focus:outline-none focus:shadow-[var(--focus-ring)]"
        />
      </label>
      <div>
        <button ref={statusRef} type="button" aria-label={statusLabel} onClick={() => setOpen(open === 'status' ? null : 'status')} className="min-h-10 rounded-[var(--radius-control)] border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--text-secondary)] hover:border-[var(--border-strong)]">{statusLabel}<span aria-hidden="true">⌄</span></button>
        <Popover open={open === 'status'} anchorRef={statusRef} ariaLabel="状态筛选" onOpenChange={(next) => setOpen(next ? 'status' : null)}>
          <button className={optionClass} onClick={() => patch({ completed: undefined })}>全部状态</button>
          <button className={optionClass} onClick={() => patch({ completed: false })}>进行中</button>
          <button className={optionClass} onClick={() => patch({ completed: true })}>已完成</button>
        </Popover>
      </div>
      <div>
        <button ref={priorityRef} type="button" aria-label={priorityLabel} onClick={() => setOpen(open === 'priority' ? null : 'priority')} className="min-h-10 rounded-[var(--radius-control)] border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--text-secondary)] hover:border-[var(--border-strong)]">{priorityLabel}<span aria-hidden="true">⌄</span></button>
        <Popover open={open === 'priority'} anchorRef={priorityRef} ariaLabel="优先级筛选" onOpenChange={(next) => setOpen(next ? 'priority' : null)}>
          <button className={optionClass} onClick={() => patch({ priority: undefined })}>全部优先级</button>
          <button className={optionClass} onClick={() => patch({ priority: 'high' })}>高优先级</button>
          <button className={optionClass} onClick={() => patch({ priority: 'medium' })}>中优先级</button>
          <button className={optionClass} onClick={() => patch({ priority: 'low' })}>低优先级</button>
        </Popover>
      </div>
      <label className="sr-only" htmlFor="todo-sort">任务排序</label>
      <select
        id="todo-sort"
        aria-label="任务排序"
        value={`${filters.sort_by ?? 'created_at'}:${filters.order ?? 'desc'}`}
        onChange={(event) => {
          const [sort_by, order] = event.target.value.split(':') as [TodoFilters['sort_by'], TodoFilters['order']]
          patch({ sort_by, order })
        }}
        className="min-h-10 rounded-[var(--radius-control)] border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--text-secondary)] focus:border-[var(--primary)] focus:outline-none focus:shadow-[var(--focus-ring)]"
      >
        <option value="created_at:desc">最近创建</option>
        <option value="due_date:asc">截止时间</option>
        <option value="priority:desc">优先级从高到低</option>
        <option value="priority:asc">优先级从低到高</option>
      </select>
    </div>
  )
}
