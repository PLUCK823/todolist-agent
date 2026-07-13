import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  completeTodo,
  createTodo,
  deleteTodo,
  fetchTodo,
  fetchTodos,
  uncompleteTodo,
  updateTodo,
} from './todo.api'
import type { PaginatedData, Todo, TodoFilters, UpdateTodoDTO } from './todo.types'

export const todoKeys = {
  all: ['todos'] as const,
  lists: () => [...todoKeys.all, 'list'] as const,
  list: (filters: TodoFilters) => [...todoKeys.lists(), filters] as const,
  details: () => [...todoKeys.all, 'detail'] as const,
  detail: (id: number) => [...todoKeys.details(), id] as const,
}

export function useTodos(filters: TodoFilters = {}) {
  return useQuery({ queryKey: todoKeys.list(filters), queryFn: () => fetchTodos(filters) })
}

export function useTodo(id: number | null) {
  return useQuery({
    queryKey: todoKeys.detail(id ?? -1),
    queryFn: () => fetchTodo(id!),
    enabled: id !== null,
  })
}

export function useTodoSummary() {
  const [all, active, completed] = useQueries({
    queries: [
      { queryKey: todoKeys.list({ page: 1, page_size: 1 }), queryFn: () => fetchTodos({ page: 1, page_size: 1 }) },
      { queryKey: todoKeys.list({ page: 1, page_size: 1, completed: false }), queryFn: () => fetchTodos({ page: 1, page_size: 1, completed: false }) },
      { queryKey: todoKeys.list({ page: 1, page_size: 1, completed: true }), queryFn: () => fetchTodos({ page: 1, page_size: 1, completed: true }) },
    ],
  })
  return {
    total: all.data?.total ?? 0,
    active: active.data?.total ?? 0,
    completed: completed.data?.total ?? 0,
  }
}

export function useCreateTodo() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: createTodo,
    onSuccess: () => client.invalidateQueries({ queryKey: todoKeys.lists() }),
  })
}

export function useUpdateTodo() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: UpdateTodoDTO }) => updateTodo(id, dto),
    onSuccess: (todo) => {
      client.setQueryData(todoKeys.detail(todo.id), todo)
      return client.invalidateQueries({ queryKey: todoKeys.lists() })
    },
  })
}

export function useDeleteTodo() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: deleteTodo,
    onSuccess: () => client.invalidateQueries({ queryKey: todoKeys.lists() }),
  })
}

export interface TodoCompletionSnapshot {
  lists: Array<[readonly unknown[], PaginatedData<Todo> | undefined]>
  detail: Todo | undefined
  id: number
}

function filtersFromKey(key: readonly unknown[]): TodoFilters | null {
  if (key.length < 3 || key[0] !== 'todos' || key[1] !== 'list') return null
  const filters = key[2]
  return filters !== null && typeof filters === 'object' && !Array.isArray(filters)
    ? filters as TodoFilters
    : null
}

export function applyTodoCompletion(client: QueryClient, id: number, completed: boolean): TodoCompletionSnapshot {
  const lists = client.getQueriesData<PaginatedData<Todo>>({ queryKey: todoKeys.lists() })
  const detail = client.getQueryData<Todo>(todoKeys.detail(id))
  lists.forEach(([key, current]) => {
    const filters = filtersFromKey(key)
    if (!current || !filters) return
    const contains = current.items.some((todo) => todo.id === id)
    if (!contains) return
    const excluded = filters.completed !== undefined && filters.completed !== completed
    client.setQueryData<PaginatedData<Todo>>(key, {
      ...current,
      total: excluded ? Math.max(0, current.total - 1) : current.total,
      items: excluded
        ? current.items.filter((todo) => todo.id !== id)
        : current.items.map((todo) => todo.id === id ? { ...todo, completed } : todo),
    })
  })
  client.setQueryData<Todo>(todoKeys.detail(id), (current) => current ? { ...current, completed } : current)
  return { lists, detail, id }
}

export function restoreTodoCompletion(client: QueryClient, snapshot: TodoCompletionSnapshot) {
  snapshot.lists.forEach(([key, value]) => client.setQueryData(key, value))
  client.setQueryData(todoKeys.detail(snapshot.id), snapshot.detail)
}

function useToggleTodo(completed: boolean) {
  const client = useQueryClient()
  return useMutation<Todo, Error, number, TodoCompletionSnapshot>({
    mutationFn: completed ? completeTodo : uncompleteTodo,
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: todoKeys.lists() })
      return applyTodoCompletion(client, id, completed)
    },
    onError: (_error, _id, context) => {
      if (context) restoreTodoCompletion(client, context)
    },
    onSuccess: (todo) => client.setQueryData(todoKeys.detail(todo.id), todo),
    onSettled: () => client.invalidateQueries({ queryKey: todoKeys.lists() }),
  })
}

export function useCompleteTodo() {
  return useToggleTodo(true)
}

export function useUncompleteTodo() {
  return useToggleTodo(false)
}
