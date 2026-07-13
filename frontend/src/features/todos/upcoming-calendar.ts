import { APP_TIME_ZONE, dateTimeLocalToUtcRfc3339 } from './time-contract'

export interface TimelineDay {
  key: string
  year: number
  day: number
  weekday: string
  label: string
}

function calendarParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) }
}

export function localDateKey(date: Date) {
  const { year, month, day } = calendarParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

function keyFromUtcCalendar(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

function formatDay(key: string): TimelineDay {
  const date = dateFromKey(key)
  const [year, month, day] = key.split('-').map(Number)
  return {
    key,
    year,
    day,
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' }).format(date),
    label: `${year} 年 ${month} 月 ${day} 日`,
  }
}

function addCalendarDays(key: string, count: number) {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() + count)
  return keyFromUtcCalendar(date)
}

export function buildSevenDayWindow(now: Date): TimelineDay[] {
  const start = dateFromKey(localDateKey(now))
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    return formatDay(keyFromUtcCalendar(date))
  })
}

export function upcomingUtcRange(now: Date) {
  const startKey = localDateKey(now)
  return {
    dueFrom: dateTimeLocalToUtcRfc3339(`${startKey}T00:00`),
    dueTo: dateTimeLocalToUtcRfc3339(`${addCalendarDays(startKey, 7)}T00:00`),
  }
}
