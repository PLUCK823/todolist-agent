import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { defaultPreferences, type Preferences } from './preferences.types'
import { PreferencesContext } from './preferences-context'

const PREFERENCES_KEY = 'todolist.preferences'

function readPreferences(): Preferences {
  try {
    return { ...defaultPreferences, ...JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') }
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
    updatePreferences(update: Partial<Preferences>) {
      setPreferences((current) => {
        const next = { ...current, ...update }
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next))
        return next
      })
    },
  }), [preferences])

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}
