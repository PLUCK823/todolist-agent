import { describe, expect, it } from 'vitest'
import dashboard from '../../../features/todos/TaskDashboard.tsx?raw'
import taskCard from '../../../features/todos/TaskCard.tsx?raw'
import taskDialog from '../../../features/todos/TaskDialog.tsx?raw'
import filters from '../../../features/todos/TaskFilters.tsx?raw'
import timeline from '../../../features/todos/UpcomingTimeline.tsx?raw'
import upcoming from '../../../pages/UpcomingPage.tsx?raw'
import globalStyles from '../../../styles/global.css?raw'
import tokens from '../../../styles/tokens.css?raw'

function block(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tokens.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  if (!match) throw new Error(`Missing token block: ${selector}`)
  return match[1]
}

function tokenMap(css: string) {
  return Object.fromEntries(
    [...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1], match[2]]),
  )
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/g)!.map((value) => Number.parseInt(value, 16) / 255)
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (bright + 0.05) / (dark + 0.05)
}

describe('theme-aware application surfaces', () => {
  it.each([
    ['TaskDashboard', dashboard],
    ['TaskCard', taskCard],
    ['TaskDialog', taskDialog],
    ['TaskFilters', filters],
    ['UpcomingTimeline', timeline],
    ['UpcomingPage', upcoming],
  ])('does not hard-code a white surface in %s', (_name, source) => {
    expect(source).not.toMatch(/\bbg-white(?:\b|\/)/)
  })

  it.each([
    ['TaskDashboard', dashboard],
    ['TaskCard', taskCard],
    ['TaskDialog', taskDialog],
    ['UpcomingPage', upcoming],
  ])('uses semantic theme tokens instead of fixed status palettes in %s', (_name, source) => {
    expect(source).not.toMatch(/(?:bg|border|text)-(?:red|green|emerald|amber|yellow)-\d+/)
    expect(source).not.toMatch(/text-\[#[0-9a-f]+\]/i)
  })

  it('uses semantic surfaces for standalone assistant results and errors', () => {
    expect(globalStyles).toMatch(/\.assistant-conversation \.agent-step__result,[\s\S]*?background:\s*var\(--success-surface\)/)
    expect(globalStyles).toMatch(/\.assistant-inspector \.agent-step__result pre\s*\{\s*color:\s*var\(--success-surface-text\)/)
    expect(globalStyles).toMatch(/\.assistant-clear-error\s*\{[\s\S]*?background:\s*var\(--danger-surface\)/)
  })

  it.each([':root', ':root[data-theme="dark"]'])('%s semantic status surfaces keep readable text', (selector) => {
    const values = tokenMap(block(selector))
    for (const intent of ['success', 'warning', 'danger']) {
      expect(values[`${intent}-surface`], `${selector} --${intent}-surface`).toBeDefined()
      expect(values[`${intent}-surface-text`], `${selector} --${intent}-surface-text`).toBeDefined()
      expect(contrastRatio(values[`${intent}-surface-text`], values[`${intent}-surface`])).toBeGreaterThanOrEqual(4.5)
    }
  })
})
