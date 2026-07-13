import axios, { AxiosError } from 'axios'
import type {
  ApiErrorPayload,
  ApiResponse,
  CreateTodoDTO,
  PaginatedData,
  Todo,
  TodoFilters,
  UpdateTodoDTO,
} from './todo.types'
import { isRfc3339WithOffset } from './time-contract'

export class ApiError extends Error {
  readonly code: number
  readonly status: number

  constructor(code: number, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

function isErrorPayload(value: unknown): value is ApiErrorPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return (
    typeof payload.code === 'number' &&
    typeof payload.message === 'string' &&
    payload.data === null
  )
}

function normalizeError(error: unknown): Error {
  if (error instanceof ApiError) return error
  if (axios.isCancel(error)) return error
  if (error instanceof AxiosError) {
    if (!error.response) {
      return new ApiError(-1, '网络异常，请检查连接后重试', 0)
    }
    if (isErrorPayload(error.response.data)) {
      return new ApiError(
        error.response.data.code,
        error.response.data.message,
        error.response.status,
      )
    }
    return new ApiError(-2, '服务响应异常，请稍后重试', error.response.status)
  }
  return new ApiError(-1, '网络异常，请检查连接后重试', 0)
}

export function getApiErrorMessage(error: unknown): string {
  return normalizeError(error).message
}

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(normalizeError(error)),
)

function toParams(filters: TodoFilters): Record<string, string> {
  const params: Record<string, string> = {}
  if (filters.page) params.page = String(filters.page)
  if (filters.page_size) params.page_size = String(filters.page_size)
  if (filters.completed !== undefined) params.completed = String(filters.completed)
  if (filters.priority) params.priority = filters.priority
  const keyword = filters.keyword?.trim()
  if (keyword) params.keyword = keyword
  if (filters.sort_by) params.sort_by = filters.sort_by
  if (filters.order) params.order = filters.order
  if (filters.due_from) params.due_from = filters.due_from
  if (filters.due_to) params.due_to = filters.due_to
  return params
}

function contractError(status: number) {
  return new ApiError(-2, '服务响应异常，请稍后重试', status)
}

function validateTodo(value: unknown, status: number): Todo {
  if (!value || typeof value !== 'object') throw contractError(status)
  const todo = value as Partial<Todo>
  if (
    typeof todo.id !== 'number' || typeof todo.title !== 'string' ||
    typeof todo.description !== 'string' || typeof todo.completed !== 'boolean' ||
    !['high', 'medium', 'low'].includes(todo.priority ?? '') ||
    (todo.due_date !== null && (typeof todo.due_date !== 'string' || !isRfc3339WithOffset(todo.due_date))) ||
    typeof todo.created_at !== 'string' || !isRfc3339WithOffset(todo.created_at) ||
    typeof todo.updated_at !== 'string' || !isRfc3339WithOffset(todo.updated_at)
  ) throw contractError(status)
  return todo as Todo
}

function validatePage(value: unknown, status: number): PaginatedData<Todo> {
  if (!value || typeof value !== 'object') throw contractError(status)
  const page = value as Partial<PaginatedData<unknown>>
  if (
    !Array.isArray(page.items) || !Number.isInteger(page.total) || page.total! < 0 ||
    !Number.isInteger(page.page) || page.page! < 1 ||
    !Number.isInteger(page.page_size) || page.page_size! < 1 ||
    page.items.length > (page.page_size ?? 0)
  ) throw contractError(status)
  return { ...page, items: page.items.map((todo) => validateTodo(todo, status)) } as PaginatedData<Todo>
}

export async function fetchTodos(filters: TodoFilters = {}, signal?: AbortSignal): Promise<PaginatedData<Todo>> {
  const response = await client.get<ApiResponse<PaginatedData<Todo>>>('/todos', {
    params: toParams(filters),
    signal,
  })
  return validatePage(response.data.data, response.status)
}

export async function fetchTodo(id: number): Promise<Todo> {
  const response = await client.get<ApiResponse<Todo>>(`/todos/${id}`)
  return validateTodo(response.data.data, response.status)
}

export async function createTodo(dto: CreateTodoDTO): Promise<Todo> {
  const response = await client.post<ApiResponse<Todo>>('/todos', dto)
  return validateTodo(response.data.data, response.status)
}

export async function updateTodo(id: number, dto: UpdateTodoDTO): Promise<Todo> {
  const response = await client.put<ApiResponse<Todo>>(`/todos/${id}`, dto)
  return validateTodo(response.data.data, response.status)
}

export async function deleteTodo(id: number): Promise<void> {
  await client.delete(`/todos/${id}`)
}

export async function completeTodo(id: number): Promise<Todo> {
  const response = await client.patch<ApiResponse<Todo>>(`/todos/${id}/complete`)
  return validateTodo(response.data.data, response.status)
}

export async function uncompleteTodo(id: number): Promise<Todo> {
  const response = await client.patch<ApiResponse<Todo>>(`/todos/${id}/uncomplete`)
  return validateTodo(response.data.data, response.status)
}
