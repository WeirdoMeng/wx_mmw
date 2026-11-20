const {WEEKDAYS, parseDate, todayKey, moveDate, calendarDays} = require('./date')

Component({
  properties: {
    value: {type: String, value: ''},
    markedDates: {type: Array, value: []},
    feedbackDates: {type: Array, value: []},
    disabled: {type: Boolean, value: false},
  },
  data: {
    expanded: false,
    weekdays: WEEKDAYS,
    year: 0,
    month: 0,
    days: [],
  },
  observers: {
    'value, markedDates, feedbackDates'(value) {
      this.renderCalendar(value, this.data.expanded)
    },
  },
  lifetimes: {
    attached() {
      this.renderCalendar(this.data.value, this.data.expanded)
    },
  },
  methods: {
    renderCalendar(value, expanded) {
      const date = parseDate(value) || parseDate(todayKey())
      const selected = parseDate(value) ? value : todayKey()
      const marked = new Set(this.data.markedDates)
      const feedback = new Set(this.data.feedbackDates)
      this.setData({
        expanded,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        days: calendarDays(selected, expanded).map((day) => ({
          ...day,
          mark: feedback.has(day.key) ? 'feedback' : marked.has(day.key) ? 'assignment' : '',
        })),
      })
    },
    choose(day) {
      if (!this.data.disabled && day && day !== this.data.value) {
        this.triggerEvent('change', {date: day})
      }
    },
    selectDay(event) {
      this.choose(event.currentTarget.dataset.date)
    },
    selectToday() {
      this.choose(todayKey())
    },
    shift(event) {
      this.choose(moveDate(this.data.value, Number(event.currentTarget.dataset.offset), this.data.expanded))
    },
    toggle() {
      if (!this.data.disabled) this.renderCalendar(this.data.value, !this.data.expanded)
    },
  },
})
