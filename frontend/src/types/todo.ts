export interface Todo {
  id: number
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  completed: boolean
  due_date: string | null
  created_at: string
  updated_at: string
}

export interface CreateTodoDTO {
  title: string
  description?: string
  priority?: 'high' | 'medium' | 'low'
  due_date?: string
}

export interface UpdateTodoDTO {
  title?: string
  description?: string
  priority?: 'high' | 'medium' | 'low'
  due_date?: string
}

export interface ApiResponse<T> {
  code: number
  message: string
  data: T
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
  priority?: 'high' | 'medium' | 'low'
  keyword?: string
  sort_by?: 'created_at' | 'priority' | 'due_date'
  order?: 'asc' | 'desc'
}
