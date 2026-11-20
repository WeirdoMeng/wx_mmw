const MAX_PHOTOS = 20
const CAMERA_RESULT = 'photoCaptureResult'

function pick(method, options) {
  return new Promise((resolve, reject) => {
    wx[method]({
      ...options,
      success: resolve,
      fail: (error) => {
        if (/cancel/i.test(error?.errMsg || '')) resolve(null)
        else reject(error)
      },
    })
  })
}

function uniquePaths(paths, limit) {
  return [...new Set(paths.filter(path => typeof path === 'string' && path))].slice(0, limit)
}

async function chooseAlbum(limit) {
  const supportsMedia = typeof wx.chooseMedia === 'function'
  const count = Math.min(limit, 9)
  const options = { count, sourceType: ['album'], sizeType: ['original'] }
  const result = supportsMedia
    ? await pick('chooseMedia', { ...options, mediaType: ['image'] })
    : await pick('chooseImage', options)
  const paths = supportsMedia
    ? (result?.tempFiles || []).map(file => file.tempFilePath)
    : result?.tempFilePaths || []
  return uniquePaths(paths, count)
}

function openCamera(limit) {
  return new Promise((resolve, reject) => {
    wx.navigateTo({
      url: '/pages/camera/index?limit=' + limit,
      events: {
        [CAMERA_RESULT]: (paths) => resolve(uniquePaths(Array.isArray(paths) ? paths : [], limit)),
      },
      fail: reject,
    })
  })
}

async function choosePhotos(count) {
  const limit = Math.min(count, MAX_PHOTOS)
  if (!Number.isInteger(limit) || limit < 1) return []
  const option = await pick('showActionSheet', { itemList: ['连续拍照', '从相册选择'] })
  if (!option) return []
  if (option.tapIndex === 0) return openCamera(limit)
  return option.tapIndex === 1 ? chooseAlbum(limit) : []
}

module.exports = { MAX_PHOTOS, CAMERA_RESULT, choosePhotos }
