import { agentEventScenarios, type AgentEventScenario } from '../../src/mocks/agentFixtures'
import { expect, postE2EControl, test as apiTest } from './api.fixture'

export type AgentScenarioName = 'success' | 'timeout' | 'validationError' | 'confirmationRequired' | 'disconnect'

export interface AgentScenarioOptions {
  timeScale?: number
}

export interface AgentFixtures {
  useAgentScenario: (name: AgentScenarioName, options?: AgentScenarioOptions) => Promise<void>
}

export const agentScenarios = {
  success: agentEventScenarios.success,
  timeout: agentEventScenarios.timeout,
  confirmation: agentEventScenarios.confirmationRequired,
} satisfies Record<'success' | 'timeout' | 'confirmation', AgentEventScenario>

export const test = apiTest.extend<AgentFixtures>({
  useAgentScenario: async ({ page }, provide) => {
    await provide(async (name, options) => {
      await postE2EControl(page, '/api/__e2e__/agent/scenario', {
        name,
        timeScale: options?.timeScale ?? 0,
      })
    })
  },
})

export { expect }
