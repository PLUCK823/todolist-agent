import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../testUtils'
import { FilterPopover } from '../FilterPopover'
import type { TodoFilters } from '../../../types/todo'

const DEFAULT_FILTERS: TodoFilters = {
  page: 1,
  page_size: 10,
}

describe('FilterPopover', () => {
  let onFilterChange: ReturnType<typeof vi.fn<(filters: TodoFilters) => void>>
  let onClose: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    onFilterChange = vi.fn<(filters: TodoFilters) => void>()
    onClose = vi.fn<() => void>()
  })

  function renderPopover(
    overrides: {
      filters?: TodoFilters
      isOpen?: boolean
    } = {},
  ) {
    return renderWithProviders(
      <FilterPopover
        filters={overrides.filters ?? DEFAULT_FILTERS}
        onFilterChange={onFilterChange}
        isOpen={overrides.isOpen ?? true}
        onClose={onClose}
      />,
    )
  }

  describe('visibility', () => {
    it('renders nothing when isOpen is false', () => {
      renderPopover({ isOpen: false })
      expect(screen.queryByTestId('filter-popover')).not.toBeInTheDocument()
    })

    it('renders the popover when isOpen is true', () => {
      renderPopover({ isOpen: true })
      expect(screen.getByTestId('filter-popover')).toBeInTheDocument()
    })

    it('renders all filter sections', () => {
      renderPopover()
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Priority')).toBeInTheDocument()
      expect(screen.getByText('Sort By')).toBeInTheDocument()
    })
  })

  describe('completion filter', () => {
    it('highlights "All" by default', () => {
      renderPopover()
      const allBtn = screen.getByTestId('completion-all')
      expect(allBtn.className).toContain('bg-[var(--color-primary)]')
    })

    it('switches to "Active" and highlights it', () => {
      renderPopover()
      fireEvent.click(screen.getByTestId('completion-active'))
      const activeBtn = screen.getByTestId('completion-active')
      expect(activeBtn.className).toContain('bg-[var(--color-primary)]')
    })

    it('switches to "Completed" and highlights it', () => {
      renderPopover()
      fireEvent.click(screen.getByTestId('completion-completed'))
      const completedBtn = screen.getByTestId('completion-completed')
      expect(completedBtn.className).toContain('bg-[var(--color-primary)]')
    })
  })

  describe('priority filter', () => {
    it('highlights "All" priorities by default', () => {
      renderPopover()
      expect(screen.getByTestId('priority-all').className).toContain(
        'bg-[var(--color-primary)]',
      )
    })

    it('switches to a specific priority', () => {
      renderPopover()
      fireEvent.click(screen.getByTestId('priority-high'))
      expect(screen.getByTestId('priority-high').className).toContain(
        'bg-[var(--color-primary)]',
      )
    })
  })

  describe('sort', () => {
    it('highlights default sort (Newest first)', () => {
      renderPopover()
      const active = screen.getByTestId('sort-created_at-desc')
      expect(active.className).toContain('bg-[var(--color-primary)]/10')
    })

    it('switches to a different sort option', () => {
      renderPopover()
      fireEvent.click(screen.getByTestId('sort-priority-desc'))
      const active = screen.getByTestId('sort-priority-desc')
      expect(active.className).toContain('bg-[var(--color-primary)]/10')
    })
  })

  describe('apply', () => {
    it('calls onFilterChange with updated filters and closes', async () => {
      renderPopover()

      // Change completion to active
      fireEvent.click(screen.getByTestId('completion-active'))
      // Change priority to high
      fireEvent.click(screen.getByTestId('priority-high'))
      // Change sort
      fireEvent.click(screen.getByTestId('sort-due_date-asc'))

      fireEvent.click(screen.getByTestId('filter-apply'))

      await waitFor(() => {
        expect(onFilterChange).toHaveBeenCalledWith(
          expect.objectContaining({
            completed: false,
            priority: 'high',
            sort_by: 'due_date',
            order: 'asc',
            page: 1,
          }),
        )
        expect(onClose).toHaveBeenCalled()
      })
    })

    it('sends undefined for "all" completion and priority', async () => {
      renderPopover()

      // Already default "all" for both
      fireEvent.click(screen.getByTestId('filter-apply'))

      await waitFor(() => {
        expect(onFilterChange).toHaveBeenCalledWith(
          expect.objectContaining({
            completed: undefined,
            priority: undefined,
          }),
        )
      })
    })
  })

  describe('reset', () => {
    it('resets to defaults and applies immediately', async () => {
      renderPopover({
        filters: {
          page: 1,
          page_size: 10,
          completed: true,
          priority: 'high',
          sort_by: 'due_date',
          order: 'asc',
        },
      })

      fireEvent.click(screen.getByTestId('filter-reset'))

      await waitFor(() => {
        expect(onFilterChange).toHaveBeenCalledWith({
          page: 1,
          page_size: 10,
        })
        expect(onClose).toHaveBeenCalled()
      })
    })
  })

  describe('close behavior', () => {
    it('closes on Escape key', () => {
      renderPopover()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })
  })
})
