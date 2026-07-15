import type { Account, AuthStorageAdapter, LoginInput, ProfileUpdate, RegisterInput, Session } from './auth.types'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const AUTH_ACCOUNT_KEY = 'todolist.auth.account'
export const AUTH_CREDENTIAL_KEY = 'todolist.auth.credential'
export const AUTH_SESSION_KEY = 'todolist.auth.session'
export const AUTH_STORAGE_KEYS = new Set<string | null>([AUTH_ACCOUNT_KEY, AUTH_CREDENTIAL_KEY, AUTH_SESSION_KEY, null])

interface StoredCredential {
  version: 1
  accountId: string
  salt: string
  hash: string
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function parseAccount(value: string | null): Account | null {
  if (!value) return null
  try {
    const account = JSON.parse(value) as Account
    return account?.id && account.email ? account : null
  } catch {
    return null
  }
}

function parseCredential(value: string | null): StoredCredential | null {
  if (!value) return null
  try {
    const credential = JSON.parse(value) as StoredCredential
    return credential?.version === 1 && credential.accountId && credential.salt && credential.hash ? credential : null
  } catch {
    return null
  }
}

function createResilientStorage(primary: KeyValueStorage): KeyValueStorage {
  const fallback = new Map<string, string>()
  const fallbackOnly = new Set<string>()

  return {
    getItem(key) {
      try {
        const value = primary.getItem(key)
        if (value !== null) {
          fallback.set(key, value)
          fallbackOnly.delete(key)
          return value
        }
        if (!fallbackOnly.has(key)) fallback.delete(key)
        return fallbackOnly.has(key) ? fallback.get(key) ?? null : null
      } catch {
        return fallback.get(key) ?? null
      }
    },
    setItem(key, value) {
      fallback.set(key, value)
      try {
        primary.setItem(key, value)
        fallbackOnly.delete(key)
      } catch {
        fallbackOnly.add(key)
      }
    },
    removeItem(key) {
      fallback.delete(key)
      fallbackOnly.delete(key)
      try {
        primary.removeItem(key)
      } catch {
        // The in-memory copy is still cleared when persistent storage is blocked.
      }
    },
  }
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hashPassword(password: string, salt: string) {
  const encoded = new TextEncoder().encode(`${salt}:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return toHex(new Uint8Array(digest))
}

function createSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)))
}

export function createAuthStorage(primaryStorage: KeyValueStorage): AuthStorageAdapter {
  const storage = createResilientStorage(primaryStorage)
  const readAccount = () => parseAccount(storage.getItem(AUTH_ACCOUNT_KEY))
  const writeAccount = (account: Account) => storage.setItem(AUTH_ACCOUNT_KEY, JSON.stringify(account))

  return {
    async register(input: RegisterInput) {
      const account: Account = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        email: normalizeEmail(input.email),
        timezone: 'Asia/Shanghai (UTC+8)',
        avatar: { kind: 'preset', value: 'amber' },
        taskCount: 37,
        agentSessionCount: 12,
      }
      const salt = createSalt()
      const credential: StoredCredential = {
        version: 1,
        accountId: account.id,
        salt,
        hash: await hashPassword(input.password, salt),
      }
      writeAccount(account)
      storage.setItem(AUTH_CREDENTIAL_KEY, JSON.stringify(credential))
      storage.removeItem(AUTH_SESSION_KEY)
      return account
    },

    async login(input: LoginInput) {
      const account = readAccount()
      const credential = parseCredential(storage.getItem(AUTH_CREDENTIAL_KEY))
      const email = normalizeEmail(input.email)
      const hash = credential ? await hashPassword(input.password, credential.salt) : ''
      if (!account || account.email !== email || credential?.accountId !== account.id || credential.hash !== hash) {
        throw new Error('邮箱或密码不正确')
      }
      storage.setItem(AUTH_SESSION_KEY, account.id)
      return account
    },

    async logout() {
      storage.removeItem(AUTH_SESSION_KEY)
    },

    async getSession(): Promise<Session | null> {
      const account = readAccount()
      if (!account || storage.getItem(AUTH_SESSION_KEY) !== account.id) return null
      return { account }
    },

    async updateProfile(input: ProfileUpdate) {
      const account = readAccount()
      if (!account || storage.getItem(AUTH_SESSION_KEY) !== account.id) throw new Error('登录状态已失效')
      const updated = { ...account, ...input, email: input.email ? normalizeEmail(input.email) : account.email }
      writeAccount(updated)
      return updated
    },
  }
}

const fallbackStorage = new Map<string, string>()
const memoryStorage: KeyValueStorage = {
  getItem: (key) => fallbackStorage.get(key) ?? null,
  setItem: (key, value) => fallbackStorage.set(key, value),
  removeItem: (key) => fallbackStorage.delete(key),
}

function browserStorage(): KeyValueStorage {
  if (typeof window === 'undefined') return memoryStorage
  try {
    return window.localStorage
  } catch {
    return memoryStorage
  }
}

export const authStorage = createAuthStorage(browserStorage())
