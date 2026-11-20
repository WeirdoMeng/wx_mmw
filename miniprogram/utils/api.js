const config = require('../config')
const { isDevelopment, localDebugConnection } = require('./local-debug')

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const PROOF_IMAGE_BYTES = 2 * 1024 * 1024
const FINANCE_PREFIX = '/api/v1/finance'
const MEAL_EXPENSE_PREFIX = '/api/v1/meal-expenses'
const MAX_LOCAL_PREVIEWS = 80
const localPreviewFiles = new Map()
const MEDIA_READERS = {
  getDay: (data) => [...data.assignments.flatMap((entry) => entry.images), ...(data.feedback?.images || [])],
  listPosts: (data) => data.items.flatMap((post) => post.images),
  getPost: (data) => data.post?.images || [],
  getWeeklyMenu: (data) => data.menu?.images || (data.menu?.image ? [data.menu.image] : []),
}
const ORGANIZATION_KEY = 'mmw.organization'
const ORGANIZATION_FREE = new Set([
  'getSession', 'listOrganizations', 'selectOrganization',
  'enrollmentInspect', 'enrollmentSubmit',
])
const ORGANIZATION_MESSAGE = '当前机构已变更，请刷新页面后重试。'

class ServiceError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
    this.status = status
  }
}

const fallbackAuth = { token: '', pendingLogin: null }
let fallbackScope = { id: '', revision: 0 }

function setRequestOrganization(id) {
  if (id !== fallbackScope.id) fallbackScope = { id, revision: fallbackScope.revision + 1 }
  rememberOrganization(id)
}

function rememberOrganization(id) {
  try {
    if (id) wx.setStorageSync(ORGANIZATION_KEY, id)
    else wx.removeStorageSync(ORGANIZATION_KEY)
  } catch {}
}

function currentScope() {
  const app = typeof getApp === 'function' ? getApp() : null
  return typeof app?.getRequestScope === 'function' ? app.getRequestScope() : fallbackScope
}

function organizationHint() {
  const { id } = currentScope()
  if (id) return id
  try {
    const cached = wx.getStorageSync(ORGANIZATION_KEY)
    if (typeof cached === 'string') return cached
  } catch {}
  return ''
}

function apiOrigin() {
  const develop = isDevelopment()
  const localDebug = localDebugConnection()
  if (localDebug) return localDebug.origin
  const devtools = develop && (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform === 'devtools'
  const configured = typeof config.apiOrigin === 'string' ? config.apiOrigin.trim().replace(/\/+$/, '') : ''
  if (devtools && !configured) return 'http://127.0.0.1:3000'
  if (/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(configured)) return configured
  if (devtools && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(configured)) return configured
  if (develop && !devtools && !configured) {
    throw new ServiceError('API_CONFIG', '请让手机和 Mac 连同一 Wi-Fi，再选择「本地真机联调」重新扫码。')
  }
  throw new ServiceError('API_CONFIG', '服务地址尚未配置，请联系托管中心。')
}

function usesLocalApi() {
  try {
    return apiOrigin().startsWith('http://')
  } catch {
    return false
  }
}

function call(method, options) {
  return new Promise((resolve, reject) => {
    wx[method]({ ...options, success: resolve, fail: reject })
  })
}

async function send(method, origin, path, options) {
  let response
  try {
    const connection = { url: origin + path, timeout: 30_000, ...options }
    if (method === 'request') connection.header = { 'Content-Type': 'application/json', ...options.header }
    response = await call(method, connection)
  } catch {
    const upload = method === 'uploadFile'
    throw new ServiceError(
      upload ? 'IMAGE_UPLOAD' : 'API_NETWORK',
      upload ? '图片上传失败，请重试。' : '连接失败，请检查网络后重试。',
    )
  }

  const status = response.statusCode
  let body = response.data
  if (status >= 200 && status < 300) {
    if (method === 'downloadFile' && response.tempFilePath) return response.tempFilePath
    if (options.responseType === 'arraybuffer' && body instanceof ArrayBuffer) return body
  }
  if (body instanceof ArrayBuffer) {
    try {
      body = decodeURIComponent(Array.from(new Uint8Array(body), (byte) => '%' + byte.toString(16).padStart(2, '0')).join(''))
    } catch {
      body = null
    }
  }
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = null
    }
  }
  if (status >= 200 && status < 300 && body?.ok === true) return body.data
  const downloadForbidden = method === 'downloadFile' && status === 403
  const proofForbidden = path.startsWith(MEAL_EXPENSE_PREFIX + '/') ? 'MEAL_EXPENSES_FORBIDDEN' : 'FINANCE_FORBIDDEN'
  const code = body?.error?.code || (status === 401 ? 'UNAUTHENTICATED' : downloadForbidden ? proofForbidden : 'SERVICE')
  const message = code === 'ORG_CHANGED'
    ? ORGANIZATION_MESSAGE
    : body?.error?.message || (downloadForbidden ? '当前账号无法查看本机构的凭证。' : '服务暂时无法完成这次操作，请重试。')
  throw new ServiceError(code, message, status)
}

