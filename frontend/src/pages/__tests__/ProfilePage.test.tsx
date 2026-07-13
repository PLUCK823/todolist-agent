import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render'
import ProfilePage from '../ProfilePage'

describe('ProfilePage', () => {
  it('renders the page title', async () => {
    renderWithProviders(<ProfilePage />)
    expect(await screen.findByText('个人资料')).toBeInTheDocument()
  })

  it('renders name input', async () => {
    renderWithProviders(<ProfilePage />)
    expect(await screen.findByDisplayValue('Plucky HZ')).toBeInTheDocument()
  })

  it('renders email input', async () => {
    renderWithProviders(<ProfilePage />)
    expect(await screen.findByDisplayValue('plucky@example.com')).toBeInTheDocument()
  })

  it('renders save button', async () => {
    renderWithProviders(<ProfilePage />)
    expect(await screen.findByText('保存修改')).toBeInTheDocument()
  })

  it('renders stats section', async () => {
    renderWithProviders(<ProfilePage />)
    expect(await screen.findByText('总任务')).toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
  })

  it('opens a confirmation before logging out', async () => {
    renderWithProviders(<ProfilePage />)
    await userEvent.click(await screen.findByRole('button', { name: '退出登录' }))
    expect(screen.getByRole('dialog', { name: '确认退出登录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认退出' })).toBeInTheDocument()
  })

  it('opens the avatar picker and applies a preset', async () => {
    renderWithProviders(<ProfilePage />)
    await userEvent.click(await screen.findByRole('button', { name: '更换头像' }))
    await userEvent.click(screen.getByRole('radio', { name: '海蓝' }))
    await userEvent.click(screen.getByRole('button', { name: '保存头像' }))
    expect(await screen.findByLabelText('Plucky HZ的头像')).toHaveClass('account-avatar--ocean')
  })
})
