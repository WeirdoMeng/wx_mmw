const TOKEN = /^[a-zA-Z0-9_-]{12,32}$/
const LOCAL_CODE_PREFIX = 'tuoguan-dev:'

function inviteToken(value) {
  try {
    const token = decodeURIComponent(String(value || ''))
    return TOKEN.test(token) ? token : ''
  } catch (error) {
    return ''
  }
}

function tokenFromScan({ path, result } = {}, allowLocalCode = false) {
  const match = typeof path === 'string' && path.match(/^\/?pages\/index\/index\?(?:[^#]*&)?scene=([^&#]+)(?:&|$)/)
  if (match) return inviteToken(match[1])
  if (allowLocalCode && typeof result === 'string' && result.startsWith(LOCAL_CODE_PREFIX)) {
    return inviteToken(result.slice(LOCAL_CODE_PREFIX.length))
  }
  return ''
}

module.exports = { inviteToken, tokenFromScan }
