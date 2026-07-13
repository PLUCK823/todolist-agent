export type TodoPriority = 'high' | 'medium' | 'low'

export interface Todo {
  id: number
  title: string
  description: string
  priority: TodoPriority
  completed: boolean
  due_date: string | null
  created_at: string
  updated_at: string
}

export interface CreateTodoDTO {
  title: string
  description?: string
  priority?: TodoPriority
  due_date?: string
}

export interface UpdateTodoDTO {
  title?: string
  description?: string
  priority?: TodoPriority
  due_date?: string | null
}

export interface TodoFormDTO {
  title: string
  description?: string
  priority?: TodoPriority
  due_date?: string | null
}

export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export interface ApiErrorPayload {
  code: number
  message: string
  data: null
}

export interface PaginatedData<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface TodoFilters {
  page?: number
  page_size?: number
  completed?: boolean
  priority?: TodoPriority
  keyword?: string
  sort_by?: 'created_at' | 'priority' | 'due_date'
  order?: 'asc' | 'desc'
}
