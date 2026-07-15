import { createContext, useContext } from 'react'
import type { Account, LoginInput, ProfileUpdate, RegisterInput } from './auth.types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  status: AuthStatus
  account: Account | null
  login(input: LoginInput): Promise<Account>
  register(input: RegisterInput): Promise<Account>
  logout(): Promise<void>
  updateProfile(input: ProfileUpdate): Promise<Account>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

export function useOptionalAuth() {
  return useContext(AuthContext)
}
