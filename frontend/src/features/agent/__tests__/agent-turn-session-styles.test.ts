import { describe, expect, it } from 'vitest'
import globalStyles from '../../../styles/global.css?raw'
import motionStyles from '../../../styles/motion.css?raw'

describe('agent turn and session list styles', () => {
  it('keeps disclosures and session actions keyboard-visible with WCAG-sized targets', () => {
    expect(globalStyles).toMatch(/\.agent-turn__disclosure\s*\{[\s\S]*?min-height:\s*32px/)
    expect(globalStyles).toMatch(/\.agent-turn__disclosure:focus-visible[\s\S]*?var\(--focus-ring\)/)
    expect(globalStyles).toMatch(/\.agent-session-list__select\s*\{[\s\S]*?min-height:\s*36px/)
    expect(globalStyles).toMatch(/\.agent-session-list__actions button\s*\{[\s\S]*?min-height:\s*36px/)
  })

  it('contains long turn content and respects the shared reduced-motion contract', () => {
    expect(globalStyles).toMatch(/\.agent-turn\s*\{[\s\S]*?min-width:\s*0/)
    expect(globalStyles).toMatch(/\.agent-turn__message[\s\S]*?overflow-wrap:\s*anywhere/)
    expect(globalStyles).toMatch(/\.agent-turn \.agent-markdown__table-scroll[\s\S]*?max-width:\s*100%/)
    expect(motionStyles).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
