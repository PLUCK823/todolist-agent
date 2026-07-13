export const APP_TIME_ZONE = 'Asia/Shanghai'

const RFC3339_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const DATE_TIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export function isRfc3339WithOffset(value: string) {
  return RFC3339_WITH_OFFSET.test(value) && Number.isFinite(Date.parse(value))
}

function zonedDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

export function utcRfc3339ToDateTimeLocal(value: string, timeZone = APP_TIME_ZONE) {
  if (!isRfc3339WithOffset(value)) throw new RangeError('时间必须是包含时区偏移的 RFC3339')
  const parts = zonedDateTimeParts(new Date(value), timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

export function dateTimeLocalToUtcRfc3339(value: string, timeZone = APP_TIME_ZONE) {
  const match = DATE_TIME_LOCAL.exec(value)
  if (!match) throw new RangeError('时间格式无效')
  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const wanted = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: 0,
  }
  const calendarCheck = new Date(Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute))
  if (
    wanted.month < 1 || wanted.month > 12 || wanted.hour > 23 || wanted.minute > 59 ||
    calendarCheck.getUTCFullYear() !== wanted.year ||
    calendarCheck.getUTCMonth() + 1 !== wanted.month ||
    calendarCheck.getUTCDate() !== wanted.day
  ) throw new RangeError('时间格式无效')

  const wantedEpoch = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute)
  let candidate = wantedEpoch
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedDateTimeParts(new Date(candidate), timeZone)
    const observedEpoch = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second)
    const correction = wantedEpoch - observedEpoch
    candidate += correction
    if (correction === 0) break
  }
  const resolved = zonedDateTimeParts(new Date(candidate), timeZone)
  if (Object.entries(wanted).some(([key, expected]) => resolved[key as keyof typeof resolved] !== expected)) {
    throw new RangeError('该本地时间在所选时区不存在')
  }
  return new Date(candidate).toISOString()
}

export function formatAppDateTime(value: string, timeZone = APP_TIME_ZONE) {
  if (!isRfc3339WithOffset(value)) return '时间格式无效'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value))
}
