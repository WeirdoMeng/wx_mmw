const { request } = require('../../utils/api')
const { todayKey } = require('../../components/mmw-calendar/date')
const { isToolKey, toolPresentation } = require('../../utils/tool-registry')

const UNITS = [
  { label: '长度', units: [{ name: '米（m）', rate: 1 }, { name: '千米（km）', rate: 1000 }, { name: '厘米（cm）', rate: .01 }, { name: '毫米（mm）', rate: .001 }] },
  { label: '质量', units: [{ name: '千克（kg）', rate: 1 }, { name: '克（g）', rate: .001 }, { name: '毫克（mg）', rate: .000001 }, { name: '吨（t）', rate: 1000 }] },
  { label: '容量', units: [{ name: '升（L）', rate: 1 }, { name: '毫升（mL）', rate: .001 }, { name: '立方米（m³）', rate: 1000 }] },
]
const SECONDS = 1000
const DAY = 24 * 60 * 60 * SECONDS

function timerLabel(seconds) {
  return [Math.floor(seconds / 60), seconds % 60].map(part => String(part).padStart(2, '0')).join(':')
}

function imageSize(size) {
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  return (size / (1024 * 1024)).toFixed(2) + ' MB'
}

function dayTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : NaN
}

function invoke(method, options) {
  return new Promise((resolve, reject) => wx[method]({ ...options, success: resolve, fail: reject }))
}

function fileSize(path) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().stat({
    path,
    success: result => resolve(result.stats.size),
    fail: reject,
  }))
}

