import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../AuthContext'
import { createAuthStorage, type KeyValueStorage } from '../auth.storage'
import RequireSession from '../RequireSession'

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}

function LoginLocation() {
  const location = useLocation()
  return <p>登录页:{String(location.state?.from?.pathname ?? '')}</p>
}

describe('RequireSession', () => {
  it('redirects signed-out visitors to login and preserves the target', async () => {
    const adapter = createAuthStorage(memoryStorage())
    render(
      <AuthProvider storage={adapter}>
        <MemoryRouter initialEntries={['/tasks']}>
          <Routes>
            <Route path="/login" element={<LoginLocation />} />
            <Route element={<RequireSession />}><Route path="/tasks" element={<p>任务页</p>} /></Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByText('登录页:/tasks')).toBeInTheDocument())
  })
})
