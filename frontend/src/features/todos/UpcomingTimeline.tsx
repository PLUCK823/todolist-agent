import { useMemo, useState } from 'react'
import type { Todo } from './todo.types'
import { APP_TIME_ZONE } from './time-contract'
import { buildSevenDayWindow, localDateKey } from './upcoming-calendar'

function formatHeading(key: string, todayKey: string, showYear: boolean) {
  const [year, month, day] = key.split('-').map(Number)
  return `${showYear ? `${year} 年 ` : ''}${month} 月 ${day} 日${key === todayKey ? ' · 今天' : ''}`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

const priorityLabels = { high: '高优先级', medium: '中优先级', low: '低优先级' }
const priorityBorder = {
  high: 'border-l-[var(--danger-action)]',
  medium: 'border-l-[var(--warning)]',
  low: 'border-l-[var(--success-action)]',
}

interface UpcomingTimelineProps {
  now?: Date
  todos: Todo[]
  pendingToggleIds: ReadonlySet<number>
  selectedDateKey?: string
  onSelectedDateChange?(key: string): void
  onOpen(todo: Todo): void
  onToggle(todo: Todo): void
}

export function UpcomingTimeline({
  now = new Date(),
  todos,
  pendingToggleIds,
  selectedDateKey,
  onSelectedDateChange,
  onOpen,
  onToggle,
}: UpcomingTimelineProps) {
  const days = useMemo(() => buildSevenDayWindow(now), [now])
  const todayKey = localDateKey(now)
  const crossesYear = days.some((day) => day.year !== days[0]?.year)
  const [internalSelectedKey, setInternalSelectedKey] = useState(todayKey)
  const selectedKey = selectedDateKey ?? internalSelectedKey
  const selectedTodos = useMemo(
    () => todos
      .filter((todo) => todo.due_date && localDateKey(new Date(todo.due_date)) === selectedKey)
      .sort((left, right) => {
        const dueDifference = new Date(left.due_date!).getTime() - new Date(right.due_date!).getTime()
        return dueDifference || left.id - right.id
      }),
    [selectedKey, todos],
  )

  return (
    <section className="mt-5" aria-label="未来七日安排">
      <div className="grid grid-cols-7 gap-2" role="group" aria-label="选择日期">
        {days.map((day) => {
          const selected = day.key === selectedKey
          return (
            <button
              key={day.key}
              type="button"
              aria-label={`${day.label} ${day.weekday}`}
              aria-pressed={selected}
              aria-current={selected ? 'date' : undefined}
              onClick={() => {
                setInternalSelectedKey(day.key)
                onSelectedDateChange?.(day.key)
              }}
              className={`min-h-[74px] rounded-[var(--radius-panel)] border px-2 py-3 text-center transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] active:translate-y-px ${selected ? 'border-[var(--nav-bg)] bg-[var(--nav-bg)] text-white shadow-[0_12px_28px_rgb(32_37_56_/_18%)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:-translate-y-px hover:border-[var(--border-strong)]'}`}
            >
              <span className={`block text-xs font-semibold ${selected ? 'text-white/70' : 'text-[var(--text-secondary)]'}`}>{day.weekday}</span>
              <strong className="mt-1 block text-xl tracking-[-.03em]">{day.day}</strong>
              {crossesYear ? <span className={`mt-0.5 block text-[10px] ${selected ? 'text-white/70' : 'text-[var(--text-secondary)]'}`}>{day.year}</span> : null}
            </button>
          )
        })}
      </div>

      <header className="mt-6 flex items-center justify-between border-b border-[var(--border)] pb-3">
        <h2 className="m-0 text-sm font-bold tracking-[-.01em] text-[var(--text)]">
          {formatHeading(selectedKey, todayKey, crossesYear)}
        </h2>
        <span className="text-xs text-[var(--text-secondary)]">{selectedTodos.length} 项安排</span>
      </header>

      {selectedTodos.length === 0 ? (
        <div className="mt-3 rounded-[var(--radius-panel)] border border-dashed border-[var(--border-strong)] bg-[color:var(--surface)]/55 px-5 py-10 text-center">
          <p className="m-0 text-sm font-bold text-[var(--text)]">当天暂无安排</p>
          <p className="mb-0 mt-1 text-xs text-[var(--text-secondary)]">添加一个截止时间，让接下来更清晰。</p>
        </div>
      ) : (
        <ol className="m-0 mt-3 grid list-none gap-2 p-0">
          {selectedTodos.map((todo) => {
            const pending = pendingToggleIds.has(todo.id)
            return (
              <li key={todo.id} className="grid grid-cols-[56px_minmax(0,1fr)] items-stretch gap-3">
                <time dateTime={todo.due_date!} className="pt-4 text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                  {formatTime(todo.due_date!)}
                </time>
                <article className={`group flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] border border-l-[3px] px-3.5 py-3 shadow-[0_1px_0_rgb(32_37_56_/_2%)] transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-[var(--border-strong)] hover:shadow-[0_10px_26px_rgb(32_37_56_/_8%)] ${priorityBorder[todo.priority]} ${todo.completed ? 'border-[var(--border)] bg-[var(--surface-subtle)]' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
                  <button
                    type="button"
                    aria-label={`${todo.completed ? '取消完成' : '完成安排'}：${todo.title}`}
                    aria-pressed={todo.completed}
                    aria-busy={pending || undefined}
                    disabled={pending}
                    onClick={() => onToggle(todo)}
                    className={`grid h-8 w-8 flex-none place-items-center rounded-full border-[3px] text-xs font-bold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ${todo.completed ? 'border-[var(--success-action)] bg-[var(--success-action)] text-white' : 'border-[var(--control-border-strong)] bg-[var(--control-bg)] text-transparent hover:border-[var(--primary)]'}`}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    aria-label={`查看安排：${todo.title}`}
                    onClick={() => onOpen(todo)}
                    className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                  >
                    <strong className={`block truncate text-sm text-[var(--text)] ${todo.completed ? 'line-through' : ''}`}>{todo.title}</strong>
                    <span className="mt-1 block truncate text-xs text-[var(--text-secondary)]">
                      {priorityLabels[todo.priority]}{todo.description ? ` · ${todo.description}` : ''}
                    </span>
                  </button>
                </article>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
