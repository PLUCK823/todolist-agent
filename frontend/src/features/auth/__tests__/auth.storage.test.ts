import { describe, expect, it } from 'vitest'
import { loadStoredAvatar, saveStoredAvatar } from '../auth.storage'

describe('avatar presentation storage', () => {
  it('keeps avatar references in device-local IndexedDB storage isolated by account', async () => {
    await saveStoredAvatar('alice', { kind: 'preset', value: 'ocean' })

    await expect(loadStoredAvatar('alice')).resolves.toEqual({ kind: 'preset', value: 'ocean' })
    await expect(loadStoredAvatar('bob')).resolves.toBeNull()
    expect(Object.keys(localStorage).some((key) => key.includes('alice'))).toBe(false)
  })
})
