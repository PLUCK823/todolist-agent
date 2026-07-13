import { createContext, useContext } from 'react'
import type { Preferences } from './preferences.types'

export interface PreferencesContextValue {
  preferences: Preferences
  updatePreferences(update: Partial<Preferences>): Promise<void>
}

export const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function usePreferences() {
  const context = useContext(PreferencesContext)
  if (!context) throw new Error('usePreferences must be used inside PreferencesProvider')
  return context
}

export function useOptionalPreferences() {
  return useContext(PreferencesContext)
}
