import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server'
import { createAuthApi } from '../auth.api'

const account = {
  id: 'user-1', name: 'Server User', email: 'user@example.com', timezone: 'Asia/Shanghai',
  avatar: { kind: 'preset' as const, value: 'amber' as const }, taskCount: 3, agentSessionCount: 2,
}
const ok = <T,>(data: T) => HttpResponse.json({ code: 0, message: 'ok', data })

describe('authApi', () => {
  it('reads the initial server session and never persists identity or credentials', async () => {
    localStorage.setItem('unrelated', 'keep')
    localStorage.setItem('todolist.auth.account', 'legacy-account')
    localStorage.setItem('todolist.auth.credential', 'legacy-credential')
    localStorage.setItem('todolist.auth.session', 'legacy-session')
    server.use(http.get('/api/auth/me', ({ request }) => {
      expect(request.credentials).toBe('include')
      return ok(account)
    }))

    await expect(createAuthApi().getSession()).resolves.toEqual({ account })
    expect(Object.keys(localStorage)).toEqual(['unrelated'])
  })

  it('returns null when the server session and refresh are both expired', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ code: 40101, message: 'expired', data: null }, { status: 401 })),
      http.post('/api/auth/refresh', () => HttpResponse.json({ code: 40102, message: 'expired', data: null }, { status: 401 })),
    )

    await expect(createAuthApi().getSession()).resolves.toBeNull()
  })

  it('registers, logs in and logs out through Cookie endpoints', async () => {
    const calls: string[] = []
    server.use(
      http.post('/api/auth/register', async ({ request }) => {
        calls.push('register')
        expect(request.credentials).toBe('include')
        expect(await request.json()).toEqual({ name: 'New User', email: 'new@example.com', password: 'password1' })
        return ok({ ...account, name: 'New User', email: 'new@example.com' })
      }),
      http.post('/api/auth/login', async ({ request }) => {
        calls.push('login')
        expect(request.credentials).toBe('include')
        expect(await request.json()).toEqual({ email: 'new@example.com', password: 'password1' })
        return ok({ ...account, name: 'New User', email: 'new@example.com' })
      }),
      http.post('/api/auth/logout', ({ request }) => {
        calls.push('logout')
        expect(request.credentials).toBe('include')
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const api = createAuthApi()
    await expect(api.register({ name: 'New User', email: 'new@example.com', password: 'password1' })).resolves.toMatchObject({ email: 'new@example.com' })
    await expect(api.login({ email: 'new@example.com', password: 'password1' })).resolves.toMatchObject({ email: 'new@example.com' })
    await expect(api.logout()).resolves.toBeUndefined()
    expect(calls).toEqual(['register', 'login', 'logout'])
  })

  it('does not treat registration as an authenticated session', async () => {
    server.use(
      http.post('/api/auth/register', () => ok(account)),
      http.get('/api/auth/me', () => HttpResponse.json({ code: 40101, message: '未登录', data: null }, { status: 401 })),
      http.post('/api/auth/refresh', () => HttpResponse.json({ code: 40102, message: '未登录', data: null }, { status: 401 })),
    )
    const api = createAuthApi()

    await api.register({ name: 'Server User', email: 'user@example.com', password: 'password1' })
    await expect(api.updateProfile({ avatar: { kind: 'preset', value: 'ocean' } })).rejects.toThrow('登录状态已失效')
  })

  it('updates profile identity on the server while keeping avatar presentation device-local', async () => {
    let patchBody: unknown
    server.use(
      http.get('/api/auth/me', () => ok(account)),
      http.patch('/api/auth/me', async ({ request }) => {
        patchBody = await request.json()
        return ok({ ...account, name: 'Updated' })
      }),
    )
    const api = createAuthApi()
    await api.getSession()

    await expect(api.updateProfile({ name: 'Updated', avatar: { kind: 'preset', value: 'ocean' } })).resolves.toMatchObject({
      name: 'Updated', avatar: { kind: 'preset', value: 'ocean' },
    })
    expect(patchBody).toEqual({ name: 'Updated' })
    expect(localStorage.getItem('todolist.auth.account')).toBeNull()
    expect(localStorage.getItem('todolist.auth.credential')).toBeNull()
    expect(localStorage.getItem('todolist.auth.session')).toBeNull()
  })

  it('surfaces server API errors from login without attempting refresh', async () => {
    let loginCalls = 0
    let refreshCalls = 0
    server.use(
      http.post('/api/auth/login', () => {
        loginCalls += 1
        return HttpResponse.json({ code: 40102, message: '邮箱或密码不正确', data: null }, { status: 401 })
      }),
      http.post('/api/auth/refresh', () => {
        refreshCalls += 1
        return ok(account)
      }),
    )

    await expect(createAuthApi().login({ email: 'x@example.com', password: 'wrongpass' })).rejects.toThrow('邮箱或密码不正确')
    expect(loginCalls).toBe(1)
    expect(refreshCalls).toBe(0)
  })

  it('fails closed when a successful envelope contains a malformed account', async () => {
    server.use(http.get('/api/auth/me', () => ok({ id: 'incomplete' })))

    await expect(createAuthApi().getSession()).rejects.toThrow('账户响应格式错误')
  })
})
