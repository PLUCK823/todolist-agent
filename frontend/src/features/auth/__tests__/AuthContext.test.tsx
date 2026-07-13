import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../AuthContext'
import { useAuth } from '../auth-context'
import { createAuthStorage, type KeyValueStorage } from '../auth.storage'

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

    expect(storage.getItem('todolist.auth.account')).not.toContain('password1')
  })
})

describe('AuthProvider', () => {
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
})
