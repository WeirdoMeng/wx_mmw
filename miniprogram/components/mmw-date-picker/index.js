const { WEEKDAYS, todayKey } = require('../mmw-calendar/date')

const LAST_MONTH = 9999 * 12 - 1
const YEARS_PER_PAGE = 12
const DAY_MS = 24 * 60 * 60 * 1000

function validValue(value, monthOnly) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/.test(value)) return ''
  const day = monthOnly && value.length === 7 ? value + '-01' : value
  if (day.length !== 10) return ''
  const date = new Date(day + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return ''
  return monthOnly ? day.slice(0, 7) : day
}

function monthIndex(day) {
  return (Number(day.slice(0, 4)) - 1) * 12 + Number(day.slice(5, 7)) - 1
}

function monthKey(index) {
  const year = Math.floor(index / 12) + 1
  const month = index % 12 + 1
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0')
}

function limits({ fields, start, end }) {
  const monthOnly = fields === 'month'
  return {
    min: validValue(start, monthOnly) || (monthOnly ? '0001-01' : '0001-01-01'),
    max: validValue(end, monthOnly) || (monthOnly ? '9999-12' : '9999-12-31'),
  }
}

function allowed(value, { min, max }) {
  return Boolean(value && value >= min && value <= max)
}

function overlaps(first, last, min, max) {
  return min <= max && first <= max && last >= min
}

function daysOfMonth(month, current, selected, bounds) {
  const date = new Date(month + '-01T00:00:00Z')
  const monday = date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(monday + index * DAY_MS)
    const value = day.toISOString().slice(0, 10)
    const valid = day.getUTCFullYear() >= 1 && day.getUTCFullYear() <= 9999
    return {
      key: valid ? value : 'blank-' + index,
      value: valid ? value : '',
      number: valid ? day.getUTCDate() : '',
      label: valid ? (day.getUTCMonth() + 1) + '月' + day.getUTCDate() + '日' : '',
      outside: value.slice(0, 7) !== month,
      today: value === current,
      selected: value === selected,
      disabled: !valid || !allowed(value, bounds),
    }
  })
}

Component({
  properties: {
    value: { type: String, value: '' },
    fields: { type: String, value: 'day' },
    start: { type: String, value: '' },
    end: { type: String, value: '' },
    label: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
  },
  data: {
    open: false,
    portalSupported: false,
    view: 'days',
    index: 0,
    weekdays: WEEKDAYS,
    heading: '',
    canPrev: false,
    canNext: false,
    quickAllowed: true,
    days: [],
    periods: [],
  },
  observers: {
    'disabled, fields, start, end, value'() {
      if (!this.data.open) return
      if (this.data.disabled) this.close()
      else {
        const { index, view, fields } = this.data
        this.render(index, fields === 'month' && view === 'days' ? 'months' : view)
      }
    },
  },
  lifetimes: {
    attached() {
      this.setData({ portalSupported: typeof wx.canIUse === 'function' && wx.canIUse('root-portal') })
    },
  },
  pageLifetimes: {
    hide() {
      if (this.data.open) this.close()
    },
  },
  methods: {
    show() {
      if (this.data.disabled || this.data.open) return
      const monthOnly = this.data.fields === 'month'
      const { min, max } = limits(this.data)
      const seed = validValue(this.data.value, monthOnly) || validValue(todayKey(), monthOnly)
      const initial = seed < min ? min : seed > max ? max : seed
      this.render(monthIndex(initial), monthOnly ? 'months' : 'days', true)
    },
    close() {
      this.setData({ open: false })
    },
    stop() {},
    render(index, view, open = this.data.open) {
      const monthOnly = this.data.fields === 'month'
      const bounds = limits(this.data)
      const minMonth = monthIndex(bounds.min)
      const maxMonth = monthIndex(bounds.max)
      const today = todayKey()
      const selected = validValue(this.data.value, monthOnly)
      const month = monthKey(index)
      const year = Math.floor(index / 12) + 1
      const yearStart = (year - 1) * 12
      const firstYear = Math.floor((year - 1) / YEARS_PER_PAGE) * YEARS_PER_PAGE + 1
      const lastYear = Math.min(9999, firstYear + YEARS_PER_PAGE - 1)
      const periodStart = view === 'years' ? (firstYear - 1) * 12 : view === 'months' ? yearStart : index
      const periodEnd = view === 'years' ? lastYear * 12 - 1 : view === 'months' ? yearStart + 11 : index
      const periods = view === 'months'
        ? Array.from({ length: 12 }, (_, i) => {
          const key = monthKey(yearStart + i)
          return { index: yearStart + i, text: (i + 1) + '月', active: key === selected.slice(0, 7), disabled: !overlaps(yearStart + i, yearStart + i, minMonth, maxMonth) }
        })
        : view === 'years' ? Array.from({ length: lastYear - firstYear + 1 }, (_, i) => {
          const thisYear = firstYear + i
          const start = (thisYear - 1) * 12
          return { index: start, text: thisYear + '年', active: thisYear === year, disabled: !overlaps(start, start + 11, minMonth, maxMonth) }
        }) : []
      this.setData({
        open,
        index,
        view,
        heading: view === 'years' ? firstYear + '–' + lastYear + '年' : year + '年' + (view === 'days' ? ' ' + (index % 12 + 1) + '月' : ''),
        canPrev: periodStart > 0 && periodStart > minMonth,
        canNext: periodEnd < LAST_MONTH && periodEnd < maxMonth,
        quickAllowed: allowed(monthOnly ? today.slice(0, 7) : today, bounds),
        days: view === 'days' ? daysOfMonth(month, today, selected, bounds) : [],
        periods,
      })
    },
    navigate(event) {
      const offset = Number(event.currentTarget.dataset.offset)
      const { index, view, canPrev, canNext } = this.data
      if ((offset === -1 && !canPrev) || (offset === 1 && !canNext) || Math.abs(offset) !== 1) return
      const step = view === 'years' ? YEARS_PER_PAGE * 12 : view === 'months' ? 12 : 1
      this.render(Math.max(0, Math.min(index + offset * step, LAST_MONTH)), view)
    },
    changeView() {
      const { index, view } = this.data
      this.render(index, view === 'months' ? 'years' : 'months')
    },
    selectPeriod(event) {
      const target = Number(event.currentTarget.dataset.index)
      if (!this.data.periods.some(item => item.index === target && !item.disabled)) return
      if (this.data.view === 'years') this.render(target, 'months')
      else if (this.data.fields === 'month') this.commit(monthKey(target))
      else this.render(target, 'days')
    },
    selectDay(event) {
      this.commit(event.currentTarget.dataset.value)
    },
    selectQuick() {
      const now = todayKey()
      this.commit(this.data.fields === 'month' ? now.slice(0, 7) : now)
    },
    commit(value) {
      const normalized = validValue(value, this.data.fields === 'month')
      if (this.data.disabled || !this.data.open || !allowed(normalized, limits(this.data))) return
      this.close()
      if (normalized !== this.data.value) this.triggerEvent('change', { value: normalized })
    },
  },
})
