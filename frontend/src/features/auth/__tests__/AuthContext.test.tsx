import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_AUTH_EXPIRED_EVENT, beginAuthTransition, getAuthGeneration } from '../../../shared/api/authenticated-fetch'
import { AuthProvider } from '../AuthContext'
import { useAuth } from '../auth-context'
import type { Account, AuthApi, Session } from '../auth.types'

const account: Account = {
  id: 'user-1', name: 'Plucky HZ', email: 'plucky@example.com', timezone: 'Asia/Shanghai',
  avatar: { kind: 'preset', value: 'amber' }, taskCount: 37, agentSessionCount: 12,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function createApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    register: vi.fn().mockResolvedValue(account),
    login: vi.fn().mockResolvedValue(account),
    logout: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue({ account }),
    updateProfile: vi.fn().mockImplementation(async (input) => ({ ...account, ...input })),
    ...overrides,
  }
}

describe('AuthProvider', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses the server auth API as its session source of truth', async () => {
    const api = createApi()
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider api={api}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('authenticated'))
    expect(api.getSession).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.updateProfile({ name: '新的名称' }) })
    expect(result.current.account?.name).toBe('新的名称')
    expect(api.updateProfile).toHaveBeenCalledWith({ name: '新的名称' })
  })

  it('settles as anonymous when the initial session read rejects', async () => {
    const api = createApi({ getSession: vi.fn().mockRejectedValue(new Error('network unavailable')) })
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider api={api}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('anonymous'))
    expect(result.current.account).toBeNull()
  })

  it('does not let a stale initial session response overwrite a newer login', async () => {
    const initial = deferred<Session | null>()
    const newer = { ...account, name: 'New Login' }
    const api = createApi({
      getSession: vi.fn(() => initial.promise),
      login: vi.fn().mockResolvedValue(newer),
    })
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider api={api}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => { await result.current.login({ email: newer.email, password: 'password1' }) })
    expect(result.current.account?.name).toBe('New Login')
    initial.resolve(null)
    await act(async () => { await initial.promise })
    expect(result.current.status).toBe('authenticated')
    expect(result.current.account?.name).toBe('New Login')
  })

  it('ignores a stale session response after logout', async () => {
    const initial = deferred<Session | null>()
    const api = createApi({ getSession: vi.fn(() => initial.promise) })
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider api={api}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => { await result.current.logout() })
    initial.resolve({ account })
    await act(async () => { await initial.promise })
    expect(result.current.status).toBe('anonymous')
    expect(result.current.account).toBeNull()
  })

  it('still settles initial anonymous state when registration finishes first', async () => {
    const initial = deferred<Session | null>()
    const api = createApi({ getSession: vi.fn(() => initial.promise) })
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider api={api}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => { await result.current.register({ name: 'New', email: 'new@example.com', password: 'password1' }) })
    initial.resolve(null)
    await act(async () => { await initial.promise })
    expect(result.current.status).toBe('anonymous')
  })

  it('becomes anonymous when the shared API reports an expired session', async () => {
    const api = createApi()
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider api={api}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('authenticated'))

    act(() => window.dispatchEvent(new CustomEvent(API_AUTH_EXPIRED_EVENT, { detail: { generation: getAuthGeneration() } })))
    expect(result.current.status).toBe('anonymous')
    expect(result.current.account).toBeNull()
  })

  it('ignores an old expired event while a newer login succeeds', async () => {
    const nextLogin = deferred<Account>()
    const oldGeneration = getAuthGeneration()
    const api = createApi({
      getSession: vi.fn().mockResolvedValue(null),
      login: vi.fn(() => {
        beginAuthTransition()
        return nextLogin.promise
      }),
    })
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider api={api}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('anonymous'))

    let loginPromise!: Promise<Account>
    act(() => { loginPromise = result.current.login({ email: account.email, password: 'password1' }) })
    act(() => window.dispatchEvent(new CustomEvent(API_AUTH_EXPIRED_EVENT, { detail: { generation: oldGeneration } })))
    nextLogin.resolve(account)
    await act(async () => { await loginPromise })

    expect(result.current.status).toBe('authenticated')
    expect(result.current.account).toEqual(account)
  })

  it('does not use browser storage events as authentication state', async () => {
    const api = createApi()
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider api={api}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('authenticated'))

    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'todolist.auth.session' })))
    expect(api.getSession).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('authenticated')
  })
})
