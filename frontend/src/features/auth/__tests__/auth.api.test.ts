import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server'
import { createAuthApi } from '../auth.api'
import { loadStoredAvatar } from '../auth.storage'

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
        return HttpResponse.json({ code: 0, message: 'ok', data: { ...account, name: 'New User', email: 'new@example.com' } }, { status: 201 })
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
      http.get('/api/auth/me', () => HttpResponse.json({ code: 40101, message: '未登录', data: null }, { status: 401 })),
      http.post('/api/auth/refresh', () => HttpResponse.json({ code: 40102, message: '未登录', data: null }, { status: 401 })),
    )

    const api = createAuthApi()
    await expect(api.register({ name: 'New User', email: 'new@example.com', password: 'password1' })).resolves.toMatchObject({ email: 'new@example.com' })
    await expect(api.getSession()).resolves.toBeNull()
    await expect(api.login({ email: 'new@example.com', password: 'password1' })).resolves.toMatchObject({ email: 'new@example.com' })
    await expect(api.logout()).resolves.toBeUndefined()
    expect(calls).toEqual(['register', 'login', 'logout'])
  })

  it('cannot let an old me response replace a newer login identity or receive its avatar', async () => {
    const alice = { ...account, id: 'race-alice', name: 'Alice', email: 'alice@example.com' }
    const bob = { ...account, id: 'race-bob', name: 'Bob', email: 'bob@example.com' }
    let releaseAlice!: () => void
    let markAliceStarted!: () => void
    let meCalls = 0
    const delayedAlice = new Promise<void>((resolve) => { releaseAlice = resolve })
    const aliceStarted = new Promise<void>((resolve) => { markAliceStarted = resolve })
    server.use(
      http.get('/api/auth/me', async () => {
        meCalls += 1
        if (meCalls === 1) {
          markAliceStarted()
          await delayedAlice
          return ok(alice)
        }
        return ok(bob)
      }),
      http.post('/api/auth/login', () => ok(bob)),
    )
    const api = createAuthApi()

    const oldSession = api.getSession()
    await aliceStarted
    await expect(api.login({ email: bob.email, password: 'password1' })).resolves.toMatchObject({ id: bob.id })
    releaseAlice()
    const settledOldSession = await oldSession.catch(() => null)
    if (settledOldSession) expect(settledOldSession.account.id).toBe(bob.id)

    await expect(api.updateProfile({ avatar: { kind: 'preset', value: 'ocean' } })).resolves.toMatchObject({
      id: bob.id, avatar: { kind: 'preset', value: 'ocean' },
    })
    await expect(loadStoredAvatar(alice.id)).resolves.toBeNull()
    await expect(loadStoredAvatar(bob.id)).resolves.toEqual({ kind: 'preset', value: 'ocean' })
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

  it('linearizes overlapping logins so the last invocation owns the final Cookie session', async () => {
    const alice = { ...account, id: 'linear-alice', email: 'alice-linear@example.com' }
    const bob = { ...account, id: 'linear-bob', email: 'bob-linear@example.com' }
    let cookieSession = ''
    let releaseAlice!: () => void
    let markAliceStarted!: () => void
    let markBobStarted!: () => void
    const aliceGate = new Promise<void>((resolve) => { releaseAlice = resolve })
    const aliceStarted = new Promise<void>((resolve) => { markAliceStarted = resolve })
    const bobStarted = new Promise<void>((resolve) => { markBobStarted = resolve })
    server.use(http.post('/api/auth/login', async ({ request }) => {
      const input = await request.json() as { email: string }
      if (input.email === alice.email) {
        markAliceStarted()
        await aliceGate
        cookieSession = alice.id
        return ok(alice)
      }
      markBobStarted()
      cookieSession = bob.id
      return ok(bob)
    }))
    const api = createAuthApi()

    const first = api.login({ email: alice.email, password: 'password1' })
    await aliceStarted
    const second = api.login({ email: bob.email, password: 'password1' })
    setTimeout(releaseAlice, 10)
    await bobStarted

    await expect(first).rejects.toMatchObject({ status: 409 })
    await expect(second).resolves.toMatchObject({ id: bob.id })
    expect(cookieSession).toBe(bob.id)
  })

  it('linearizes logout after an in-flight login so a late login Cookie cannot restore the session', async () => {
    const alice = { ...account, id: 'logout-alice', email: 'logout-alice@example.com' }
    let cookieSession = ''
    let releaseLogin!: () => void
    let markLoginStarted!: () => void
    let markLogoutStarted!: () => void
    const loginGate = new Promise<void>((resolve) => { releaseLogin = resolve })
    const loginStarted = new Promise<void>((resolve) => { markLoginStarted = resolve })
    const logoutStarted = new Promise<void>((resolve) => { markLogoutStarted = resolve })
    server.use(
      http.post('/api/auth/login', async () => {
        markLoginStarted()
        await loginGate
        cookieSession = alice.id
        return ok(alice)
      }),
      http.post('/api/auth/logout', () => {
        markLogoutStarted()
        cookieSession = ''
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const api = createAuthApi()

    const login = api.login({ email: alice.email, password: 'password1' })
    await loginStarted
    const logout = api.logout()
    setTimeout(releaseLogin, 10)
    await logoutStarted

    await expect(login).rejects.toMatchObject({ status: 409 })
    await expect(logout).resolves.toBeUndefined()
    expect(cookieSession).toBe('')
  })

  it('continues the Cookie mutation queue after a failed login', async () => {
    const bob = { ...account, id: 'after-failure-bob', email: 'after-failure@example.com' }
    let cookieSession = ''
    server.use(http.post('/api/auth/login', async ({ request }) => {
      const input = await request.json() as { email: string }
      if (input.email === 'fail@example.com') {
        return HttpResponse.json({ code: 40102, message: '失败', data: null }, { status: 401 })
      }
      cookieSession = bob.id
      return ok(bob)
    }))
    const api = createAuthApi()

    const failed = api.login({ email: 'fail@example.com', password: 'password1' })
    const succeeded = api.login({ email: bob.email, password: 'password1' })

    await expect(failed).rejects.toBeInstanceOf(Error)
    await expect(succeeded).resolves.toMatchObject({ id: bob.id })
    expect(cookieSession).toBe(bob.id)
  })
})
