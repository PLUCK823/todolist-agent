import axios from 'axios'
import type { Todo, CreateTodoDTO, UpdateTodoDTO, ApiResponse, PaginatedData, TodoFilters } from '../types/todo'

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

export async function fetchTodos(filters?: TodoFilters): Promise<PaginatedData<Todo>> {
  const params: Record<string, string> = {}
  if (filters) {
    if (filters.page) params.page = String(filters.page)
    if (filters.page_size) params.page_size = String(filters.page_size)
    if (filters.completed !== undefined) params.completed = String(filters.completed)
    if (filters.priority) params.priority = filters.priority
    if (filters.keyword) params.keyword = filters.keyword
    if (filters.sort_by) params.sort_by = filters.sort_by
    if (filters.order) params.order = filters.order
  }
  const res = await client.get<ApiResponse<PaginatedData<Todo>>>('/todos', { params })
  return res.data.data
}

export async function fetchTodo(id: number): Promise<Todo> {
  const res = await client.get<ApiResponse<Todo>>(`/todos/${id}`)
  return res.data.data
}

export async function createTodo(dto: CreateTodoDTO): Promise<Todo> {
  const res = await client.post<ApiResponse<Todo>>('/todos', dto)
  return res.data.data
}

export async function updateTodo(id: number, dto: UpdateTodoDTO): Promise<Todo> {
  const res = await client.put<ApiResponse<Todo>>(`/todos/${id}`, dto)
  return res.data.data
}

export async function deleteTodo(id: number): Promise<void> {
  await client.delete(`/todos/${id}`)
}

export async function completeTodo(id: number): Promise<Todo> {
  const res = await client.patch<ApiResponse<Todo>>(`/todos/${id}/complete`)
  return res.data.data
}

export async function uncompleteTodo(id: number): Promise<Todo> {
  const res = await client.patch<ApiResponse<Todo>>(`/todos/${id}/uncomplete`)
  return res.data.data
}
