import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../testUtils'
import { TaskDialog } from '../TaskDialog'
import type { Todo, CreateTodoDTO } from '../../../types/todo'

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 1,
    title: 'Existing Task',
    description: 'Existing description',
    priority: 'medium',
    completed: false,
    due_date: '2026-07-25T00:00:00Z',
    created_at: '2026-07-10T08:00:00Z',
    updated_at: '2026-07-10T08:00:00Z',
    ...overrides,
  }
}

describe('TaskDialog', () => {
  let onSubmit: ReturnType<typeof vi.fn<(data: CreateTodoDTO) => void>>
  let onClose: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    onSubmit = vi.fn<(data: CreateTodoDTO) => void>()
    onClose = vi.fn<() => void>()
  })

  function renderDialog(
    overrides: {
      isOpen?: boolean
      initialData?: Todo | null
      isSubmitting?: boolean
    } = {},
  ) {
    return renderWithProviders(
      <TaskDialog
        isOpen={overrides.isOpen ?? true}
        onClose={onClose}
        onSubmit={onSubmit}
        initialData={overrides.initialData ?? null}
        isSubmitting={overrides.isSubmitting ?? false}
      />,
    )
  }

  describe('visibility', () => {
    it('renders nothing when isOpen is false', () => {
      renderDialog({ isOpen: false })
      expect(screen.queryByTestId('task-dialog')).not.toBeInTheDocument()
    })

    it('renders the dialog when isOpen is true', () => {
      renderDialog({ isOpen: true })
      expect(screen.getByTestId('task-dialog')).toBeInTheDocument()
    })
  })

  describe('create mode', () => {
    it('shows the create title', () => {
      renderDialog()
      expect(screen.getByText('New Task')).toBeInTheDocument()
    })

    it('has empty form fields by default', () => {
      renderDialog()
      expect(screen.getByTestId('task-title-input')).toHaveValue('')
      expect(screen.getByTestId('task-description-input')).toHaveValue('')
      expect(screen.getByTestId('task-priority-select')).toHaveValue('medium')
      expect(screen.getByTestId('task-due-date-input')).toHaveValue('')
    })

    it('renders "Create Task" on the submit button', () => {
      renderDialog()
      expect(screen.getByTestId('task-submit-button')).toHaveTextContent('Create Task')
    })
  })

  describe('edit mode', () => {
    it('shows the edit title and pre-fills form', () => {
      const todo = makeTodo({
        title: 'Edit Me',
        description: 'Old desc',
        priority: 'high',
        due_date: '2026-08-01T00:00:00Z',
      })
      renderDialog({ initialData: todo })

      expect(screen.getByText('Edit Task')).toBeInTheDocument()
      expect(screen.getByTestId('task-title-input')).toHaveValue('Edit Me')
      expect(screen.getByTestId('task-description-input')).toHaveValue('Old desc')
      expect(screen.getByTestId('task-priority-select')).toHaveValue('high')
      expect(screen.getByTestId('task-due-date-input')).toHaveValue('2026-08-01')
    })

    it('renders "Save Changes" on the submit button', () => {
      renderDialog({ initialData: makeTodo() })
      expect(screen.getByTestId('task-submit-button')).toHaveTextContent('Save Changes')
    })
  })

  describe('validation', () => {
    it('shows error when submitting with empty title', async () => {
      renderDialog()
      fireEvent.click(screen.getByTestId('task-submit-button'))

      await waitFor(() => {
        expect(screen.getByTestId('title-error')).toHaveTextContent('Title is required')
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('shows error when title exceeds 200 characters', async () => {
      renderDialog()
      const longTitle = 'a'.repeat(201)
      await userEvent.type(screen.getByTestId('task-title-input'), longTitle)
      fireEvent.click(screen.getByTestId('task-submit-button'))

      await waitFor(() => {
        expect(screen.getByTestId('title-error')).toHaveTextContent(/200/)
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('clears title error when user starts typing', async () => {
      renderDialog()
      fireEvent.click(screen.getByTestId('task-submit-button'))

      await waitFor(() => {
        expect(screen.getByTestId('title-error')).toBeInTheDocument()
      })

      await userEvent.type(screen.getByTestId('task-title-input'), 'New Title')
      expect(screen.queryByTestId('title-error')).not.toBeInTheDocument()
    })
  })

  describe('submit', () => {
    it('calls onSubmit with form data for create', async () => {
      renderDialog()
      await userEvent.type(screen.getByTestId('task-title-input'), 'New Todo')
      await userEvent.type(screen.getByTestId('task-description-input'), 'Some description')
      await userEvent.selectOptions(screen.getByTestId('task-priority-select'), 'high')
      fireEvent.change(screen.getByTestId('task-due-date-input'), {
        target: { value: '2026-08-15' },
      })

      fireEvent.click(screen.getByTestId('task-submit-button'))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          title: 'New Todo',
          description: 'Some description',
          priority: 'high',
          due_date: '2026-08-15',
        })
      })
    })

    it('calls onSubmit with only title when optional fields are empty', async () => {
      renderDialog()
      await userEvent.type(screen.getByTestId('task-title-input'), 'Minimal Task')
      fireEvent.click(screen.getByTestId('task-submit-button'))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          title: 'Minimal Task',
          description: undefined,
          priority: 'medium',
          due_date: undefined,
        })
      })
    })
  })

  describe('close behavior', () => {
    it('calls onClose when backdrop is clicked', () => {
      renderDialog()
      fireEvent.click(screen.getByTestId('task-dialog-overlay'))
      expect(onClose).toHaveBeenCalled()
    })

    it('calls onClose when Escape is pressed', () => {
      renderDialog()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })

    it('calls onClose when cancel button is clicked', () => {
      renderDialog()
      fireEvent.click(screen.getByText('Cancel'))
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('submitting state', () => {
    it('disables the submit button when submitting', () => {
      renderDialog({ isSubmitting: true })
      expect(screen.getByTestId('task-submit-button')).toBeDisabled()
    })

    it('disables the cancel button when submitting', () => {
      renderDialog({ isSubmitting: true })
      expect(screen.getByText('Cancel')).toBeDisabled()
    })
  })
})
