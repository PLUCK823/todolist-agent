import { describe, expect, it } from 'vitest'
import tokens from '../../../styles/tokens.css?raw'

function token(name: string) {
  const match = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`Missing hexadecimal token --${name}`)
  return match[1]
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)!
      .map((value) => Number.parseInt(value, 16) / 255)
      .map((value) =>
        value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4,
      )
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }

  const light = Math.max(luminance(foreground), luminance(background))
  const dark = Math.min(luminance(foreground), luminance(background))
  return (light + 0.05) / (dark + 0.05)
}

describe('V6 color tokens', () => {
  it('retains the approved prototype brand values', () => {
    expect(token('text-muted')).toBe('#898e9d')
    expect(token('primary')).toBe('#7165ea')
    expect(token('danger')).toBe('#d9574c')
  })

  it.each(['text-secondary', 'primary-action', 'danger-action', 'success-action'])(
    'provides AA contrast for --%s against white at normal text sizes',
    (name) => {
      expect(contrastRatio(token(name), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each([
    ['warning-text', '#fefce8'],
    ['low-priority-text', '#f3f4f6'],
  ])('provides AA contrast for --%s on its priority badge surface', (name, surface) => {
    expect(contrastRatio(token(name), surface)).toBeGreaterThanOrEqual(4.5)
  })
})
