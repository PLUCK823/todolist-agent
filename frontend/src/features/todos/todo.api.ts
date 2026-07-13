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

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
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
  if (filters.keyword) params.keyword = filters.keyword
  if (filters.sort_by) params.sort_by = filters.sort_by
  if (filters.order) params.order = filters.order
  return params
}

export async function fetchTodos(filters: TodoFilters = {}): Promise<PaginatedData<Todo>> {
  const response = await client.get<ApiResponse<PaginatedData<Todo>>>('/todos', {
    params: toParams(filters),
  })
  return response.data.data
}

export async function fetchTodo(id: number): Promise<Todo> {
  const response = await client.get<ApiResponse<Todo>>(`/todos/${id}`)
  return response.data.data
}

export async function createTodo(dto: CreateTodoDTO): Promise<Todo> {
  const response = await client.post<ApiResponse<Todo>>('/todos', dto)
  return response.data.data
}

export async function updateTodo(id: number, dto: UpdateTodoDTO): Promise<Todo> {
  const response = await client.put<ApiResponse<Todo>>(`/todos/${id}`, dto)
  return response.data.data
}

export async function deleteTodo(id: number): Promise<void> {
  await client.delete(`/todos/${id}`)
}

export async function completeTodo(id: number): Promise<Todo> {
  const response = await client.patch<ApiResponse<Todo>>(`/todos/${id}/complete`)
  return response.data.data
}

export async function uncompleteTodo(id: number): Promise<Todo> {
  const response = await client.patch<ApiResponse<Todo>>(`/todos/${id}/uncomplete`)
  return response.data.data
}
