const { MAX_PHOTOS, CAMERA_RESULT } = require('../../utils/photo-picker')

const CAPTURE_COOLDOWN = 320
const CAMERA_TIMEOUT = 7000
const REOPEN_DELAY = 240

Page({
  data: {
    limit: MAX_PHOTOS,
    photos: [],
    active: false,
    cameraGeneration: 0,
    ready: false,
    capturing: false,
    closing: false,
    permissionDenied: false,
    error: '',
  },

  onLoad({ limit } = {}) {
    const count = Number(limit)
    this.setData({ limit: Number.isInteger(count) && count > 0 ? Math.min(count, MAX_PHOTOS) : MAX_PHOTOS })
  },

  onShow() {
    this._visible = true
    if (!this.data.active && !this.data.permissionDenied && !this.data.error) this.startCamera()
  },

  onHide() {
    this._visible = false
    this.stopCamera()
  },

  onUnload() {
    this._visible = false
    this.releaseCamera()
    this.getOpenerEventChannel()?.emit(CAMERA_RESULT, this._result || [])
  },

  releaseCamera() {
    clearTimeout(this._capture?.timer)
    clearTimeout(this._reopenTimer)
    this._capture = null
    this._cameraContext = null
    this._reopenTimer = null
    this._nextCaptureAt = 0
  },

  stopCamera({ permissionDenied = this.data.permissionDenied, error = this.data.error } = {}) {
    this.releaseCamera()
    this.setData({ active: false, ready: false, capturing: false, permissionDenied, error })
  },

  startCamera() {
    if (!this._visible || this.data.active || this.data.closing) return
    this.setData({
      active: true, cameraGeneration: this.data.cameraGeneration + 1, ready: false, permissionDenied: false, error: '',
    })
  },

  isCurrentCamera(event) {
    const generation = event?.currentTarget?.dataset?.cameraGeneration
    return this._visible && this.data.active && (generation == null || Number(generation) === this.data.cameraGeneration)
  },

  onCameraReady(event) {
    if (!this.isCurrentCamera(event)) return
    clearTimeout(this._reopenTimer)
    this._reopenTimer = null
    this.setData({ ready: true })
  },

  onCameraError(event) {
    if (this.isCurrentCamera(event)) {
      this.stopCamera({ permissionDenied: true, error: '相机无法打开，请检查微信的相机权限。' })
    }
  },

  onCameraStop(event) {
    if (this.isCurrentCamera(event)) this.stopCamera({ error: '相机已暂停，可重新打开继续拍照。' })
  },

  onOpenSettings() {
    wx.openSetting({
      success: (result) => {
        if (result.authSetting?.['scope.camera'] === true) {
          this.setData({ permissionDenied: false, error: '' })
          this.startCamera()
        }
      },
      fail: () => wx.showToast({ title: '请在微信设置中检查相机权限', icon: 'none' }),
    })
  },

  takePhoto() {
    const { ready, closing, photos, limit } = this.data
    if (!this._visible || !ready || closing || this._capture || Date.now() < this._nextCaptureAt || photos.length >= limit) return
    const capture = { timer: setTimeout(() => this.reopenCamera(capture), CAMERA_TIMEOUT) }
    this._capture = capture
    this.setData({ capturing: true })
    const finish = (path) => {
      if (this._capture !== capture) return
      clearTimeout(capture.timer)
      this._capture = null
      this._nextCaptureAt = Date.now() + CAPTURE_COOLDOWN
      this.setData({
        capturing: false,
        ...(path ? { photos: [...photos, { key: path, path }] } : {}),
      })
      if (!path) wx.showToast({ title: '拍照失败，请重试', icon: 'none' })
    }
    try {
      if (!this._cameraContext) this._cameraContext = wx.createCameraContext()
      this._cameraContext.takePhoto({
        quality: 'high',
        success: (result) => finish(result?.tempImagePath),
        fail: () => finish(),
        complete: () => finish(),
      })
    } catch {
      finish()
    }
  },

  reopenCamera(capture) {
    if (this._capture !== capture) return
    this.stopCamera({ error: '' })
    wx.showToast({ title: '相机超时，正在恢复', icon: 'none' })
    this._reopenTimer = setTimeout(() => {
      this._reopenTimer = null
      this.startCamera()
      if (!this.data.active || this.data.ready) return
      this._reopenTimer = setTimeout(() => {
        this.stopCamera({ error: '相机暂时无法打开，请重试。' })
      }, CAMERA_TIMEOUT)
    }, REOPEN_DELAY)
  },

  removePhoto(event) {
    if (this.data.capturing || this.data.closing) return
    const { index, key } = event.detail
    const photos = this.data.photos
    if (photos[index]?.key === key) this.setData({ photos: photos.filter((_, position) => position !== index) })
  },

  previewPhoto(event) {
    if (this.data.capturing || this.data.closing) return
    const { index, key } = event.detail
    const photos = this.data.photos
    if (photos[index]?.key === key) {
      wx.previewImage({ current: photos[index].path, urls: photos.map(photo => photo.path) })
    }
  },

  usePhotos() {
    if (this.data.capturing || this.data.closing || !this.data.photos.length) return
    this.close(this.data.photos.map(photo => photo.path))
  },

  cancel() {
    if (!this.data.closing) this.close([])
  },

  close(result) {
    this._result = result
    this.setData({ closing: true })
    wx.navigateBack({
      fail: () => {
        this._result = null
        this.setData({ closing: false })
        wx.showToast({ title: '暂时无法返回，请重试', icon: 'none' })
      },
    })
  },
})
