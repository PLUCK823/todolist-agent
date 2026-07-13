import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AUTH_STORAGE_KEYS, authStorage, type KeyValueStorage } from './auth.storage'
import type { Account, AuthStorageAdapter, LoginInput, ProfileUpdate, RegisterInput } from './auth.types'
import { AuthContext, type AuthStatus } from './auth-context'

export function AuthProvider({ children, storage = authStorage, initialAccount }: { children: ReactNode; storage?: AuthStorageAdapter; initialAccount?: Account }) {
  const [status, setStatus] = useState<AuthStatus>(initialAccount ? 'authenticated' : 'loading')
  const [account, setAccount] = useState<Account | null>(initialAccount ?? null)

  useEffect(() => {
    if (initialAccount) return
    let active = true
    storage.getSession()
      .then((session) => {
        if (!active) return
        setAccount(session?.account ?? null)
        setStatus(session ? 'authenticated' : 'anonymous')
      })
      .catch(() => {
        if (!active) return
        setAccount(null)
        setStatus('anonymous')
      })
    return () => { active = false }
  }, [initialAccount, storage])

  useEffect(() => {
    let active = true
    const syncSession = async (event: StorageEvent) => {
      if (!AUTH_STORAGE_KEYS.has(event.key)) return
      try {
        const session = await storage.getSession()
        if (!active) return
        setAccount(session?.account ?? null)
        setStatus(session ? 'authenticated' : 'anonymous')
      } catch {
        if (!active) return
        setAccount(null)
        setStatus('anonymous')
      }
    }
    const onStorage = (event: StorageEvent) => { void syncSession(event) }
    window.addEventListener('storage', onStorage)
    return () => {
      active = false
      window.removeEventListener('storage', onStorage)
    }
  }, [storage])

  const login = useCallback(async (input: LoginInput) => {
    const next = await storage.login(input)
    setAccount(next)
    setStatus('authenticated')
    return next
  }, [storage])

  const register = useCallback((input: RegisterInput) => storage.register(input), [storage])
  const logout = useCallback(async () => {
    await storage.logout()
    setAccount(null)
    setStatus('anonymous')
  }, [storage])
  const updateProfile = useCallback(async (input: ProfileUpdate) => {
    const next = await storage.updateProfile(input)
    setAccount(next)
    return next
  }, [storage])

  const value = useMemo(() => ({ status, account, login, register, logout, updateProfile }), [account, login, logout, register, status, updateProfile])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export type { KeyValueStorage }
