import { describe, expect, it } from 'vitest'
import { agentEventScenarios, agentMockDelays } from '../../../mocks/agentFixtures'
import { parseAgentEvent } from '../agent.api'

describe('agent event fixtures', () => {
  it('provides deterministic valid scenarios for every required outcome', () => {
    expect(Object.keys(agentEventScenarios)).toEqual([
      'success', 'timeout', 'validationError', 'confirmationRequired',
    ])
    for (const scenario of Object.values(agentEventScenarios)) {
      expect(scenario.events.map(({ event }) => parseAgentEvent(event))).toHaveLength(scenario.events.length)
    }
  })

  it('keeps mock timings inside the design specification ranges', () => {
    expect(agentMockDelays).toEqual({
      understand: 800,
      callTodoApi: 800,
      waitForTodoApi: 1400,
      syncPage: 800,
    })
  })
})
