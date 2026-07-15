import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PreferencesProvider } from '../PreferencesContext'
import { usePreferences } from '../preferences-context'

describe('PreferencesProvider', () => {
  it('persists theme, language, Agent startup and motion preferences', async () => {
    localStorage.clear()
    const wrapper = ({ children }: { children: ReactNode }) => <PreferencesProvider>{children}</PreferencesProvider>
    const { result } = renderHook(() => usePreferences(), { wrapper })

    await act(() => result.current.updatePreferences({ theme: 'dark', language: 'zh-CN', agentStartsOpen: false, reducedMotion: true }))
    expect(JSON.parse(localStorage.getItem('todolist.preferences') ?? '{}')).toMatchObject({ theme: 'dark', agentStartsOpen: false, reducedMotion: true })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.reducedMotion).toBe('true')
  })

  it('rejects malformed persisted values and falls back to defaults', () => {
    localStorage.setItem('todolist.preferences', JSON.stringify({ theme: 'neon', language: 42, agentStartsOpen: 'yes', reducedMotion: 'sometimes' }))
    const wrapper = ({ children }: { children: ReactNode }) => <PreferencesProvider>{children}</PreferencesProvider>
    const { result } = renderHook(() => usePreferences(), { wrapper })
    expect(result.current.preferences).toMatchObject({ theme: 'system', language: 'zh-CN', agentStartsOpen: true, reducedMotion: null })
  })

  it('keeps the previous state when persistence fails', async () => {
    localStorage.clear()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    const wrapper = ({ children }: { children: ReactNode }) => <PreferencesProvider>{children}</PreferencesProvider>
    const { result } = renderHook(() => usePreferences(), { wrapper })
    await expect(act(() => result.current.updatePreferences({ theme: 'dark' }))).rejects.toThrow()
    expect(result.current.preferences.theme).toBe('system')
    setItem.mockRestore()
  })
})
