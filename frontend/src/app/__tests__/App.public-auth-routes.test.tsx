import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../../App'
import { server } from '../../mocks/server'
import { queryClient } from '../queryClient'

describe('public authentication routes', () => {
  afterEach(() => window.history.replaceState({}, '', '/'))

  it.each([
    ['/login', '登录'],
    ['/register', '创建账号'],
  ])('does not probe or refresh a session on %s', async (path, actionName) => {
    let meCalls = 0
    let refreshCalls = 0
    server.use(
      http.get('/api/auth/me', () => {
        meCalls += 1
        return HttpResponse.json({ code: 40101, message: '未登录', data: null }, { status: 401 })
      }),
      http.post('/api/auth/refresh', () => {
        refreshCalls += 1
        return HttpResponse.json({ code: 40102, message: '未登录', data: null }, { status: 401 })
      }),
    )
    window.history.replaceState({}, '', path)

    render(<App />)

    await screen.findByRole('button', { name: actionName })
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    expect(meCalls).toBe(0)
    expect(refreshCalls).toBe(0)
  })

  it('clears private query data before rendering a public authentication page', async () => {
    queryClient.setQueryData(['todos', 'list'], { items: [{ title: 'previous user private task' }] })
    window.history.replaceState({}, '', '/login')

    render(<App />)

    await screen.findByRole('button', { name: '登录' })
    expect(queryClient.getQueryData(['todos', 'list'])).toBeUndefined()
  })
})
