import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render'
import AuthPage from '../AuthPage'

describe('AuthPage', () => {
  it('renders login form by default', () => {
    renderWithProviders(<AuthPage />)
    expect(screen.getByRole('heading', { name: 'Agent TodoList' })).toBeInTheDocument()
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

  it('validates registration fields before creating an account', async () => {
    renderWithProviders(<AuthPage />, { initialEntries: ['/register'] })
    await userEvent.click(screen.getByRole('button', { name: '创建账号' }))
    expect(screen.getByText('请输入显示名称')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: /显示名称/ }), 'Plucky HZ')
    await userEvent.type(screen.getByRole('textbox', { name: /邮箱地址/ }), 'not-an-email')
    await userEvent.type(screen.getByLabelText(/密码/), 'short')
    await userEvent.click(screen.getByRole('button', { name: '创建账号' }))
    expect(screen.getByText('请输入有效的邮箱地址')).toBeInTheDocument()
    expect(screen.getByText('密码至少需要 8 位')).toBeInTheDocument()
  })

  it('shows a form-level error when login fails', async () => {
    renderWithProviders(<AuthPage />)
    await userEvent.type(screen.getByLabelText('邮箱地址'), 'wrong@example.com')
    await userEvent.type(screen.getByLabelText('密码'), 'password1')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码不正确')
  })
})