async function signIn(origin) {
  const localDebug = localDebugConnection()
  let code
  try {
    code = (await call('login', {})).code
  } catch {
    throw new ServiceError('WX_LOGIN', '无法确认当前微信账号，请重试。')
  }
  if (!code) throw new ServiceError('WX_LOGIN', '未获取到微信登录凭证，请重试。')

  const data = { code }
  const organizationId = organizationHint()
  if (organizationId) data.organizationId = organizationId
  const header = localDebug?.origin === origin ? { 'X-Tuoguan-Dev-Key': localDebug.key } : undefined
  const result = await send('request', origin, '/api/v1/session', { method: 'POST', data, header })
  if (!result || typeof result.token !== 'string' || !result.token) {
    throw new ServiceError('AUTH_RESPONSE', '登录服务未返回有效凭证，请重试。')
  }
  return result.token
}

function authToken(origin, expiredToken) {
  const app = typeof getApp === 'function' ? getApp() : null
  const auth = typeof app?.getRequestAuth === 'function' ? app.getRequestAuth() : fallbackAuth
  if (auth.token && auth.token !== expiredToken) return Promise.resolve(auth.token)
  if (!auth.pendingLogin) {
    auth.token = ''
    auth.pendingLogin = signIn(origin)
      .then((token) => { auth.token = token; return token })
      .finally(() => { auth.pendingLogin = null })
  }
  return auth.pendingLogin
}

function assertScope(expected) {
  if (!expected) return
  const current = currentScope()
  if (!expected.id || expected.id !== current.id || expected.revision !== current.revision) {
    throw new ServiceError('ORG_CHANGED', ORGANIZATION_MESSAGE)
  }
}

async function authenticated(method, path, options, expected) {
  const origin = apiOrigin()
  const sendWithToken = async (credential) => {
    assertScope(expected)
    const header = { Authorization: 'Bearer ' + credential }
    if (expected) header['X-Organization-Id'] = expected.id
    const data = await send(method, origin, path, { ...options, header })
    assertScope(expected)
    return data
  }
  const credential = await authToken(origin)
  try {
    return await sendWithToken(credential)
  } catch (error) {
    if (error.status !== 401 && error.code !== 'UNAUTHENTICATED') throw error
    assertScope(expected)
    return sendWithToken(await authToken(origin, credential))
  }
}

function toolIconPhotos(data, selection) {
  if (!Array.isArray(data?.categories)) return []
  return data.categories.filter(category => !selection.categoryId || category?.id === selection.categoryId)
    .flatMap(category => Array.isArray(category?.tools) ? category.tools : [])
    .filter(tool => typeof tool?.iconUrl === 'string' && tool.iconUrl && (!selection.key || tool.key === selection.key))
    .map(tool => ({ id: tool.iconId || tool.iconUrl, url: tool.iconUrl, tool }))
}

function request(action, payload = {}, { feedbackPhotosOnly = false, toolIconPreviews = false } = {}) {
  const expected = ORGANIZATION_FREE.has(action) ? null : currentScope()
  const response = authenticated('request', '/api/v1/actions', {
    method: 'POST',
    data: { ...payload, action },
  }, expected)
  const readPhotos = action === 'listTools' && toolIconPreviews
    ? data => toolIconPhotos(data, toolIconPreviews)
    : MEDIA_READERS[action]
  if (!readPhotos || !usesLocalApi()) return response
  const mediaOrigin = apiOrigin() + '/api/v1/media/'
  return response.then(async (data) => {
    const photos = action === 'getDay' && feedbackPhotosOnly ? data.feedback?.images || [] : readPhotos(data)
    for (let offset = 0; offset < photos.length; offset += 4) {
      assertScope(expected)
      await Promise.all(photos.slice(offset, offset + 4).map((photo) => downloadLocalPhoto(photo, mediaOrigin)))
    }
    assertScope(expected)
    if (action === 'getWeeklyMenu' && data.menu) data.menu.image = photos[0] || null
    if (action === 'listTools') {
      for (const photo of photos) photo.tool.iconUrl = photo.url
    }
    return data
  })
}

