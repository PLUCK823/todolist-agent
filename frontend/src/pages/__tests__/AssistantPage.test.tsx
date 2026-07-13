import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../testUtils'
import AssistantPage from '../AssistantPage'

describe('AssistantPage', () => {
  it('renders the page title', () => {
    renderWithProviders(<AssistantPage />)
    expect(screen.getByText('智能助手')).toBeInTheDocument()
  })

  it('renders the welcome message', () => {
    renderWithProviders(<AssistantPage />)
    expect(screen.getByText(/你好！我是你的智能待办助手/)).toBeInTheDocument()
  })

  it('renders the input field', () => {
    renderWithProviders(<AssistantPage />)
    expect(screen.getByPlaceholderText(/输入你想做的事情/)).toBeInTheDocument()
  })

  it('renders the send button', () => {
    renderWithProviders(<AssistantPage />)
    expect(screen.getByText('发送')).toBeInTheDocument()
  })
})
