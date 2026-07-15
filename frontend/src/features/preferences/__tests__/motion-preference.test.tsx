import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreferencesProvider } from '../PreferencesContext'
import { resolveReducedMotion, useReducedMotion } from '../useReducedMotion'
import motionCss from '../../../styles/motion.css?raw'
import dialogSource from '../../../shared/ui/Dialog.tsx?raw'
import popoverSource from '../../../shared/ui/Popover.tsx?raw'

function wrapper({ children }: { children: ReactNode }) {
  return <PreferencesProvider>{children}</PreferencesProvider>
}

describe('reduced motion policy', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it.each([
    [true, false, true],
    [false, true, false],
    [null, true, true],
    [null, false, false],
  ] as const)('resolves preference %s against system %s', (preference, system, expected) => {
    expect(resolveReducedMotion(preference, system)).toBe(expected)
  })

  it('reacts to system changes only while following the system preference', () => {
    let systemReduced = false
    let listener: ((event: MediaQueryListEvent) => void) | undefined
    const media = {
      get matches() { return systemReduced },
      addEventListener: vi.fn((_name: string, next: (event: MediaQueryListEvent) => void) => { listener = next }),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => media))

    const { result } = renderHook(() => useReducedMotion(), { wrapper })
    expect(result.current).toBe(false)

    act(() => {
      systemReduced = true
      listener?.({ matches: true } as MediaQueryListEvent)
    })
    expect(result.current).toBe(true)

    vi.unstubAllGlobals()
  })

  it('lets the three-state root policy govern CSS animations', () => {
    expect(motionCss).toContain(':root:not([data-reduced-motion="false"]) *')
    expect(motionCss).toContain(':root[data-reduced-motion="true"] *')
    expect(dialogSource).not.toContain('motion-safe:')
    expect(popoverSource).not.toContain('motion-safe:')
  })
})
