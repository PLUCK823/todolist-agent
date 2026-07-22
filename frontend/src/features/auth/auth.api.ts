import { ApiError, apiFetch, authenticatedFetch, beginAuthTransition, getAuthGeneration } from '../../shared/api/authenticated-fetch'
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
  const readStableSession = async (): Promise<Session | null> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generation = getAuthGeneration()
      try {
        const account = await applyStoredAvatar(parseAccount(await authenticatedFetch<unknown>('/api/auth/me')))
        if (generation === getAuthGeneration()) return { account }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    }
    throw new ApiError('登录状态已发生变化，请重试', 409)
  }

  return {
    async register(input: RegisterInput) {
      const value = await apiFetch<unknown>('/api/auth/register', jsonRequest('POST', input))
      return applyStoredAvatar(parseAccount(value))
    },

    async login(input: LoginInput) {
      const generation = beginAuthTransition()
      const account = await applyStoredAvatar(parseAccount(await apiFetch<unknown>('/api/auth/login', jsonRequest('POST', input))))
      if (generation !== getAuthGeneration()) throw new ApiError('登录状态已发生变化，请重试', 409)
      return account
    },

    async logout() {
      beginAuthTransition()
      await apiFetch<void>('/api/auth/logout', { method: 'POST' })
    },

    async getSession(): Promise<Session | null> {
      return readStableSession()
    },

    async updateProfile(input: ProfileUpdate) {
      let account = (await readStableSession())?.account ?? null
      if (!account) throw new ApiError('登录状态已失效', 401, 40101)
      const trustedAccountId = account.id
      const trustedGeneration = getAuthGeneration()

      const { avatar, ...serverInput } = input
      if (Object.keys(serverInput).length > 0) {
        const updated = parseAccount(await authenticatedFetch<unknown>('/api/auth/me', jsonRequest('PATCH', serverInput)))
        if (updated.id !== trustedAccountId) throw new ApiError('登录状态已发生变化，请重试', 409)
        if (trustedGeneration !== getAuthGeneration()) {
          const current = (await readStableSession())?.account
          if (!current || current.id !== trustedAccountId) throw new ApiError('登录状态已发生变化，请重试', 409)
          account = current
        } else {
          account = await applyStoredAvatar(updated)
        }
      }
      if (avatar) {
        if (trustedGeneration !== getAuthGeneration()) {
          const current = (await readStableSession())?.account
          if (!current || current.id !== trustedAccountId) throw new ApiError('登录状态已发生变化，请重试', 409)
          account = current
        }
        await saveStoredAvatar(account.id, avatar)
        if (trustedAccountId !== account.id || (trustedGeneration !== getAuthGeneration() && (await readStableSession())?.account.id !== trustedAccountId)) {
          throw new ApiError('登录状态已发生变化，请重试', 409)
        }
        account = { ...account, avatar }
      }
      return account
    },
  }
}

export const authApi = createAuthApi()
