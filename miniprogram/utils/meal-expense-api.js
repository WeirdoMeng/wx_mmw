const { MEAL_EXPENSE_PREFIX, mealExpenseTransport, uploadMealExpenseProof } = require('./api')
const { openWorkbook } = require('./workbook')

function mealExpenseRequest(path, { method = 'GET', data } = {}) {
  return mealExpenseTransport('request', path, { method, data })
}

function loadMealExpenseProof(url) {
  if (!/^\/api\/v1\/meal-expenses\/photos\/[a-f\d]{32}$/i.test(url)) {
    return Promise.reject(new Error('凭证地址无效。'))
  }
  return mealExpenseTransport('downloadFile', url.slice(MEAL_EXPENSE_PREFIX.length), {})
}

function openMealExpenseWorkbook(path, options) {
  return openWorkbook(mealExpenseTransport, path, '餐食费用', options)
}

module.exports = { mealExpenseRequest, uploadMealExpenseProof, loadMealExpenseProof, openMealExpenseWorkbook }
