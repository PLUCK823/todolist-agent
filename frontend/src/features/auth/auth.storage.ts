import type { Account, AuthStorageAdapter, LoginInput, ProfileUpdate, RegisterInput, Session } from './auth.types'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const ACCOUNT_KEY = 'todolist.auth.account'
const SESSION_KEY = 'todolist.auth.session'

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

export function createAuthStorage(storage: KeyValueStorage): AuthStorageAdapter {
  let prototypeCredential: { email: string; password: string } | null = null

  const readAccount = () => parseAccount(storage.getItem(ACCOUNT_KEY))
  const writeAccount = (account: Account) => storage.setItem(ACCOUNT_KEY, JSON.stringify(account))

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
      prototypeCredential = { email: account.email, password: input.password }
      writeAccount(account)
      storage.removeItem(SESSION_KEY)
      return account
    },

    async login(input: LoginInput) {
      const account = readAccount()
      const email = normalizeEmail(input.email)
      const credentialMatches = prototypeCredential
        ? prototypeCredential.email === email && prototypeCredential.password === input.password
        : input.password.length >= 8
      if (!account || account.email !== email || !credentialMatches) {
        throw new Error('邮箱或密码不正确')
      }
      storage.setItem(SESSION_KEY, account.id)
      return account
    },

    async logout() {
      storage.removeItem(SESSION_KEY)
    },

    async getSession(): Promise<Session | null> {
      const account = readAccount()
      if (!account || storage.getItem(SESSION_KEY) !== account.id) return null
      return { account }
    },

    async updateProfile(input: ProfileUpdate) {
      const account = readAccount()
      if (!account || storage.getItem(SESSION_KEY) !== account.id) throw new Error('登录状态已失效')
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

export const authStorage = createAuthStorage(typeof window === 'undefined' ? memoryStorage : window.localStorage)