Page({
  data: {
    key: '', tool: null, authorized: false, loading: true, error: '', retry: false,
    minutes: 25, durations: [5, 15, 25, 45], seconds: 1500, timerText: '25:00', running: false,
    unitTypes: UNITS.map(item => item.label), unitType: 0, unitOptions: UNITS[0].units, from: 0, to: 2, amount: '', conversion: '',
    startDate: '', endDate: '', days: 0,
    quality: 75, photo: null, result: null, working: false, imageError: '',
  },

  onLoad(options = {}) {
    const key = isToolKey(options.key) ? options.key : ''
    this._expectedOrganization = typeof options.org === 'string' ? options.org : ''
    this._categoryId = typeof options.categoryId === 'string' ? options.categoryId : ''
    const today = todayKey()
    this._sequence = 0
    this.setData({ key, startDate: today, endDate: today })
  },

  onShow() {
    this._visible = true
    return this.checkAccess()
  },

  onHide() {
    this._visible = false
    this.stopTicker()
  },

  onUnload() {
    this._closed = true
    this.onHide()
  },

  async checkAccess() {
    const sequence = ++this._sequence
    const isLatest = () => !this._closed && sequence === this._sequence
    const app = getApp()
    if (!this.current()) this.setData({ authorized: false, loading: true, error: '', retry: false, working: false })
    try {
      const session = await app.ensureSession({ refresh: true })
      if (!isLatest()) return
      const organizationId = session?.organization?.id
      if (!this.data.key || !organizationId || session?.toolsEnabled !== true ||
          (this._expectedOrganization && organizationId !== this._expectedOrganization) ||
          !['parent', 'teacher'].includes(session.role)) {
        return this.unavailable()
      }
      const scope = app.getRequestScope()
      const { enabled, categories } = await request('listTools', {}, {
        toolIconPreviews: { key: this.data.key, categoryId: this._categoryId },
      })
      if (!isLatest()) return
      const current = app.getRequestScope()
      if (scope.id !== current.id || scope.revision !== current.revision || !enabled || !Array.isArray(categories)) {
        return this.unavailable()
      }
      const category = categories.find(item => (!this._categoryId || item.id === this._categoryId)
        && item.tools?.some(tool => tool.key === this.data.key))
      const match = category?.tools.find(tool => tool.key === this.data.key)
      if (!match) return this.unavailable()
      const tool = toolPresentation(match)
      if (!tool.name) return this.unavailable()
      if (!this.current()) this._scope = scope
      this._role = session.role
      this.setData({ authorized: true, loading: false, error: '', retry: false, tool, categoryId: category.id })
      if (this._visible && this.data.running) this.startTicker()
    } catch (error) {
      if (!isLatest()) return
      if (['NOT_BOUND', 'ORG_CHANGED', 'FORBIDDEN', 'TOOLS_FORBIDDEN', 'UNAUTHENTICATED'].includes(error.code)) {
        return this.unavailable()
      }
      this.stopTicker()
      this.setData({ authorized: false, loading: false, retry: true, working: false, error: error.message || '暂时无法打开工具。' })
    }
  },

  onIconError(event) {
    const { iconUrl } = event.currentTarget.dataset
    if (iconUrl && this.data.tool?.iconUrl === iconUrl) this.setData({ 'tool.iconUrl': '' })
  },

  current(scope = this._scope) {
    if (this._closed || !this.data.authorized || !scope || this._scope !== scope) return false
    const app = getApp()
    const active = app.getRequestScope()
    const session = app.globalData.session
    return active.id === scope.id && active.revision === scope.revision && session?.role === this._role
      && session.toolsEnabled === true
  },

  unavailable() {
    this._scope = null
    this._deadline = 0
    this.stopTicker()
    this.setData({ authorized: false, loading: false, retry: false, running: false, working: false, tool: null,
      seconds: this.data.minutes * 60, timerText: timerLabel(this.data.minutes * 60), photo: null, result: null,
      error: '这个工具当前不可用。' })
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: getApp().globalData.session?.toolsEnabled ? '/pages/tools/index' : '/pages/home/index' }),
    })
  },

  onDuration(event) {
    const minutes = Number(event.currentTarget.dataset.minutes)
    if (!this.current() || this.data.running || !this.data.durations.includes(minutes)) return
    this._deadline = 0
    const seconds = minutes * 60
    this.setData({ minutes, seconds, timerText: timerLabel(seconds) })
  },

  onTimerToggle() {
    if (!this.current()) return
    if (this.data.running) {
      this.syncTimer()
      this.stopTicker()
      this._deadline = 0
      this.setData({ running: false })
      return
    }
    const seconds = this.data.seconds || this.data.minutes * 60
    this._deadline = Date.now() + seconds * SECONDS
    this.setData({ running: true, seconds, timerText: timerLabel(seconds) })
    this.startTicker()
  },

  onTimerReset() {
    if (!this.current()) return
    this.stopTicker()
    this._deadline = 0
    const seconds = this.data.minutes * 60
    this.setData({ running: false, seconds, timerText: timerLabel(seconds) })
  },

  startTicker() {
    this.stopTicker()
    this.syncTimer()
    if (this._deadline) this._ticker = setInterval(() => this.syncTimer(), 250)
  },

  stopTicker() {
    clearInterval(this._ticker)
    this._ticker = null
  },

  syncTimer() {
    if (!this.current() || !this._deadline) return
    const seconds = Math.max(0, Math.ceil((this._deadline - Date.now()) / SECONDS))
    if (seconds !== this.data.seconds) this.setData({ seconds, timerText: timerLabel(seconds) })
    if (seconds > 0) return
    this.stopTicker()
    this._deadline = 0
    this.setData({ running: false })
    wx.showToast({ title: '计时结束', icon: 'none' })
  },

  updateConversion(patch) {
    if (!this.current()) return
    const { unitType, from, to, amount } = { ...this.data, ...patch }
    const options = UNITS[unitType].units
    const quantity = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(amount) ? Number(amount) : NaN
    const result = quantity * options[from].rate / options[to].rate
    this.setData({ ...patch, conversion: Number.isFinite(result) ? String(Number(result.toPrecision(10))) : '' })
  },

  onUnitType(event) {
    const unitType = Number(event.detail.value)
    if (!Number.isInteger(unitType) || !UNITS[unitType]) return
    this.updateConversion({ unitType, unitOptions: UNITS[unitType].units, from: 0, to: 1 })
  },

  onUnit(event) {
    const field = event.currentTarget.dataset.field
    const value = Number(event.detail.value)
    if (['from', 'to'].includes(field) && Number.isInteger(value) && this.data.unitOptions[value]) {
      this.updateConversion({ [field]: value })
    }
  },

  onAmount(event) { this.updateConversion({ amount: event.detail.value.trim() }) },
  onSwapUnits() { this.updateConversion({ from: this.data.to, to: this.data.from }) },

  onDate(event) {
    if (!this.current()) return
    const { field } = event.currentTarget.dataset
    if (!['startDate', 'endDate'].includes(field) || !Number.isFinite(dayTimestamp(event.detail.value))) return
    const patch = { [field]: event.detail.value }
    const { startDate, endDate } = { ...this.data, ...patch }
    if (startDate > endDate) return
    const days = (dayTimestamp(endDate) - dayTimestamp(startDate)) / DAY
    this.setData({ ...patch, days })
  },

  async onPickImage() {
    if (!this.current() || this.data.working) return
    const scope = this._scope
    this.setData({ working: true, imageError: '' })
    try {
      const options = { count: 1, sizeType: ['original'], sourceType: ['album'] }
      const media = typeof wx.chooseMedia === 'function'
      const picked = await invoke(media ? 'chooseMedia' : 'chooseImage', media ? { ...options, mediaType: ['image'] } : options)
      const path = media ? picked.tempFiles?.[0]?.tempFilePath : picked.tempFilePaths?.[0]
      if (!path || !this.current(scope)) return
      const size = await fileSize(path)
      if (this.current(scope)) this.setData({ photo: { path, size, label: imageSize(size) }, result: null })
    } catch (error) {
      if (this.current(scope) && !/cancel/i.test(error?.errMsg || '')) {
        this.setData({ imageError: '无法读取图片，请重新选择。' })
      }
    } finally {
      if (this.current(scope)) this.setData({ working: false })
    }
  },

  onQuality(event) {
    const quality = Number(event.currentTarget.dataset.quality)
    if (!this.current() || this.data.working || ![75, 50].includes(quality) || quality === this.data.quality) return
    this.setData({ quality, result: null, imageError: '' })
  },

  async onCompress() {
    const { photo, quality, working } = this.data
    if (!this.current() || !photo || working) return
    const scope = this._scope
    this.setData({ working: true, imageError: '' })
    try {
      const { tempFilePath } = await invoke('compressImage', { src: photo.path, quality })
      const size = await fileSize(tempFilePath)
      if (!this.current(scope)) return
      const smaller = size < photo.size
      this.setData({ result: { path: smaller ? tempFilePath : photo.path, label: smaller ? imageSize(size) : photo.label,
        savingPercent: smaller ? Number(((1 - size / photo.size) * 100).toFixed(1)) : 0, smaller } })
    } catch {
      if (this.current(scope)) this.setData({ imageError: '压缩失败，请尝试另一张图片。' })
    } finally {
      if (this.current(scope)) this.setData({ working: false })
    }
  },

  onPreviewImage() {
    const path = this.data.result?.path || this.data.photo?.path
    if (this.current() && path) wx.previewImage({ current: path, urls: [path] })
  },

  async onSaveImage() {
    const path = this.data.result?.path
    if (!this.current() || !path || this.data.working) return
    const scope = this._scope
    this.setData({ working: true, imageError: '' })
    try {
      await invoke('saveImageToPhotosAlbum', { filePath: path })
      if (this.current(scope)) wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (error) {
      if (this.current(scope) && !/cancel/i.test(error?.errMsg || '')) {
        this.setData({ imageError: '保存失败，请确认微信已获得相册权限。' })
      }
    } finally {
      if (this.current(scope)) this.setData({ working: false })
    }
  },
})
