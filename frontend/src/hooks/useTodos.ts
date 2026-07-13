import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Todo, CreateTodoDTO, UpdateTodoDTO, TodoFilters, PaginatedData } from '../types/todo'
import {
  fetchTodos,
  fetchTodo,
  createTodo,
  updateTodo,
  deleteTodo,
  completeTodo,
  uncompleteTodo,
} from '../services/todoApi'

export function useTodos(filters: TodoFilters = {}) {
  return useQuery<PaginatedData<Todo>>({
    queryKey: ['todos', filters],
    queryFn: () => fetchTodos(filters),
  })
}

export function useTodo(id: number | null) {
  return useQuery<Todo>({
    queryKey: ['todo', id],
    queryFn: () => fetchTodo(id!),
    enabled: id !== null && id !== undefined,
  })
}

export function useCreateTodo() {
  const queryClient = useQueryClient()
  return useMutation<Todo, Error, CreateTodoDTO>({
    mutationFn: createTodo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  })
}

export function useUpdateTodo() {
  const queryClient = useQueryClient()
  return useMutation<Todo, Error, { id: number; dto: UpdateTodoDTO }>({
    mutationFn: ({ id, dto }) => updateTodo(id, dto),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['todos'] })
      queryClient.invalidateQueries({ queryKey: ['todo', variables.id] })
    },
  })
}

export function useDeleteTodo() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: deleteTodo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  })
}

export function useCompleteTodo() {
  const queryClient = useQueryClient()
  return useMutation<Todo, Error, number>({
    mutationFn: completeTodo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  })
}

export function useUncompleteTodo() {
  const queryClient = useQueryClient()
  return useMutation<Todo, Error, number>({
    mutationFn: uncompleteTodo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  })
}
