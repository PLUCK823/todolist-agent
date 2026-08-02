import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ToastProvider } from '../components/common/ToastRegion'
import { ShellProvider } from '../features/shell/ShellContext'
import { AuthProvider } from '../features/auth/AuthContext'
import { PreferencesProvider } from '../features/preferences/PreferencesContext'
import { queryClient } from './queryClient'

export default function AppProviders({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const bootstrapSession = pathname !== '/login' && pathname !== '/register'
  useEffect(() => {
    if (!bootstrapSession) queryClient.clear()
  }, [bootstrapSession])
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider bootstrapSession={bootstrapSession}>
        <PreferencesProvider>
          <ToastProvider><ShellProvider>{children}</ShellProvider></ToastProvider>
        </PreferencesProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
