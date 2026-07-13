import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../testUtils'
import AuthPage from '../AuthPage'

describe('AuthPage', () => {
  it('renders login form by default', () => {
    renderWithProviders(<AuthPage />)
    expect(screen.getByText('Agent TodoList')).toBeInTheDocument()
    expect(screen.getByText('登录你的账号')).toBeInTheDocument()
    expect(screen.getByText('登录')).toBeInTheDocument()
  })

  it('renders register link on login page', () => {
    renderWithProviders(<AuthPage />)
    expect(screen.getByText('注册')).toBeInTheDocument()
  })

  it('renders register form when on /register', () => {
    renderWithProviders(<AuthPage />, { initialEntries: ['/register'] })
    expect(screen.getByText('创建新账号')).toBeInTheDocument()
    expect(screen.getByText('注册')).toBeInTheDocument()
  })
})
