import { describe, expect, it } from 'vitest'
import tokens from '../../../styles/tokens.css?raw'
import { render, screen } from '@testing-library/react'
import { Dialog } from '../Dialog'
import { TextField } from '../TextField'

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
    expect(token('text-muted')).toBe('#656b7a')
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

  it('provides 3:1 non-text contrast for the unchecked completion ring', () => {
    expect(contrastRatio(token('control-border-strong'), '#ffffff')).toBeGreaterThanOrEqual(3)
  })

  it('defines surface and control tokens for explicit and system dark themes', () => {
    const explicitDark = tokens.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    const systemDark = tokens.match(/:root\[data-theme="system"\]\s*\{([\s\S]*?)\}/)?.[1] ?? ''

    for (const block of [explicitDark, systemDark]) {
      expect(block).toContain('--surface:')
      expect(block).toContain('--control-bg:')
      expect(block).toContain('--control-placeholder:')
    }
  })

  it('keeps shared fields and dialogs on theme-aware surfaces', () => {
    render(
      <>
        <TextField label="名称" placeholder="输入名称" />
        <Dialog open title="主题弹窗" onOpenChange={() => undefined}>
          内容
        </Dialog>
      </>,
    )

    expect(screen.getByRole('textbox', { name: '名称' })).toHaveClass('bg-[var(--control-bg)]')
    expect(screen.getByRole('dialog', { name: '主题弹窗' })).toHaveClass(
      'bg-[var(--surface)]',
      'max-w-[520px]',
      'rounded-[var(--radius-dialog)]',
    )
  })

  it('defines the V6 18px dialog radius', () => {
    expect(tokens).toMatch(/--radius-dialog:\s*18px;/)
    expect(tokens).toMatch(/--radius-popover:\s*13px;/)
  })
})
