import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../test/render'
import UpcomingPage from '../UpcomingPage'

describe('UpcomingPage', () => {
  it('renders the page title', async () => {
    renderWithProviders(<UpcomingPage />)
    await waitFor(() => {
      expect(screen.getByText('近期安排')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    renderWithProviders(<UpcomingPage />)
    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('shows checkbox for completed items', async () => {
    renderWithProviders(<UpcomingPage />)
    await waitFor(() => {
      expect(screen.getByText('显示已完成')).toBeInTheDocument()
    })
  })
})
