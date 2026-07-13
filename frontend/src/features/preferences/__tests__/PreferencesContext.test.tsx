import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { PreferencesProvider } from '../PreferencesContext'
import { usePreferences } from '../preferences-context'

describe('PreferencesProvider', () => {
  it('persists theme, language, Agent startup and motion preferences', () => {
    localStorage.clear()
    const wrapper = ({ children }: { children: ReactNode }) => <PreferencesProvider>{children}</PreferencesProvider>
    const { result } = renderHook(() => usePreferences(), { wrapper })

    act(() => result.current.updatePreferences({ theme: 'dark', language: 'zh-CN', agentStartsOpen: false, reducedMotion: true }))
    expect(JSON.parse(localStorage.getItem('todolist.preferences') ?? '{}')).toMatchObject({ theme: 'dark', agentStartsOpen: false, reducedMotion: true })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.reducedMotion).toBe('true')
  })
})