async function downloadLocalPhoto(photo, mediaOrigin) {
  if (!photo?.url?.startsWith(mediaOrigin)) return
  const key = mediaOrigin + photo.id
  const cached = localPreviewFiles.get(key)
  if (cached) {
    try {
      if (await sizeOf(cached) > 0) {
        photo.url = cached
        return
      }
    } catch {}
    localPreviewFiles.delete(key)
  }
  try {
    const file = await call('downloadFile', { url: photo.url, timeout: 8_000 })
    if (file.statusCode !== 200 || !file.tempFilePath) throw new Error()
    photo.url = file.tempFilePath
    localPreviewFiles.set(key, photo.url)
    if (localPreviewFiles.size > MAX_LOCAL_PREVIEWS) localPreviewFiles.delete(localPreviewFiles.keys().next().value)
  } catch {
    photo.url = ''
    photo.failed = true
  }
}

function sizeOf(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().stat({
      path: filePath,
      success: (result) => resolve(result.stats.size),
      fail: reject,
    })
  })
}

async function compressImageForUpload(path, maxBytes = MAX_IMAGE_BYTES) {
  let filePath
  try {
    const { width, height } = await call('getImageInfo', { src: path })
    const longestSide = width >= height ? 'compressedWidth' : 'compressedHeight'
    const length = Math.max(width, height)
    const compress = async (quality, maximum) => {
      const result = await call('compressImage', { src: path, quality, [longestSide]: Math.min(length, maximum) })
      return result.tempFilePath
    }
    filePath = await compress(82, 1920)
    let size = await sizeOf(filePath)
    if (size > maxBytes) {
      filePath = await compress(68, 1280)
      size = await sizeOf(filePath)
    }
    if (size > maxBytes) {
      throw new ServiceError('IMAGE_TOO_LARGE', '压缩后仍超过 ' + (maxBytes / (1024 * 1024)) + ' MB，请选择较小的图片。')
    }
    await call('getImageInfo', { src: filePath })
  } catch (error) {
    if (error instanceof ServiceError) throw error
    throw new ServiceError('IMAGE_READ', '这张图片无法读取或压缩，请重新选择。')
  }
  return filePath
}

async function uploadImages(paths) {
  const expected = currentScope()
  const uploaded = []
  for (const path of paths) {
    const filePath = await compressImageForUpload(path)
    assertScope(expected)
    uploaded.push(await authenticated('uploadFile', '/api/v1/media', { filePath, name: 'file' }, expected))
  }
  return uploaded
}

function financeTransport(method, path, options) {
  return authenticated(method, FINANCE_PREFIX + path, options, currentScope())
}

function mealExpenseTransport(method, path, options) {
  return authenticated(method, MEAL_EXPENSE_PREFIX + path, options, currentScope())
}

function renderToolPdfPage({ bytes, toolKey, categoryId }, page) {
  const buffer = bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const pdfBase64 = wx.arrayBufferToBase64(buffer)
  return authenticated('request', '/api/v1/tools/pdf-preview', {
    method: 'POST',
    data: { pdfBase64, toolKey, categoryId, page },
  }, currentScope())
}

async function uploadProof(endpoint, path) {
  const expected = currentScope()
  const filePath = await compressImageForUpload(path, PROOF_IMAGE_BYTES)
  return authenticated('uploadFile', endpoint, { filePath, name: 'file' }, expected)
}

function uploadFinanceProof(billId, path) {
  return uploadProof(FINANCE_PREFIX + '/bills/' + encodeURIComponent(billId) + '/proofs', path)
}

function uploadMealExpenseProof(path) {
  return uploadProof(MEAL_EXPENSE_PREFIX + '/photos', path)
}

module.exports = { request, uploadImages, setRequestOrganization, rememberOrganization, usesLocalApi, ServiceError, renderToolPdfPage,
  FINANCE_PREFIX, financeTransport, uploadFinanceProof, MEAL_EXPENSE_PREFIX, mealExpenseTransport, uploadMealExpenseProof }
