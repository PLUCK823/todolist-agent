import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
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
})
