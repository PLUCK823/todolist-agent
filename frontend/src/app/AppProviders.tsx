import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ToastProvider } from '../components/common/ToastRegion'
import { ShellProvider } from '../features/shell/ShellContext'
import { AuthProvider } from '../features/auth/AuthContext'
import { PreferencesProvider } from '../features/preferences/PreferencesContext'
import { queryClient } from './queryClient'

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PreferencesProvider>
          <ToastProvider><ShellProvider>{children}</ShellProvider></ToastProvider>
        </PreferencesProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
