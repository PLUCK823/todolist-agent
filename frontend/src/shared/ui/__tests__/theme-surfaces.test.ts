import { describe, expect, it } from 'vitest'
import dashboard from '../../../features/todos/TaskDashboard.tsx?raw'
import taskCard from '../../../features/todos/TaskCard.tsx?raw'
import taskDialog from '../../../features/todos/TaskDialog.tsx?raw'
import filters from '../../../features/todos/TaskFilters.tsx?raw'
import timeline from '../../../features/todos/UpcomingTimeline.tsx?raw'
import upcoming from '../../../pages/UpcomingPage.tsx?raw'

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
})
