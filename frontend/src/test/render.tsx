import { useRef, type ReactElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { render, type RenderOptions } from '@testing-library/react'
import { ToastProvider } from '../components/common/ToastRegion'
import { AuthProvider } from '../features/auth/AuthContext'
import type { Account, AuthStorageAdapter } from '../features/auth/auth.types'
import { PreferencesProvider } from '../features/preferences/PreferencesContext'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

interface WrapperOptions {
  initialEntries?: string[]
}

export function TestProviders({ children, initialEntries }: { children: ReactNode; initialEntries?: string[] }) {
  const queryClient = createTestQueryClient()
  const account: Account = { id: 'test-user', name: 'Plucky HZ', email: 'plucky@example.com', timezone: 'Asia/Shanghai (UTC+8)', avatar: { kind: 'preset', value: 'amber' }, taskCount: 37, agentSessionCount: 12 }
  const current = useRef(account)
  const storage: AuthStorageAdapter = {
    register: async (input) => ({ ...current.current, name: input.name, email: input.email }),
    login: async (input) => {
      if (input.email !== current.current.email) throw new Error('邮箱或密码不正确')
      return current.current
    },
    logout: async () => undefined,
    getSession: async () => ({ account: current.current }),
    updateProfile: async (input) => { current.current = { ...current.current, ...input }; return current.current },
  }
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider storage={storage} initialAccount={account}>
          <PreferencesProvider>
            <MemoryRouter initialEntries={initialEntries || ['/']}>{children}</MemoryRouter>
          </PreferencesProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}

export function createWrapper(options?: WrapperOptions) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <TestProviders initialEntries={options?.initialEntries}>{children}</TestProviders>
  }
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & WrapperOptions,
): ReturnType<typeof render> {
  const { initialEntries, ...renderOptions } = options || {}
  return render(ui, {
    wrapper: createWrapper({ initialEntries }),
    ...renderOptions,
  })
}
