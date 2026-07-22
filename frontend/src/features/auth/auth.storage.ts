import { getAvatarPreference, persistAvatarPreference } from '../profile/avatar.storage'
import type { Account, AvatarValue } from './auth.types'

const LEGACY_AUTH_KEYS = [
  'todolist.auth.account',
  'todolist.auth.credential',
  'todolist.auth.session',
]

export function clearLegacyAuthStorage(): void {
  if (typeof window === 'undefined') return
  try { LEGACY_AUTH_KEYS.forEach((key) => window.localStorage.removeItem(key)) } catch { /* legacy cleanup is best effort */ }
}

function isAvatar(value: unknown): value is AvatarValue {
  if (!value || typeof value !== 'object') return false
  const avatar = value as Partial<AvatarValue>
  return (avatar.kind === 'preset' || avatar.kind === 'image' || avatar.kind === 'blob')
    && typeof avatar.value === 'string'
}

export async function loadStoredAvatar(accountId: string): Promise<AvatarValue | null> {
  try {
    const avatar = await getAvatarPreference(accountId)
    return isAvatar(avatar) ? avatar : null
  } catch {
    return null
  }
}

export async function saveStoredAvatar(accountId: string, avatar: AvatarValue): Promise<void> {
  await persistAvatarPreference(accountId, avatar)
}

export async function applyStoredAvatar(account: Account): Promise<Account> {
  const avatar = await loadStoredAvatar(account.id)
  return avatar ? { ...account, avatar } : account
}
