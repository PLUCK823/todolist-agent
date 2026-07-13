import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { defaultPreferences, type Preferences } from './preferences.types'
import { PreferencesContext } from './preferences-context'

const PREFERENCES_KEY = 'todolist.preferences'

function readPreferences(): Preferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}')
    if (!value || typeof value !== 'object') return defaultPreferences
    const candidate = value as Partial<Preferences>
    return {
      language: candidate.language === 'zh-CN' ? candidate.language : defaultPreferences.language,
      theme: candidate.theme === 'system' || candidate.theme === 'light' || candidate.theme === 'dark' ? candidate.theme : defaultPreferences.theme,
      agentStartsOpen: typeof candidate.agentStartsOpen === 'boolean' ? candidate.agentStartsOpen : defaultPreferences.agentStartsOpen,
      reducedMotion: candidate.reducedMotion === null || typeof candidate.reducedMotion === 'boolean' ? candidate.reducedMotion : defaultPreferences.reducedMotion,
    }
  } catch {
    return defaultPreferences
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readPreferences)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = preferences.theme
    if (preferences.reducedMotion === null) delete root.dataset.reducedMotion
    else root.dataset.reducedMotion = String(preferences.reducedMotion)
  }, [preferences])

  const value = useMemo(() => ({
    preferences,
    async updatePreferences(update: Partial<Preferences>) {
      const next = { ...preferences, ...update }
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next))
      setPreferences(next)
    },
  }), [preferences])

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}
