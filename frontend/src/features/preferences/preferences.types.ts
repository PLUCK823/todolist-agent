export type ThemePreference = 'system' | 'light' | 'dark'
export type LanguagePreference = 'zh-CN'

export interface Preferences {
  language: LanguagePreference
  theme: ThemePreference
  agentStartsOpen: boolean
  reducedMotion: boolean | null
}

export const defaultPreferences: Preferences = {
  language: 'zh-CN',
  theme: 'system',
  agentStartsOpen: true,
  reducedMotion: null,
}
