import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../testUtils'
import { TaskDashboard } from '../TaskDashboard'

describe('TaskDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders the page title', async () => {
      renderWithProviders(<TaskDashboard />)
      await waitFor(() => {
        expect(screen.getByText('My Tasks')).toBeInTheDocument()
      })
    })

    it('renders the create task button', async () => {
      renderWithProviders(<TaskDashboard />)
      await waitFor(() => {
        expect(screen.getByTestId('create-task-button')).toBeInTheDocument()
      })
    })

    it('renders the search input', async () => {
      renderWithProviders(<TaskDashboard />)
      await waitFor(() => {
        expect(screen.getByTestId('search-input')).toBeInTheDocument()
      })
    })

    it('renders the filter toggle button', async () => {
      renderWithProviders(<TaskDashboard />)
      await waitFor(() => {
        expect(screen.getByTestId('filter-toggle')).toBeInTheDocument()
      })
    })
  })

  describe('task list', () => {
    it('loads and displays tasks from the API (MSW)', async () => {
      renderWithProviders(<TaskDashboard />)

      await waitFor(() => {
        expect(screen.getByTestId('task-list')).toBeInTheDocument()
      })

      const cards = screen.getAllByTestId('task-card')
      // The MSW handlers seed 4 tasks
      expect(cards.length).toBeGreaterThanOrEqual(4)
    })

    it('shows task count in header', async () => {
      renderWithProviders(<TaskDashboard />)

      await waitFor(() => {
        expect(screen.getByText(/\d+ task/)).toBeInTheDocument()
      })
    })
  })

  describe('loading state', () => {
    it('shows skeleton placeholders while loading', () => {
      // We render; since MSW takes a tick to respond, we check immediately
      renderWithProviders(<TaskDashboard />)
      // The loading skeletons appear briefly while the query is in flight
      expect(screen.getByTestId('loading-state')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows empty state when there are no tasks', async () => {
      const user = userEvent.setup()
      renderWithProviders(<TaskDashboard />)

      await user.type(screen.getByTestId('search-input'), 'zzz_nonexistent_zzz')

      // Wait for debounced search to take effect
      await waitFor(
        () => {
          expect(screen.getByTestId('empty-state')).toBeInTheDocument()
        },
        { timeout: 3000 },
      )
    })
  })

  describe('create flow', () => {
    it('opens create dialog when clicking new task button', async () => {
      const user = userEvent.setup()
      renderWithProviders(<TaskDashboard />)

      await waitFor(() => {
        expect(screen.getByTestId('create-task-button')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('create-task-button'))

      await waitFor(() => {
        expect(screen.getByTestId('task-dialog')).toBeInTheDocument()
        expect(screen.getByText('New Task')).toBeInTheDocument()
      })
    })

    it('creates a task and closes dialog', async () => {
      const user = userEvent.setup()
      renderWithProviders(<TaskDashboard />)

      // Open dialog
      await waitFor(() => {
        expect(screen.getByTestId('create-task-button')).toBeInTheDocument()
      })
      await user.click(screen.getByTestId('create-task-button'))

      // Fill form
      await user.type(
        screen.getByTestId('task-title-input'),
        'New Test Task',
      )
      await user.click(screen.getByTestId('task-submit-button'))

      // After submit, dialog should close
      await waitFor(() => {
        expect(screen.queryByTestId('task-dialog')).not.toBeInTheDocument()
      })
    })
  })

  describe('edit flow', () => {
    it('opens edit dialog when clicking a task card', async () => {
      const user = userEvent.setup()
      renderWithProviders(<TaskDashboard />)

      await waitFor(() => {
        expect(screen.getAllByTestId('task-card').length).toBeGreaterThan(0)
      })

      // Click the first task card
      const firstCard = screen.getAllByTestId('task-card')[0]
      await user.click(firstCard)

      await waitFor(() => {
        expect(screen.getByTestId('task-dialog')).toBeInTheDocument()
        expect(screen.getByText('Edit Task')).toBeInTheDocument()
      })
    })
  })

  describe('delete flow', () => {
    it('removes a task when delete is confirmed', async () => {
      const user = userEvent.setup()
      renderWithProviders(<TaskDashboard />)

      await waitFor(() => {
        expect(screen.getAllByTestId('task-card').length).toBeGreaterThan(0)
      })

      const firstCard = screen.getAllByTestId('task-card')[0]
      fireEvent.mouseEnter(firstCard)

      const deleteBtn = screen.getAllByTestId('delete-button')[0]
      // First click: enter confirm mode
      await user.click(deleteBtn)
      // Second click: confirm
      await user.click(deleteBtn)

      // The delete mutation fires; wait for DOM update
      await waitFor(
        () => {
          // Task should be removed
          const cards = screen.queryAllByTestId('task-card')
          expect(cards.length).toBeLessThan(4)
        },
        { timeout: 2000 },
      )
    })
  })

  describe('complete toggle', () => {
    it('toggles task completion via checkbox', async () => {
      const user = userEvent.setup()
      renderWithProviders(<TaskDashboard />)

      await waitFor(() => {
        expect(screen.getAllByTestId('task-checkbox').length).toBeGreaterThan(0)
      })

      const checkboxes = screen.getAllByTestId('task-checkbox')
      // Click the first checkbox (which is an incomplete task in seed data)
      await user.click(checkboxes[0])

      // Verify the UI still shows the task (now completed)
      await waitFor(() => {
        expect(screen.getAllByTestId('task-card').length).toBeGreaterThan(0)
      })
    })
  })

  describe('filter popover', () => {
    it('opens filter popover when clicking filter button', async () => {
      const user = userEvent.setup()
      renderWithProviders(<TaskDashboard />)

      await waitFor(() => {
        expect(screen.getByTestId('filter-toggle')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('filter-toggle'))

      await waitFor(() => {
        expect(screen.getByTestId('filter-popover')).toBeInTheDocument()
      })
    })

    it('filters tasks when apply is clicked', async () => {
      const user = userEvent.setup()
      renderWithProviders(<TaskDashboard />)

      // Wait for tasks to load
      await waitFor(() => {
        expect(screen.getByTestId('task-list')).toBeInTheDocument()
      })

      // Open filter
      await user.click(screen.getByTestId('filter-toggle'))
      await waitFor(() => {
        expect(screen.getByTestId('filter-popover')).toBeInTheDocument()
      })

      // Filter to completed only
      await user.click(screen.getByTestId('completion-completed'))
      await user.click(screen.getByTestId('filter-apply'))

      // Should show only completed tasks
      await waitFor(() => {
        const cards = screen.getAllByTestId('task-card')
        // Seed data has one completed task (id: 2, "购买 groceries")
        expect(cards.length).toBe(1)
      })
    })
  })

  describe('pagination', () => {
    it('does not show pagination when total fits on one page', async () => {
      renderWithProviders(<TaskDashboard />)

      await waitFor(() => {
        expect(screen.getByTestId('task-list')).toBeInTheDocument()
      })

      // With only 4 seed tasks and page_size=10, no pagination
      expect(screen.queryByTestId('pagination')).not.toBeInTheDocument()
    })
  })
})
