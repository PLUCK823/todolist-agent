import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import { server } from './mocks/server'
import { resetTodos } from './mocks/handlers'

// Polyfill requestAnimationFrame for jsdom
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number
  }
  globalThis.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id)
  }
}

// Polyfill scrollIntoView for jsdom
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = vi.fn()
}

// Polyfill window.scrollTo for jsdom
if (typeof window !== 'undefined' && typeof window.scrollTo !== 'undefined') {
  // already defined
} else if (typeof window !== 'undefined') {
  ;(window as Window & typeof globalThis).scrollTo = vi.fn()
}

// Polyfill crypto.randomUUID for jsdom
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {} as Crypto
}
if (typeof globalThis.crypto.randomUUID === 'undefined') {
  let uuidCounter = 0
  globalThis.crypto.randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    uuidCounter++
    const hex = uuidCounter.toString(16).padStart(8, '0')
    return `${hex}-0000-0000-0000-000000000000` as `${string}-${string}-${string}-${string}-${string}`
  }
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' })
})

afterEach(() => {
  resetTodos()
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})
