import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ToastProvider } from '../components/common/ToastRegion'
import { ShellProvider } from '../features/shell/ShellContext'
import { queryClient } from './queryClient'

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ShellProvider>{children}</ShellProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
