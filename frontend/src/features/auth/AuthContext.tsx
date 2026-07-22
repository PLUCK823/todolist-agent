import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { API_AUTH_EXPIRED_EVENT, getAuthGeneration, type AuthExpiredDetail } from '../../shared/api/authenticated-fetch'
import { authApi } from './auth.api'
import type { Account, AuthApi, LoginInput, ProfileUpdate, RegisterInput } from './auth.types'
import { AuthContext, type AuthStatus } from './auth-context'

export function AuthProvider({ children, api = authApi, initialAccount }: { children: ReactNode; api?: AuthApi; initialAccount?: Account }) {
  const [status, setStatus] = useState<AuthStatus>(initialAccount ? 'authenticated' : 'loading')
  const [account, setAccount] = useState<Account | null>(initialAccount ?? null)
  const operation = useRef(0)

  useEffect(() => {
    if (initialAccount) return
    let active = true
    const currentOperation = operation.current
    api.getSession()
      .then((session) => {
        if (!active || operation.current !== currentOperation) return
        setAccount(session?.account ?? null)
        setStatus(session ? 'authenticated' : 'anonymous')
      })
      .catch(() => {
        if (!active || operation.current !== currentOperation) return
        setAccount(null)
        setStatus('anonymous')
      })
    return () => { active = false }
  }, [api, initialAccount])

  useEffect(() => {
    const onAuthExpired = (event: Event) => {
      const generation = (event as CustomEvent<AuthExpiredDetail>).detail?.generation
      if (generation !== getAuthGeneration()) return
      operation.current += 1
      setAccount(null)
      setStatus('anonymous')
    }
    window.addEventListener(API_AUTH_EXPIRED_EVENT, onAuthExpired)
    return () => window.removeEventListener(API_AUTH_EXPIRED_EVENT, onAuthExpired)
  }, [])

  const login = useCallback(async (input: LoginInput) => {
    const currentOperation = ++operation.current
    const next = await api.login(input)
    if (operation.current === currentOperation) {
      setAccount(next)
      setStatus('authenticated')
    }
    return next
  }, [api])

  const register = useCallback((input: RegisterInput) => api.register(input), [api])

  const logout = useCallback(async () => {
    const currentOperation = ++operation.current
    try {
      await api.logout()
    } finally {
      if (operation.current === currentOperation) {
        setAccount(null)
        setStatus('anonymous')
      }
    }
  }, [api])

  const updateProfile = useCallback(async (input: ProfileUpdate) => {
    const currentOperation = ++operation.current
    const next = await api.updateProfile(input)
    if (operation.current === currentOperation) setAccount(next)
    return next
  }, [api])

  const value = useMemo(() => ({ status, account, login, register, logout, updateProfile }), [account, login, logout, register, status, updateProfile])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
