import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render'
import AuthPage from '../AuthPage'
import { useLocation } from 'react-router-dom'

function LocationProbe() {
  const location = useLocation()
  const from = location.state?.from
  return <output aria-label="当前位置">{location.pathname}{location.search}{location.hash}|{from ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}` : ''}</output>
}

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

  it('returns to the complete internal target after login', async () => {
    renderWithProviders(<><AuthPage /><LocationProbe /></>, { initialEntries: [{
      pathname: '/login',
      state: { from: { pathname: '/upcoming', search: '?view=week', hash: '#tuesday' } },
    }] })
    await userEvent.type(screen.getByLabelText('邮箱地址'), 'plucky@example.com')
    await userEvent.type(screen.getByLabelText('密码'), 'password1')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/upcoming?view=week#tuesday|')
  })

  it('preserves the complete target while switching to registration and back to login', async () => {
    renderWithProviders(<><AuthPage /><LocationProbe /></>, { initialEntries: [{
      pathname: '/login',
      state: { from: { pathname: '/tasks', search: '?priority=high', hash: '#today' } },
    }] })
    await userEvent.click(screen.getByRole('link', { name: '注册' }))
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/register|/tasks?priority=high#today')
    await userEvent.type(screen.getByLabelText('显示名称'), 'New User')
    await userEvent.type(screen.getByLabelText('邮箱地址'), 'new@example.com')
    await userEvent.type(screen.getByLabelText('密码'), 'password1')
    await userEvent.click(screen.getByRole('button', { name: '创建账号' }))
    expect(await screen.findByDisplayValue('new@example.com')).toBeInTheDocument()
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/login|/tasks?priority=high#today')
    await userEvent.clear(screen.getByLabelText('密码'))
    await userEvent.type(screen.getByLabelText('密码'), 'password1')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/tasks?priority=high#today|')
  })

  it('falls back to tasks instead of navigating to a protocol-relative target', async () => {
    renderWithProviders(<><AuthPage /><LocationProbe /></>, { initialEntries: [{
      pathname: '/login', state: { from: { pathname: '//evil.example', search: '?steal=1', hash: '' } },
    }] })
    await userEvent.type(screen.getByLabelText('邮箱地址'), 'plucky@example.com')
    await userEvent.type(screen.getByLabelText('密码'), 'password1')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/tasks|')
  })
})
