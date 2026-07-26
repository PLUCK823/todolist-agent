import { describe, expect, it, vi } from 'vitest'
import { serializeAuthCookieMutation } from '../auth-mutation-coordinator'

describe('serializeAuthCookieMutation', () => {
  it('continues with the next mutation after an aborted predecessor', async () => {
    const abortError = new DOMException('aborted', 'AbortError')
    const nextMutation = vi.fn(async () => 'next')

    const aborted = serializeAuthCookieMutation(async () => { throw abortError })
    const next = serializeAuthCookieMutation(nextMutation)

    await expect(aborted).rejects.toBe(abortError)
    await expect(next).resolves.toBe('next')
    expect(nextMutation).toHaveBeenCalledOnce()
  })
})
