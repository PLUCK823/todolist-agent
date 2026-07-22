import { ApiError, apiFetch, authenticatedFetch } from '../../shared/api/authenticated-fetch'
import { applyStoredAvatar, clearLegacyAuthStorage, saveStoredAvatar } from './auth.storage'
import type { Account, AuthApi, LoginInput, ProfileUpdate, RegisterInput, Session } from './auth.types'

function parseAccount(value: unknown): Account {
  if (!value || typeof value !== 'object') throw new ApiError('账户响应格式错误', 502)
  const account = value as Partial<Account>
  const avatar = account.avatar
  if (
    typeof account.id !== 'string' || !account.id
    || typeof account.name !== 'string'
    || typeof account.email !== 'string'
    || typeof account.timezone !== 'string'
    || typeof account.taskCount !== 'number'
    || typeof account.agentSessionCount !== 'number'
    || !avatar || typeof avatar !== 'object'
    || (avatar.kind !== 'preset' && avatar.kind !== 'image' && avatar.kind !== 'blob')
    || typeof avatar.value !== 'string'
  ) {
    throw new ApiError('账户响应格式错误', 502)
  }
  return account as Account
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function createAuthApi(): AuthApi {
  clearLegacyAuthStorage()
  let currentAccount: Account | null = null
  const remember = async (value: unknown) => {
    currentAccount = await applyStoredAvatar(parseAccount(value))
    return currentAccount
  }

  return {
    async register(input: RegisterInput) {
      const value = await apiFetch<unknown>('/api/auth/register', jsonRequest('POST', input))
      return applyStoredAvatar(parseAccount(value))
    },

    async login(input: LoginInput) {
      return await remember(await apiFetch<unknown>('/api/auth/login', jsonRequest('POST', input)))
    },

    async logout() {
      try {
        await apiFetch<void>('/api/auth/logout', { method: 'POST' })
      } finally {
        currentAccount = null
      }
    },

    async getSession(): Promise<Session | null> {
      try {
        return { account: await remember(await authenticatedFetch<unknown>('/api/auth/me')) }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          currentAccount = null
          return null
        }
        throw error
      }
    },

    async updateProfile(input: ProfileUpdate) {
      let account = currentAccount
      if (!account) account = (await this.getSession())?.account ?? null
      if (!account) throw new ApiError('登录状态已失效', 401, 40101)

      const { avatar, ...serverInput } = input
      if (Object.keys(serverInput).length > 0) {
        account = await remember(await authenticatedFetch<unknown>('/api/auth/me', jsonRequest('PATCH', serverInput)))
      }
      if (avatar) {
        await saveStoredAvatar(account.id, avatar)
        account = { ...account, avatar }
        currentAccount = account
      }
      return account
    },
  }
}

export const authApi = createAuthApi()
