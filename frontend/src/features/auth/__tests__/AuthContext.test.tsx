import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../AuthContext'
import { useAuth } from '../auth-context'
import { createAuthStorage, type KeyValueStorage } from '../auth.storage'
import type { AuthStorageAdapter } from '../auth.types'

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

describe('authStorage', () => {
  it('registers, logs in and logs out with a replaceable storage adapter', async () => {
    const storage = memoryStorage()
    const adapter = createAuthStorage(storage)
    const account = await adapter.register({ name: 'Plucky HZ', email: 'plucky@example.com', password: 'password1' })

    expect(await adapter.login({ email: account.email, password: 'password1' })).toMatchObject({ email: account.email })
    await adapter.logout()
    expect(await adapter.getSession()).toBeNull()
  })

  it('never persists a password', async () => {
    const storage = memoryStorage()
    const adapter = createAuthStorage(storage)
    await adapter.register({ name: 'Plucky HZ', email: 'plucky@example.com', password: 'password1' })

    expect([
      storage.getItem('todolist.auth.account'),
      storage.getItem('todolist.auth.credential'),
      storage.getItem('todolist.auth.session'),
    ].join('|')).not.toContain('password1')
  })

  it('verifies the password after creating a new adapter for the same storage', async () => {
    const storage = memoryStorage()
    await createAuthStorage(storage).register({ name: 'Plucky HZ', email: 'plucky@example.com', password: 'correct-password' })
    const reloadedAdapter = createAuthStorage(storage)

    await expect(reloadedAdapter.login({ email: 'plucky@example.com', password: 'wrong-password' })).rejects.toThrow('邮箱或密码不正确')
    await expect(reloadedAdapter.login({ email: 'plucky@example.com', password: 'correct-password' })).resolves.toMatchObject({ email: 'plucky@example.com' })
  })

  it('falls back to memory when storage reads and writes throw', async () => {
    const brokenStorage: KeyValueStorage = {
      getItem: () => { throw new Error('read denied') },
      setItem: () => { throw new Error('write denied') },
      removeItem: () => { throw new Error('remove denied') },
    }
    const adapter = createAuthStorage(brokenStorage)

    await adapter.register({ name: 'Plucky HZ', email: 'plucky@example.com', password: 'password1' })
    await expect(adapter.login({ email: 'plucky@example.com', password: 'password1' })).resolves.toMatchObject({ email: 'plucky@example.com' })
    await expect(adapter.getSession()).resolves.toMatchObject({ account: { email: 'plucky@example.com' } })
  })
})

describe('AuthProvider', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps account changes in sync with the session adapter', async () => {
    const adapter = createAuthStorage(memoryStorage())
    await adapter.register({ name: 'Plucky HZ', email: 'plucky@example.com', password: 'password1' })
    await adapter.login({ email: 'plucky@example.com', password: 'password1' })

    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider storage={adapter}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('authenticated'))

    await result.current.updateProfile({ name: '新的名称', timezone: 'Asia/Shanghai' })
    await waitFor(() => expect(result.current.account?.name).toBe('新的名称'))
    expect((await adapter.getSession())?.account.name).toBe('新的名称')
  })

  it('settles as anonymous when the initial session read rejects', async () => {
    const adapter: AuthStorageAdapter = {
      register: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getSession: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      updateProfile: vi.fn(),
    }
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider storage={adapter}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('anonymous'))
    expect(result.current.account).toBeNull()
  })

  it('synchronizes profile, logout and login changes from another tab', async () => {
    const sharedStorage = memoryStorage()
    const firstTab = createAuthStorage(sharedStorage)
    const secondTab = createAuthStorage(sharedStorage)
    await firstTab.register({ name: 'Plucky HZ', email: 'plucky@example.com', password: 'password1' })
    await firstTab.login({ email: 'plucky@example.com', password: 'password1' })
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider storage={firstTab}>{children}</AuthProvider>
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('authenticated'))

    await secondTab.updateProfile({ name: '跨标签名称' })
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'todolist.auth.account' })))
    await waitFor(() => expect(result.current.account?.name).toBe('跨标签名称'))

    await secondTab.logout()
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'todolist.auth.session' })))
    await waitFor(() => expect(result.current.status).toBe('anonymous'))

    await secondTab.login({ email: 'plucky@example.com', password: 'password1' })
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'todolist.auth.session' })))
    await waitFor(() => expect(result.current.status).toBe('authenticated'))
    expect(result.current.account?.name).toBe('跨标签名称')
  })
})

describe('browser auth storage initialization', () => {
  it('falls back safely when the localStorage getter throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('localStorage denied') },
    })
    vi.resetModules()

    try {
      const module = await import('../auth.storage')
      await expect(module.authStorage.getSession()).resolves.toBeNull()
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
      vi.resetModules()
    }
  })
})
