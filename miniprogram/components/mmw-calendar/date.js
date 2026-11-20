const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function twoDigits(value) {
  return String(value).padStart(2, '0')
}

function dateKey(date) {
  return date.getFullYear() + '-' + twoDigits(date.getMonth() + 1) + '-' + twoDigits(date.getDate())
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parts = value.split('-').map(Number)
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12)
  return dateKey(date) === value ? date : null
}

function todayKey() {
  return dateKey(new Date())
}

function dateLabel(value) {
  const date = parseDate(value)
  if (!date) return ''
  const weekday = WEEKDAYS[(date.getDay() + 6) % 7]
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 · 周' + weekday
}

function dayOffset(date, delta) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta, 12)
}

function moveDate(value, offset, expanded) {
  const date = parseDate(value) || new Date()
  if (!expanded) return dateKey(dayOffset(date, offset * 7))
  const last = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0, 12)
  return dateKey(new Date(last.getFullYear(), last.getMonth(), Math.min(date.getDate(), last.getDate()), 12))
}

function calendarDays(value, expanded, now = todayKey()) {
  const selected = parseDate(value) || parseDate(now)
  const first = expanded ? new Date(selected.getFullYear(), selected.getMonth(), 1, 12) : selected
  const offset = (first.getDay() + 6) % 7
  const monday = dayOffset(first, -offset)
  const monthDays = new Date(selected.getFullYear(), selected.getMonth() + 1, 0).getDate()
  const count = expanded ? Math.ceil((monthDays + offset) / 7) * 7 : 7
  return Array.from({length: count}, (_, i) => {
    const day = dayOffset(monday, i)
    const key = dateKey(day)
    return {
      key,
      number: day.getDate(),
      label: dateLabel(key),
      outside: day.getMonth() !== selected.getMonth(),
      today: key === now,
      selected: key === value,
    }
  })
}

module.exports = {WEEKDAYS, dateKey, parseDate, todayKey, dateLabel, moveDate, calendarDays}
