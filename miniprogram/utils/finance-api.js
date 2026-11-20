const { FINANCE_PREFIX, financeTransport, uploadFinanceProof } = require('./api')
const { openWorkbook } = require('./workbook')

function financeRequest(path, { method = 'GET', data } = {}) {
  return financeTransport('request', path, { method, data })
}

function loadFinanceProof(url) {
  const photoPath = /^\/api\/v1\/finance\/events\/[^/?#]+\/photos\/[^/?#]+$/
  if (!photoPath.test(url)) return Promise.reject(new Error('凭证地址无效。'))
  return financeTransport('downloadFile', url.slice(FINANCE_PREFIX.length), {})
}

function openFinanceWorkbook(path, options = {}) {
  const { method } = options
  const name = method === 'POST' ? '财务总览' : '学生账单'
  return openWorkbook(financeTransport, path, name, options)
}

module.exports = { financeRequest, uploadFinanceProof, loadFinanceProof, openFinanceWorkbook }
