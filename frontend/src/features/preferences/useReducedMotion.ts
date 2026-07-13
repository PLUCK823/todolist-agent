import { useSyncExternalStore } from 'react'
import { useOptionalPreferences } from './preferences-context'
import type { Preferences } from './preferences.types'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

function systemPrefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(reducedMotionQuery).matches
    : false
}

function subscribeSystemPreference(notify: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const media = window.matchMedia(reducedMotionQuery)
  media.addEventListener?.('change', notify)
  return () => media.removeEventListener?.('change', notify)
}

export function resolveReducedMotion(
  preference: Preferences['reducedMotion'],
  systemPreference: boolean,
) {
  return preference ?? systemPreference
}

export function useReducedMotion() {
  const preference = useOptionalPreferences()?.preferences.reducedMotion ?? null
  const systemPreference = useSyncExternalStore(
    subscribeSystemPreference,
    systemPrefersReducedMotion,
    () => false,
  )

  return resolveReducedMotion(preference, systemPreference)
}
