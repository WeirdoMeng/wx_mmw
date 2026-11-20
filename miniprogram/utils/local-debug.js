let connection = null

function isDevelopment() {
  const account = typeof wx.getAccountInfoSync === 'function' && wx.getAccountInfoSync()
  return account?.miniProgram?.envVersion === 'develop'
}

function isPrivateAddress(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false
  const octets = value.split('.').map(Number)
  if (octets.some((octet) => octet > 255) || octets.join('.') !== value) return false
  const [first, second] = octets
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}

function configureLocalDebug(query = {}) {
  if (!isDevelopment()) return false
  const { localApi, localKey } = query || {}
  if (!isPrivateAddress(localApi) || typeof localKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(localKey)) return false
  const origin = `http://${localApi}:3000`
  if (connection?.origin === origin && connection.key === localKey) return false
  connection = { origin, key: localKey }
  return true
}

function localDebugConnection() {
  return isDevelopment() ? connection : null
}

module.exports = { isDevelopment, configureLocalDebug, localDebugConnection }
