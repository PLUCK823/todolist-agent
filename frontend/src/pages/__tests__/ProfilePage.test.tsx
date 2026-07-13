import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/render'
import ProfilePage from '../ProfilePage'

describe('ProfilePage', () => {
  it('renders the page title', () => {
    renderWithProviders(<ProfilePage />)
    expect(screen.getByText('个人资料')).toBeInTheDocument()
  })

  it('renders name input', () => {
    renderWithProviders(<ProfilePage />)
    expect(screen.getByDisplayValue('用户')).toBeInTheDocument()
  })

  it('renders email input', () => {
    renderWithProviders(<ProfilePage />)
    expect(screen.getByDisplayValue('user@example.com')).toBeInTheDocument()
  })

  it('renders save button', () => {
    renderWithProviders(<ProfilePage />)
    expect(screen.getByText('保存')).toBeInTheDocument()
  })

  it('renders stats section', () => {
    renderWithProviders(<ProfilePage />)
    expect(screen.getByText('总任务')).toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
  })
})
