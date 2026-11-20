const { parseDate } = require('../../components/mmw-calendar/date')

const PAGE_SIZE = 15
const PROOF_LIMIT = 5
const BILL_STATUSES = { unpaid: '待缴费', partial: '部分缴费', paid: '已结清' }
const PAYMENT_METHODS = { wechat: '微信', alipay: '支付宝', bank: '银行转账', cash: '现金', other: '其他' }
const EVENT_LABELS = { created: '创建账单', adjustment: '调整应收', payment: '收款', refund: '退款', reversal: '撤销登记', removed: '移除学生', restored: '恢复账单' }
const METRICS = [['count', '建账'], ['due', '应收'], ['paid', '收款'], ['refunded', '退款'], ['net', '净实收'], ['balance', '未收']]

function decimal(cents) {
  if (!Number.isSafeInteger(cents)) return ''
  const absolute = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

function money(cents) {
  return '¥' + (decimal(cents) || '0.00').replace(/\B(?=(\d{3})+\.)/g, ',')
}

function cents(value, label, nonzero = false) {
  const input = String(value ?? '').trim()
  if (!/^\d{1,14}(?:\.\d{1,2})?$/.test(input)) throw new Error(`请填写有效的${label}，最多两位小数。`)
  const [whole, fractional = ''] = input.split('.')
  const amount = Number(whole) * 100 + Number(fractional.padEnd(2, '0'))
  if (!Number.isSafeInteger(amount) || (nonzero && amount === 0)) throw new Error(`${label}超出有效范围。`)
  return amount
}

function today() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function stageForm(stage = {}) {
  return { name: stage.name || '', startDate: stage.startDate || '', endDate: stage.endDate || '', referenceAmount: decimal(stage.referenceAmount) }
}

function stageDateError(startDate, endDate) {
  if (startDate && !parseDate(startDate)) return '请选择有效的开始日期。'
  if (endDate && !parseDate(endDate)) return '请选择有效的结束日期。'
  if (startDate && endDate && startDate > endDate) return '结束日期不能早于开始日期。'
  return ''
}

function stageInput(form) {
  const { startDate, endDate, referenceAmount } = form
  const name = form.name.trim()
  if (!name) throw new Error('请填写收费阶段名称。')
  const dateError = stageDateError(startDate, endDate)
  if (dateError) throw new Error(dateError)
  return { name, startDate: startDate || null, endDate: endDate || null, referenceAmount: referenceAmount.trim() ? cents(referenceAmount, '参考价') : null }
}

function stageView(stage) {
  return { ...stage, range: [stage.startDate, stage.endDate].filter(Boolean).join(' 至 ') }
}

function totalsView(totals, people = '人') {
  return METRICS.map(([key, label]) => ({ key, label, value: key === 'count' ? `${totals.count ?? 0} ${people}` : money(totals[key]) }))
}

function billView(bill) {
  return { ...bill, initial: Array.from(bill.studentName || '学生')[0],
    meta: [bill.school, bill.grade].filter(Boolean).join(' · '), statusLabel: bill.removed ? '已移除' : BILL_STATUSES[bill.status],
    figures: totalsView(bill).filter(item => ['due', 'net', 'balance'].includes(item.key)) }
}

function percentage(value, total) {
  return total > 0 ? `${(value / total * 100).toFixed(1).replace(/\.0$/, '')}%` : '—'
}

function barWidth(value, total) {
  return total > 0 ? Math.max(0, Math.min(100, value / total * 100)) : 0
}

function summaryView(totals, people = '人') {
  const metrics = Object.fromEntries(totalsView(totals, people).map(metric => [metric.key, metric]))
  return {
    net: money(totals.net), rate: percentage(totals.net, totals.due),
    netWidth: barWidth(totals.net, totals.due), balanceWidth: barWidth(totals.balance, totals.due),
    facts: [metrics.due, metrics.balance, metrics.count],
    activity: [metrics.paid, metrics.refunded],
  }
}

function overviewView({ items, totals }) {
  const ceiling = { due: 0, count: 0, refunded: 0 }
  for (const item of items) {
    for (const key of Object.keys(ceiling)) ceiling[key] = Math.max(ceiling[key], item.totals[key])
  }
  const composition = items.map(({ stage, totals }) => ({
    id: stage.id, name: stage.name, due: money(totals.due), net: money(totals.net), balance: money(totals.balance),
    netWidth: barWidth(totals.net, ceiling.due), balanceWidth: barWidth(totals.balance, ceiling.due),
  }))
  const comparisons = [{ key: 'count', title: '建账人数' }, { key: 'rate', title: '收款率' }, { key: 'refunded', title: '退款金额' }]
  for (const chart of comparisons) {
    chart.rows = items.map(({ stage, totals }) => {
      const { key } = chart
      if (key === 'rate') return { id: stage.id, name: stage.name, value: percentage(totals.net, totals.due), width: barWidth(totals.net, totals.due) }
      const value = totals[key]
      return { id: stage.id, name: stage.name, value: key === 'count' ? `${value} 人` : money(value), width: barWidth(value, ceiling[key]) }
    })
  }
  return {
    summary: summaryView(totals, '人次'), charts: { composition, comparisons },
    stages: items.map(({ stage, totals }) => ({
      ...stageView(stage), rate: percentage(totals.net, totals.due), metrics: totalsView(totals),
    })),
  }
}

function eventView(event) {
  const label = EVENT_LABELS[event.type] || '账单记录'
  const reversal = event.type === 'reversal'
  const target = EVENT_LABELS[event.targetType] || ''
  const reversed = event.reversed || Boolean(event.reversedBy)
  const before = event.beforeDue ?? event.previousDue
  const after = event.afterDue ?? event.newDue
  const amount = Number.isSafeInteger(event.amount) ? money(event.type === 'refund' || (reversal && event.targetType === 'payment') ? -event.amount : event.amount) : ''
  return {
    ...event, label: reversal ? (target ? '撤销' + target + '登记' : label) : label, reversed, amountLabel: amount,
    reversible: ['payment', 'refund'].includes(event.type) && !reversed,
    meta: [event.date, PAYMENT_METHODS[event.method], event.username && `登记人 ${event.username}`].filter(Boolean).join(' · '),
    discountLabel: event.discount > 0 ? `${reversal ? '撤销优惠' : '优惠'} ${money(event.discount)}` : '',
    dueLabel: (event.type === 'adjustment' || event.discount > 0) && Number.isSafeInteger(before) && Number.isSafeInteger(after)
      ? `应收 ${money(before)} → ${money(after)}` : '', photos: event.photos || [],
  }
}

function paymentPreview(value, balance, fullPayment) {
  if (!value) return `当前待收 ${money(balance)}`
  try {
    const amount = cents(value, '收款金额', true)
    if (amount > balance) return `收款金额不能超过当前待收 ${money(balance)}`
    if (amount === balance) return `实收 ${money(amount)}，账单将结清`
    return fullPayment ? `实收 ${money(amount)}，优惠 ${money(balance - amount)}，账单将结清`
      : `实收 ${money(amount)}，仍待收 ${money(balance - amount)}`
  } catch (error) {
    return error.message
  }
}

function financeEventInput(form, bill, target) {
  const { type, date, fullPayment } = form
  const note = form.note.trim()
  if (!parseDate(date)) throw new Error('请选择有效的登记日期。')
  if (type === 'reversal') {
    if (!target?.reversible) throw new Error('这笔登记无法撤销。')
    if (!note) throw new Error('请填写撤销原因。')
    return { type, date, note, targetId: target.id }
  }
  const payment = type === 'payment'
  const amount = cents(form.amount, payment ? '收款金额' : '退款金额', true)
  const maximum = payment ? bill.balance : bill.net
  if (amount > maximum) throw new Error(`${payment ? '收款金额不能超过待收' : '退款金额不能超过净实收'} ${money(maximum)}。`)
  return { type, amount, date, note, method: Object.keys(PAYMENT_METHODS)[form.methodIndex],
    ...(payment ? { fullPayment, expectedBalance: bill.balance } : {}) }
}

function query(path, fields = {}) {
  const parameters = Object.entries(fields).filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  return parameters.length ? `${path}?${parameters.join('&')}` : path
}

function listState() { return { items: [], page: 0, hasMore: false, loading: false, error: '' } }

module.exports = { PAGE_SIZE, PROOF_LIMIT, BILL_STATUSES, PAYMENT_METHODS, EVENT_LABELS, decimal, money, cents, today, stageForm,
  stageDateError, stageInput, stageView, billView, summaryView, overviewView, eventView, paymentPreview, financeEventInput, query, listState }
