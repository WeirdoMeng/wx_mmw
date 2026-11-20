const { calendarDays, parseDate, todayKey } = require('../../components/mmw-calendar/date')

const DISHES = [
  { key: 'meat', label: '荤菜' },
  { key: 'vegetable', label: '素菜' },
  { key: 'soup', label: '汤菜' }
]
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五']
const MAX_DISH_LENGTH = 200

function shortDate(date) {
  return (date.getMonth() + 1) + '月' + date.getDate() + '日'
}

function describeWeek(value = todayKey()) {
  if (!parseDate(value)) return null
  const days = calendarDays(value, false).slice(0, 5).map(({ key }, index) => {
    const date = parseDate(key)
    return { key, label: WEEKDAYS[index], shortDate: (date.getMonth() + 1) + '/' + date.getDate() }
  })
  const first = parseDate(days[0].key)
  const last = parseDate(days[4].key)
  const endYear = first.getFullYear() === last.getFullYear() ? '' : last.getFullYear() + '年'
  return {
    start: days[0].key,
    label: first.getFullYear() + '年' + shortDate(first) + '–' + endYear + shortDate(last),
    days
  }
}

function menuDays(menu) {
  return WEEKDAYS.map((_, index) => {
    const day = menu?.days?.[index]
    return { meat: day?.meat || '', vegetable: day?.vegetable || '', soup: day?.soup || '' }
  })
}

function menuImages(menu) {
  if (Array.isArray(menu?.images)) return menu.images
  return menu?.image ? [menu.image] : []
}

function canEditMenu(role) {
  return role === 'teacher'
}

module.exports = { DISHES, MAX_DISH_LENGTH, describeWeek, menuDays, menuImages, canEditMenu }
