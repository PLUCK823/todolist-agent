import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { render, type RenderOptions } from '@testing-library/react'

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
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries || ['/']}>
        {children}
      </MemoryRouter>
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
  const { initialEntries, ...renderOpts } = options || {}
  return render(ui, {
    wrapper: createWrapper({ initialEntries }),
    ...renderOpts,
  })
}
