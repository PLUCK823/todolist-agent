import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShellProvider } from '../ShellContext'
import { useShell } from '../shell-context'
import { PreferencesProvider } from '../../preferences/PreferencesContext'

function ShellHarness() {
  const shell = useShell()

  return (
    <div>
      <output aria-label="导航状态">{shell.navExpanded ? 'expanded' : 'collapsed'}</output>
      <output aria-label="智能助手状态">{shell.agentExpanded ? 'expanded' : 'collapsed'}</output>
      <button type="button" onClick={shell.toggleNav}>展开导航</button>
      <button type="button" onClick={shell.closeAgent}>收起智能助手</button>
      <button type="button" onClick={shell.openAgent}>展开智能助手</button>
    </div>
  )
}

function renderShell() {
  return render(
    <ShellProvider>
      <ShellHarness />
    </ShellProvider>,
  )
}

function renderShellWithPreferences() {
  return render(<PreferencesProvider><ShellProvider><ShellHarness /></ShellProvider></PreferencesProvider>)
}

describe('ShellContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to a collapsed navigation and expanded agent', () => {
    renderShell()

    expect(screen.getByLabelText('导航状态')).toHaveTextContent('collapsed')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('expanded')
  })

  it('persists navigation and agent state changes', async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole('button', { name: '展开导航' }))
    await user.click(screen.getByRole('button', { name: '收起智能助手' }))

    expect(localStorage.getItem('todolist:shell')).toBe(
      JSON.stringify({ navExpanded: true, agentExpanded: false }),
    )
  })

  it('restores a valid persisted state after remounting', () => {
    localStorage.setItem(
      'todolist:shell',
      JSON.stringify({ navExpanded: true, agentExpanded: false }),
    )

    renderShell()

    expect(screen.getByLabelText('导航状态')).toHaveTextContent('expanded')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('collapsed')
  })

  it('uses the Agent startup preference for every new application mount', () => {
    localStorage.setItem('todolist.preferences', JSON.stringify({
      language: 'zh-CN', theme: 'system', agentStartsOpen: false, reducedMotion: null,
    }))
    localStorage.setItem('todolist:shell', JSON.stringify({ navExpanded: true, agentExpanded: true }))

    const firstMount = renderShellWithPreferences()
    expect(screen.getByLabelText('导航状态')).toHaveTextContent('expanded')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('collapsed')
    firstMount.unmount()

    localStorage.setItem('todolist.preferences', JSON.stringify({
      language: 'zh-CN', theme: 'system', agentStartsOpen: true, reducedMotion: null,
    }))
    renderShellWithPreferences()
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('expanded')
  })

  it('uses safe defaults when persisted storage is malformed', () => {
    localStorage.setItem('todolist:shell', '{not-json')

    renderShell()

    expect(screen.getByLabelText('导航状态')).toHaveTextContent('collapsed')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('expanded')
  })

  it('uses safe defaults when persisted properties are not booleans', () => {
    localStorage.setItem(
      'todolist:shell',
      JSON.stringify({ navExpanded: 'yes', agentExpanded: null }),
    )

    renderShell()

    expect(screen.getByLabelText('导航状态')).toHaveTextContent('collapsed')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('expanded')
  })

  it.each(['SecurityError', 'QuotaExceededError'])(
    'keeps shell state usable when storage writes throw %s',
    async (errorName) => {
      const user = userEvent.setup()
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('storage unavailable', errorName)
      })

      expect(() => renderShell()).not.toThrow()
      await user.click(screen.getByRole('button', { name: '展开导航' }))
      await user.click(screen.getByRole('button', { name: '收起智能助手' }))

      expect(screen.getByLabelText('导航状态')).toHaveTextContent('expanded')
      expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('collapsed')
      expect(setItem).toHaveBeenCalled()
      setItem.mockRestore()
    },
  )

  it('synchronizes valid state from another browser tab', () => {
    renderShell()

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'todolist:shell',
        newValue: JSON.stringify({ navExpanded: true, agentExpanded: false }),
        storageArea: localStorage,
      }))
    })

    expect(screen.getByLabelText('导航状态')).toHaveTextContent('expanded')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('collapsed')
  })

  it('ignores malformed and unrelated storage events', () => {
    renderShell()

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'unrelated:key',
        newValue: JSON.stringify({ navExpanded: true, agentExpanded: false }),
      }))
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'todolist:shell',
        newValue: '{bad-json',
      }))
    })

    expect(screen.getByLabelText('导航状态')).toHaveTextContent('collapsed')
    expect(screen.getByLabelText('智能助手状态')).toHaveTextContent('expanded')
  })

  it('removes its cross-tab storage listener when unmounted', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const view = renderShell()
    const storageRegistration = addEventListener.mock.calls.find(([type]) => type === 'storage')

    expect(storageRegistration).toBeDefined()
    view.unmount()

    expect(removeEventListener).toHaveBeenCalledWith('storage', storageRegistration?.[1])
    addEventListener.mockRestore()
    removeEventListener.mockRestore()
  })
})
