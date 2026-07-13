import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UpcomingTimeline } from '../UpcomingTimeline'
import {
  buildSevenDayWindow,
  dateTimeLocalToUtcRfc3339,
  localDateKey,
  upcomingUtcRange,
  utcRfc3339ToDateTimeLocal,
} from '../upcoming-calendar'
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

  it('converts between RFC3339 UTC and an IANA-zone local input independent of host TZ', () => {
    expect(utcRfc3339ToDateTimeLocal('2026-07-14T01:30:00Z')).toBe('2026-07-14T09:30')
    expect(dateTimeLocalToUtcRfc3339('2026-07-14T10:00')).toBe('2026-07-14T02:00:00.000Z')
  })

  it('resolves IANA daylight-saving offsets and rejects nonexistent local times', () => {
    expect(dateTimeLocalToUtcRfc3339('2026-01-14T10:00', 'America/New_York')).toBe('2026-01-14T15:00:00.000Z')
    expect(dateTimeLocalToUtcRfc3339('2026-07-14T10:00', 'America/New_York')).toBe('2026-07-14T14:00:00.000Z')
    expect(() => dateTimeLocalToUtcRfc3339('2026-03-08T02:30', 'America/New_York')).toThrow('不存在')
  })

  it('builds an exclusive UTC range for seven Shanghai local days', () => {
    expect(upcomingUtcRange(new Date('2026-07-13T16:30:00Z'))).toEqual({
      dueFrom: '2026-07-13T16:00:00.000Z',
      dueTo: '2026-07-20T16:00:00.000Z',
    })
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

  it('uses id as a stable tie-breaker for matching due times', () => {
    render(
      <UpcomingTimeline
        now={new Date('2026-07-14T08:00:00+08:00')}
        todos={[
          todo({ id: 9, title: '后创建', due_date: '2026-07-14T02:00:00Z' }),
          todo({ id: 2, title: '先创建', due_date: '2026-07-14T02:00:00Z' }),
        ]}
        pendingToggleIds={new Set()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('button', { name: /查看安排/ }).map((event) => event.textContent)).toEqual([
      expect.stringContaining('先创建'),
      expect.stringContaining('后创建'),
    ])
  })

  it('keeps completed text at full opacity for AA contrast', () => {
    render(
      <UpcomingTimeline
        now={new Date('2026-07-14T08:00:00+08:00')}
        todos={[todo({ completed: true })]}
        pendingToggleIds={new Set()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '查看安排：默认任务' }).closest('article')).not.toHaveClass('opacity-65')
  })

  it('shows the year visually when the seven-day window crosses into a new year', async () => {
    const user = userEvent.setup()
    render(
      <UpcomingTimeline
        now={new Date('2026-12-28T16:30:00Z')}
        todos={[]}
        pendingToggleIds={new Set()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    )
    const januaryFirst = screen.getByRole('button', { name: /2027 年 1 月 1 日/ })
    expect(januaryFirst).toHaveTextContent('2027')
    await user.click(januaryFirst)
    expect(screen.getByRole('heading', { name: '2027 年 1 月 1 日' })).toBeVisible()
  })
})
