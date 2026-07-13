import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../testUtils'
import MyTasksPage from '../MyTasksPage'

describe('MyTasksPage', () => {
  it('renders the task dashboard', async () => {
    renderWithProviders(<MyTasksPage />)
    // Should render the page content
    const heading = await screen.findByText('My Tasks')
    expect(heading).toBeInTheDocument()
  })
})
