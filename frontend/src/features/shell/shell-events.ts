export const SETTINGS_OPEN_EVENT = 'todolist:open-settings'

export function requestSettingsOpen(): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_OPEN_EVENT))
}
