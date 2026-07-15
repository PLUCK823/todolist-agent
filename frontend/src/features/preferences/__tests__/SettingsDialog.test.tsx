import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PreferencesProvider } from '../PreferencesContext'
import SettingsDialog from '../SettingsDialog'
import { ToastProvider } from '../../../components/common/ToastRegion'

describe('SettingsDialog', () => {
  it('opens from the shell event and saves preferences', async () => {
    localStorage.clear()
    render(<ToastProvider><PreferencesProvider><SettingsDialog /></PreferencesProvider></ToastProvider>)
    window.dispatchEvent(new CustomEvent('todolist:open-settings'))
    expect(await screen.findByRole('dialog', { name: '设置' })).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('主题'), 'dark')
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('todolist.preferences') ?? '{}')).toMatchObject({ theme: 'dark' })
  })

  it('stays open and reports persistence failure instead of showing false success', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    render(<ToastProvider><PreferencesProvider><SettingsDialog /></PreferencesProvider></ToastProvider>)
    window.dispatchEvent(new CustomEvent('todolist:open-settings'))
    await userEvent.selectOptions(await screen.findByLabelText('主题'), 'dark')
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('设置保存失败')
    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument()
    expect(screen.queryByText('设置已保存')).not.toBeInTheDocument()
    setItem.mockRestore()
  })
})
