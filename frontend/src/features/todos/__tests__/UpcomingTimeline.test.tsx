import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UpcomingTimeline } from '../UpcomingTimeline'
import { buildSevenDayWindow, localDateKey } from '../upcoming-calendar'
import type { Todo } from '../todo.types'

const todo = (overrides: Partial<Todo>): Todo => ({
  id: 1,
  title: '默认任务',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: '2026-07-14T02:00:00Z',
  created_at: '2026-07-10T08:00:00Z',
  updated_at: '2026-07-10T08:00:00Z',
  ...overrides,
})

describe('UpcomingTimeline calendar semantics', () => {
  it('builds seven consecutive Shanghai calendar days and avoids UTC date slicing', () => {
    const now = new Date('2026-07-13T16:30:00Z') // 上海已是 7 月 14 日

    expect(localDateKey(now)).toBe('2026-07-14')
    expect(buildSevenDayWindow(now).map((day) => day.key)).toEqual([
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
      '2026-07-20',
    ])
  })

  it('keeps seven consecutive days across a year boundary', () => {
    expect(buildSevenDayWindow(new Date('2026-12-28T16:30:00Z')).map((day) => day.key)).toEqual([
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
      '2027-01-04',
    ])
  })
})

describe('UpcomingTimeline', () => {
  it('selects a day accessibly and announces its local-date heading', async () => {
    const user = userEvent.setup()
    render(
      <UpcomingTimeline
        now={new Date('2026-07-13T00:00:00+08:00')}
        todos={[]}
        pendingToggleIds={new Set()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    )

    const july14 = screen.getByRole('button', { name: /7 月 14 日/ })
    await user.click(july14)

    expect(july14).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: '7 月 14 日' })).toBeVisible()
    expect(screen.getByText('当天暂无安排')).toBeVisible()
  })

  it('sorts selected-day events by Shanghai due time and excludes undated tasks', () => {
    render(
      <UpcomingTimeline
        now={new Date('2026-07-14T08:00:00+08:00')}
        todos={[
          todo({ id: 1, title: '下午同步', due_date: '2026-07-14T06:30:00Z' }),
          todo({ id: 2, title: '上午评审', due_date: '2026-07-14T02:00:00Z' }),
          todo({ id: 3, title: '无日期任务', due_date: null }),
          todo({ id: 4, title: 'UTC 前一日但上海当天', due_date: '2026-07-13T16:30:00Z' }),
        ]}
        pendingToggleIds={new Set()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    )

    const events = screen.getAllByRole('button', { name: /查看安排/ })
    expect(events.map((event) => event.textContent)).toEqual([
      expect.stringContaining('UTC 前一日但上海当天'),
      expect.stringContaining('上午评审'),
      expect.stringContaining('下午同步'),
    ])
    expect(screen.queryByText('无日期任务')).not.toBeInTheDocument()
  })
})
