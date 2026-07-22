import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server'
import {
  API_AUTH_EXPIRED_EVENT,
  ApiError,
  apiFetch,
  authenticatedFetch,
} from '../authenticated-fetch'

const ok = <T,>(data: T) => HttpResponse.json({ code: 0, message: 'ok', data })

describe('authenticatedFetch', () => {
  it('includes credentials and unwraps the API envelope', async () => {
    server.use(http.get('/api/private', ({ request }) => {
      expect(request.credentials).toBe('include')
      return ok({ value: 42 })
    }))

    await expect(authenticatedFetch<{ value: number }>('/api/private')).resolves.toEqual({ value: 42 })
  })

  it('refreshes once after a 401 and retries the original request once', async () => {
    let privateCalls = 0
    let refreshCalls = 0
    server.use(
      http.get('/api/private', () => {
        privateCalls += 1
        return privateCalls === 1
          ? HttpResponse.json({ code: 40101, message: 'expired', data: null }, { status: 401 })
          : ok({ value: 'restored' })
      }),
      http.post('/api/auth/refresh', ({ request }) => {
        refreshCalls += 1
        expect(request.credentials).toBe('include')
        return ok({ id: 'u1' })
      }),
    )

    await expect(authenticatedFetch('/api/private')).resolves.toEqual({ value: 'restored' })
    expect(privateCalls).toBe(2)
    expect(refreshCalls).toBe(1)
  })

  it('shares one refresh across concurrent 401 responses', async () => {
    let refreshCalls = 0
    let authorized = false
    server.use(
      http.get('/api/private/:id', () => authorized
        ? ok({ restored: true })
        : HttpResponse.json({ code: 40101, message: 'expired', data: null }, { status: 401 })),
      http.post('/api/auth/refresh', async () => {
        refreshCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        authorized = true
        return ok({ id: 'u1' })
      }),
    )

    await expect(Promise.all([
      authenticatedFetch('/api/private/one'),
      authenticatedFetch('/api/private/two'),
    ])).resolves.toEqual([{ restored: true }, { restored: true }])
    expect(refreshCalls).toBe(1)
  })

  it('does not start a second refresh for an old 401 that arrives after the session epoch changed', async () => {
    let refreshCalls = 0
    const calls = new Map<string, number>()
    server.use(
      http.get('/api/private/:id', async ({ params }) => {
        const id = String(params.id)
        const count = (calls.get(id) ?? 0) + 1
        calls.set(id, count)
        if (id === 'slow' && count === 1) await new Promise((resolve) => setTimeout(resolve, 40))
        return count === 1
          ? HttpResponse.json({ code: 40101, message: 'old response', data: null }, { status: 401 })
          : ok({ id })
      }),
      http.post('/api/auth/refresh', async () => {
        refreshCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 10))
        return ok({ id: 'u1' })
      }),
    )

    await expect(Promise.all([
      authenticatedFetch('/api/private/fast'),
      authenticatedFetch('/api/private/slow'),
    ])).resolves.toEqual([{ id: 'fast' }, { id: 'slow' }])
    expect(refreshCalls).toBe(1)
  })

  it('replays a Request body safely after refresh', async () => {
    const bodies: string[] = []
    server.use(
      http.post('/api/private', async ({ request }) => {
        bodies.push(await request.text())
        return bodies.length === 1
          ? HttpResponse.json({ code: 40101, message: 'expired', data: null }, { status: 401 })
          : ok({ saved: true })
      }),
      http.post('/api/auth/refresh', () => ok({ id: 'u1' })),
    )
    const request = new Request(new URL('/api/private', window.location.href), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'same body' }),
    })

    await expect(authenticatedFetch(request)).resolves.toEqual({ saved: true })
    expect(bodies).toEqual(['{"title":"same body"}', '{"title":"same body"}'])
  })

  it('emits auth-expired once when a shared refresh fails and never retries twice', async () => {
    let privateCalls = 0
    let refreshCalls = 0
    const listener = vi.fn()
    window.addEventListener(API_AUTH_EXPIRED_EVENT, listener)
    server.use(
      http.get('/api/private/:id', () => {
        privateCalls += 1
        return HttpResponse.json({ code: 40101, message: 'expired', data: null }, { status: 401 })
      }),
      http.post('/api/auth/refresh', async () => {
        refreshCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return HttpResponse.json({ code: 40102, message: 'refresh expired', data: null }, { status: 401 })
      }),
    )

    const results = await Promise.allSettled([
      authenticatedFetch('/api/private/one'),
      authenticatedFetch('/api/private/two'),
    ])

    expect(results.every(({ status }) => status === 'rejected')).toBe(true)
    expect(privateCalls).toBe(2)
    expect(refreshCalls).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(API_AUTH_EXPIRED_EVENT, listener)
  })

  it.each(['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'])(
    'never refreshes or retries the auth endpoint %s',
    async (path) => {
      let endpointCalls = 0
      let refreshCalls = 0
      server.use(
        http.post(path, () => {
          endpointCalls += 1
          return HttpResponse.json({ code: 40102, message: 'no', data: null }, { status: 401 })
        }),
        http.post('/api/auth/refresh', () => {
          refreshCalls += 1
          return ok(null)
        }),
      )

      await expect(authenticatedFetch(path, { method: 'POST' })).rejects.toMatchObject({ status: 401 })
      expect(endpointCalls).toBe(1)
      expect(refreshCalls).toBe(0)
    },
  )

  it('does not refresh a retried request that remains unauthorized', async () => {
    let privateCalls = 0
    let refreshCalls = 0
    server.use(
      http.get('/api/private', () => {
        privateCalls += 1
        return HttpResponse.json({ code: 40101, message: 'expired', data: null }, { status: 401 })
      }),
      http.post('/api/auth/refresh', () => {
        refreshCalls += 1
        return ok({ id: 'u1' })
      }),
    )

    await expect(authenticatedFetch('/api/private')).rejects.toMatchObject({ status: 401 })
    expect(privateCalls).toBe(2)
    expect(refreshCalls).toBe(1)
  })

  it('reports non-JSON, API and network failures consistently', async () => {
    server.use(
      http.get('/api/non-json', () => new HttpResponse('gateway broke', { status: 502 })),
      http.get('/api/error', () => HttpResponse.json({ code: 40901, message: 'duplicate', data: null }, { status: 409 })),
      http.get('/api/network', () => HttpResponse.error()),
    )

    await expect(apiFetch('/api/non-json')).rejects.toBeInstanceOf(ApiError)
    await expect(apiFetch('/api/error')).rejects.toMatchObject({ status: 409, code: 40901, message: 'duplicate' })
    await expect(apiFetch('/api/network')).rejects.toMatchObject({ status: 0, message: '网络连接失败' })
  })

  it('fails closed when a success envelope omits data', async () => {
    server.use(http.get('/api/malformed', () => HttpResponse.json({ code: 0, message: 'ok' })))

    await expect(apiFetch('/api/malformed')).rejects.toThrow('服务返回了无法识别的响应')
  })
})
