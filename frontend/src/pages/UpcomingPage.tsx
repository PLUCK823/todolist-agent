import { useMemo, useState } from 'react'
import { useTodos, useCompleteTodo, useUncompleteTodo } from '../features/todos/todo.queries'
import type { Todo } from '../features/todos/todo.types'

export default function UpcomingPage() {
  const [showCompleted, setShowCompleted] = useState(false)
  const { data, isLoading, isError, refetch } = useTodos({
    sort_by: 'due_date',
    order: 'asc',
    page_size: 50,
  })
  const completeMutation = useCompleteTodo()
  const uncompleteMutation = useUncompleteTodo()

  const todos = useMemo(() => {
    if (!data) return []
    return data.items.filter(
      (t: Todo) => t.due_date !== null && (showCompleted || !t.completed),
    )
  }, [data, showCompleted])

  const groupedByDate = useMemo(() => {
    const groups: Record<string, Todo[]> = {}
    const today = new Date().toISOString().split('T')[0]

    for (const todo of todos) {
      const dateKey = todo.due_date!.split('T')[0]
      let label: string
      if (dateKey === today) {
        label = '今天'
      } else {
        const d = new Date(dateKey)
        label = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
      }
      if (!groups[label]) groups[label] = []
      groups[label].push(todo)
    }
    return groups
  }, [todos])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#1a1a2e' }}>
          近期安排
        </h1>
        <label className="flex items-center gap-2 text-sm" style={{ color: '#6b7280' }}>
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="rounded"
          />
          显示已完成
        </label>
      </div>

      {isLoading && (
        <div className="text-center py-12" style={{ color: '#6b7280' }}>
          加载中...
        </div>
      )}

      {isError && (
        <div className="text-center py-12">
          <p className="text-red-500 mb-4">加载失败，请重试</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 rounded-lg text-white"
            style={{ backgroundColor: '#7165ea' }}
          >
            重试
          </button>
        </div>
      )}

      {!isLoading && !isError && Object.keys(groupedByDate).length === 0 && (
        <div className="text-center py-12" style={{ color: '#6b7280' }}>
          <p className="text-lg">暂无近期安排</p>
          <p className="text-sm mt-2">去「我的任务」中添加带截止日期的任务吧</p>
        </div>
      )}

      {!isLoading &&
        !isError &&
        Object.entries(groupedByDate).map(([dateLabel, dateTodos]) => (
          <div key={dateLabel} className="mb-6">
            <h2
              className="text-sm font-semibold mb-3 uppercase tracking-wide"
              style={{ color: '#6b7280' }}
            >
              {dateLabel}
            </h2>
            <div className="space-y-2">
              {dateTodos.map((todo) => (
                <div
                  key={todo.id}
                  className={`flex items-center gap-3 p-3 rounded-lg bg-white border transition-opacity ${
                    todo.completed ? 'opacity-60' : ''
                  }`}
                  style={{ borderColor: '#e5e7eb' }}
                >
                  <button
                    onClick={() =>
                      todo.completed
                        ? uncompleteMutation.mutate(todo.id)
                        : completeMutation.mutate(todo.id)
                    }
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 ${
                      todo.completed ? 'border-green-500 bg-green-500 text-white' : 'border-gray-300'
                    }`}
                  >
                    {todo.completed ? '✓' : ''}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm truncate ${todo.completed ? 'line-through' : ''}`}
                      style={{ color: todo.completed ? '#6b7280' : '#1a1a2e' }}
                    >
                      {todo.title}
                    </p>
                    {todo.description && (
                      <p className="text-xs truncate" style={{ color: '#9ca3af' }}>
                        {todo.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      todo.priority === 'high'
                        ? 'bg-red-100 text-red-600'
                        : todo.priority === 'medium'
                          ? 'bg-yellow-100 text-yellow-600'
                          : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {todo.priority === 'high' ? '高' : todo.priority === 'medium' ? '中' : '低'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}
