import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  ApiError,
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
  return useQuery({ queryKey: todoKeys.list(filters), queryFn: ({ signal }) => fetchTodos(filters, signal) })
}

const MAX_UPCOMING_PAGES = 100

export async function fetchUpcomingTodos(
  dueFrom: string,
  dueTo: string,
  signal?: AbortSignal,
): Promise<PaginatedData<Todo>> {
  const filters: TodoFilters = {
    page_size: 100,
    sort_by: 'due_date',
    order: 'asc',
    due_from: dueFrom,
    due_to: dueTo,
  }
  const first = await fetchTodos({ ...filters, page: 1 }, signal)
  if (first.page !== 1) {
    throw new ApiError(-2, '任务分页响应异常，请稍后重试', 200)
  }
  const pageCount = Math.ceil(first.total / first.page_size)
  if (pageCount > MAX_UPCOMING_PAGES) {
    throw new ApiError(-2, '任务分页响应异常，请稍后重试', 200)
  }
  const unique = new Map<number, Todo>()
  first.items.forEach((todo) => unique.set(todo.id, todo))
  for (let page = 2; page <= pageCount; page += 1) {
    const before = unique.size
    const result = await fetchTodos({ ...filters, page }, signal)
    if (result.page !== page || result.page_size !== first.page_size) {
      throw new ApiError(-2, '任务分页响应异常，请稍后重试', 200)
    }
    result.items.forEach((todo) => unique.set(todo.id, todo))
    if (unique.size === before && unique.size < first.total) {
      throw new ApiError(-2, '任务分页响应无进展，请稍后重试', 200)
    }
  }
  if (unique.size !== first.total) {
    throw new ApiError(-2, '任务分页响应异常，请稍后重试', 200)
  }
  const items = [...unique.values()].sort((left, right) => {
    const dueDifference = Date.parse(left.due_date!) - Date.parse(right.due_date!)
    return dueDifference || left.id - right.id
  })
  return { items, total: items.length, page: 1, page_size: first.page_size }
}

export function useUpcomingTodos(dueFrom: string, dueTo: string) {
  const filters: TodoFilters = {
    page_size: 100,
    sort_by: 'due_date',
    order: 'asc',
    due_from: dueFrom,
    due_to: dueTo,
  }
  return useQuery({
    queryKey: todoKeys.list(filters),
    queryFn: ({ signal }) => fetchUpcomingTodos(dueFrom, dueTo, signal),
  })
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

interface TodoListCompletionPatch {
  key: readonly unknown[]
  originalItem: Todo | undefined
  originalIndex: number
  totalDelta: number
  originalLength: number
}

export interface TodoCompletionSnapshot {
  lists: TodoListCompletionPatch[]
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

function hasNonCompletionFilters(filters: TodoFilters) {
  return filters.priority !== undefined || Boolean(filters.keyword?.trim())
}

export function matchesNonCompletionFilters(todo: Todo, filters: TodoFilters) {
  if (filters.priority !== undefined && todo.priority !== filters.priority) return false
  const keyword = filters.keyword?.trim().toLowerCase()
  if (keyword) {
    // Mirrors the repository's normalized `LOWER(title) LIKE %keyword%` contract.
    return todo.title.toLowerCase().includes(keyword)
  }
  return true
}

export function applyTodoCompletion(client: QueryClient, id: number, completed: boolean): TodoCompletionSnapshot {
  const cachedLists = client.getQueriesData<PaginatedData<Todo>>({ queryKey: todoKeys.lists() })
  const detail = client.getQueryData<Todo>(todoKeys.detail(id))
  const original = detail
    ? { ...detail }
    : cachedLists.flatMap(([, current]) => current?.items ?? []).find((todo) => todo.id === id)
  const changesCompletion = original?.completed !== completed
  const lists: TodoListCompletionPatch[] = []
  cachedLists.forEach(([key, current]) => {
    const filters = filtersFromKey(key)
    if (!current || !filters) return
    const originalIndex = current.items.findIndex((todo) => todo.id === id)
    const originalItem = originalIndex >= 0 ? current.items[originalIndex] : undefined
    const isTarget = filters.completed === completed
    const isSource = filters.completed === !completed
    const canAdjustTotal = changesCompletion && (original
      ? matchesNonCompletionFilters(original, filters)
      : !hasNonCompletionFilters(filters))
    const totalDelta = canAdjustTotal ? (isTarget ? 1 : isSource ? -1 : 0) : 0
    const items = !changesCompletion
      ? current.items
      : isSource
        ? current.items.filter((todo) => todo.id !== id)
        : current.items.map((todo) => todo.id === id ? { ...todo, completed } : todo)

    lists.push({ key, originalItem, originalIndex, totalDelta, originalLength: current.items.length })
    client.setQueryData<PaginatedData<Todo>>(key, {
      ...current,
      total: Math.max(0, current.total + totalDelta),
      items,
    })
  })
  if (changesCompletion) {
    client.setQueryData<Todo>(todoKeys.detail(id), (current) => current ? { ...current, completed } : current)
  }
  return { lists, detail, id }
}

export function restoreTodoCompletion(client: QueryClient, snapshot: TodoCompletionSnapshot) {
  snapshot.lists.forEach(({ key, originalItem, originalIndex, totalDelta, originalLength }) => {
    client.setQueryData<PaginatedData<Todo>>(key, (current) => {
      if (!current) return current
      const items = current.items.filter((todo) => todo.id !== snapshot.id)
      if (originalItem && originalIndex >= 0) {
        items.splice(Math.min(originalIndex, items.length), 0, originalItem)
      }
      return {
        ...current,
        total: Math.max(0, current.total - totalDelta),
        items: items.slice(0, Math.max(current.page_size, originalLength)),
      }
    })
  })
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
    onSettled: () => {
      void client.invalidateQueries({ queryKey: todoKeys.lists() }).catch(() => undefined)
    },
  })
}

export function useCompleteTodo() {
  return useToggleTodo(true)
}

export function useUncompleteTodo() {
  return useToggleTodo(false)
}
