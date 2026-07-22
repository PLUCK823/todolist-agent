import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../AuthContext'
import type { AuthApi } from '../auth.types'
import RequireSession from '../RequireSession'

function LoginLocation() {
  const location = useLocation()
  return <p>登录页:{String(location.state?.from?.pathname ?? '')}</p>
}

describe('RequireSession', () => {
  it('redirects signed-out visitors to login and preserves the target', async () => {
    const api: AuthApi = {
      register: vi.fn(), login: vi.fn(), logout: vi.fn(),
      getSession: vi.fn().mockResolvedValue(null), updateProfile: vi.fn(),
    }
    render(
      <AuthProvider api={api}>
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
