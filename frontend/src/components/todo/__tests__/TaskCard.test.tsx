import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../../test/render'
import { TaskCard } from '../TaskCard'
import type { Todo } from '../../../types/todo'

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 1,
    title: 'Test Task',
    description: 'A sample description',
    priority: 'medium',
    completed: false,
    due_date: '2026-07-20T00:00:00Z',
    created_at: '2026-07-10T08:00:00Z',
    updated_at: '2026-07-10T08:00:00Z',
    ...overrides,
  }
}

describe('TaskCard', () => {
  let onComplete: ReturnType<typeof vi.fn<(todo: Todo) => void>>
  let onUncomplete: ReturnType<typeof vi.fn<(todo: Todo) => void>>
  let onEdit: ReturnType<typeof vi.fn<(todo: Todo) => void>>
  let onDelete: ReturnType<typeof vi.fn<(todo: Todo) => void>>

  beforeEach(() => {
    onComplete = vi.fn<(todo: Todo) => void>()
    onUncomplete = vi.fn<(todo: Todo) => void>()
    onEdit = vi.fn<(todo: Todo) => void>()
    onDelete = vi.fn<(todo: Todo) => void>()
  })

  function renderCard(todo: Todo) {
    return renderWithProviders(
      <TaskCard
        todo={todo}
        onComplete={onComplete}
        onUncomplete={onUncomplete}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    )
  }

  describe('rendering', () => {
    it('displays the todo title', () => {
      renderCard(makeTodo({ title: 'Buy groceries' }))
      expect(screen.getByTestId('task-title')).toHaveTextContent('Buy groceries')
    })

    it('displays the description preview', () => {
      renderCard(makeTodo({ description: 'Milk, eggs, bread' }))
      expect(screen.getByTestId('task-description')).toHaveTextContent('Milk, eggs, bread')
    })

    it('does not show description when it is empty', () => {
      renderCard(makeTodo({ description: '' }))
      expect(screen.queryByTestId('task-description')).not.toBeInTheDocument()
    })

    it('shows the due date label', () => {
      renderCard(makeTodo({ due_date: '2026-07-20T00:00:00Z' }))
      const dueEl = screen.getByTestId('task-due-date')
      expect(dueEl).toBeInTheDocument()
      expect(dueEl).toHaveTextContent(/Jul 20|In \d+ days|Tomorrow|Today/)
    })

    it('does not show due date when null', () => {
      renderCard(makeTodo({ due_date: null }))
      expect(screen.queryByTestId('task-due-date')).not.toBeInTheDocument()
    })
  })

  describe('completion state', () => {
    it('shows strikethrough and reduced opacity for completed tasks', () => {
      renderCard(makeTodo({ completed: true }))
      const title = screen.getByTestId('task-title')
      expect(title.className).toContain('line-through')
      const card = screen.getByTestId('task-card')
      expect(card.className).toContain('opacity-60')
    })

    it('does not strike through active tasks', () => {
      renderCard(makeTodo({ completed: false }))
      const title = screen.getByTestId('task-title')
      expect(title.className).not.toContain('line-through')
    })

    it('calls onComplete when checkbox is clicked on an active task', () => {
      const todo = makeTodo({ completed: false })
      renderCard(todo)
      fireEvent.click(screen.getByTestId('task-checkbox'))
      expect(onComplete).toHaveBeenCalledWith(todo)
      expect(onUncomplete).not.toHaveBeenCalled()
    })

    it('calls onUncomplete when checkbox is clicked on a completed task', () => {
      const todo = makeTodo({ completed: true })
      renderCard(todo)
      fireEvent.click(screen.getByTestId('task-checkbox'))
      expect(onUncomplete).toHaveBeenCalledWith(todo)
      expect(onComplete).not.toHaveBeenCalled()
    })
  })

  describe('priority badge', () => {
    it('renders high priority badge in red', () => {
      renderCard(makeTodo({ priority: 'high' }))
      const badge = screen.getByTestId('priority-badge')
      expect(badge).toHaveTextContent('High')
      expect(badge.className).toContain('text-[var(--color-high-priority)]')
    })

    it('renders medium priority badge in yellow', () => {
      renderCard(makeTodo({ priority: 'medium' }))
      const badge = screen.getByTestId('priority-badge')
      expect(badge).toHaveTextContent('Med')
      expect(badge.className).toContain('text-[var(--color-medium-priority)]')
    })

    it('renders low priority badge in gray', () => {
      renderCard(makeTodo({ priority: 'low' }))
      const badge = screen.getByTestId('priority-badge')
      expect(badge).toHaveTextContent('Low')
      expect(badge.className).toContain('text-[var(--color-low-priority)]')
    })
  })

  describe('interactions', () => {
    it('calls onEdit when the card is clicked', () => {
      const todo = makeTodo()
      renderCard(todo)
      fireEvent.click(screen.getByTestId('task-card'))
      expect(onEdit).toHaveBeenCalledWith(todo)
    })

    it('shows action buttons on hover and calls onEdit', () => {
      const todo = makeTodo()
      renderCard(todo)
      const card = screen.getByTestId('task-card')
      fireEvent.mouseEnter(card)

      const editBtn = screen.getByTestId('edit-button')
      expect(editBtn).toBeVisible()
      fireEvent.click(editBtn)
      expect(onEdit).toHaveBeenCalledWith(todo)
    })

    it('shows action buttons on hover and calls onDelete after confirmation', () => {
      const todo = makeTodo()
      renderCard(todo)
      const card = screen.getByTestId('task-card')
      fireEvent.mouseEnter(card)

      const deleteBtn = screen.getByTestId('delete-button')
      // First click: enters confirm mode
      fireEvent.click(deleteBtn)
      // Second click: confirms delete
      fireEvent.click(deleteBtn)
      expect(onDelete).toHaveBeenCalledWith(todo)
    })
  })

  describe('overdue state', () => {
    it('marks past due dates as overdue for incomplete tasks', () => {
      // 2026-07-10 is before the "today" in the test env (2026-07-13)
      renderCard(makeTodo({ due_date: '2026-07-10T00:00:00Z', completed: false }))
      const dueEl = screen.getByTestId('task-due-date')
      expect(dueEl.textContent).toContain('overdue')
    })

    it('does not mark past due dates as overdue for completed tasks', () => {
      renderCard(makeTodo({ due_date: '2026-07-10T00:00:00Z', completed: true }))
      const dueEl = screen.getByTestId('task-due-date')
      expect(dueEl.textContent).not.toContain('overdue')
    })
  })
})
