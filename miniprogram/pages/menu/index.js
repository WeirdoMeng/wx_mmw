const { request, uploadImages } = require('../../utils/api')
const { MAX_PHOTOS, choosePhotos } = require('../../utils/photo-picker')
const { DISHES, MAX_DISH_LENGTH, describeWeek, menuDays, menuImages, canEditMenu } = require('./week')

const ACCESS_ERRORS = ['NOT_BOUND', 'FORBIDDEN', 'ORG_CHANGED']
const CHANGED_ORGANIZATION = '当前机构已变更，请返回托管动态后重新打开。'

Page({
  data: {
    week: null,
    dayIndex: 0,
    dishes: DISHES,
    maxDishLength: MAX_DISH_LENGTH,
    days: menuDays(null),
    photos: [],
    maxPhotos: MAX_PHOTOS,
    authorized: false,
    loading: true,
    loaded: false,
    baseError: '',
    saveError: '',
    conflict: false,
    saving: false
  },

  onLoad(options = {}) {
    this._active = true
    this._organizationId = options.org
    const week = describeWeek(options.weekStart || '')
    if (week?.start === options.weekStart && this._organizationId) this.setData({ week })
  },

  async onShow() {
    const stamp = (this._showId || 0) + 1
    this._showId = stamp
    this.setData({ authorized: false, loading: true, baseError: '' })
    if (!this.data.week) {
      this.setData({ loading: false, baseError: '请从托管动态选择要编辑的一周。' })
      return
    }

    try {
      const app = getApp()
      const session = await app.ensureSession({ refresh: true })
      if (!this._active || this._showId !== stamp) return
      if (session.role === 'guest' || !session.organization) {
        this.denyAccess('NOT_BOUND')
        return
      }
      if (session.organization.id !== this._organizationId || (this._scope && !this.hasCurrentScope(this._scope))) {
        this.denyAccess('ORG_CHANGED', CHANGED_ORGANIZATION)
        return
      }
      if (!canEditMenu(session.role)) {
        this.denyAccess('FORBIDDEN', '只有本机构的老师可以编辑菜谱。')
        return
      }
      this._scope = app.getRequestScope()
      this.setData({ authorized: true, loading: Boolean(this._loadRequest) || !this.data.loaded })
      if (!this.data.loaded && !this._loadRequest) await this.loadMenu()
    } catch (error) {
      if (!this._active || this._showId !== stamp) return
      if (ACCESS_ERRORS.includes(error.code)) this.denyAccess(error.code, error.message)
      else this.setData({ loading: false, baseError: error.message })
    }
  },

  onUnload() {
    this._active = false
    this._loadRequest = null
  },

  hasCurrentScope(expected) {
    if (!this._active || !expected) return false
    const current = getApp().getRequestScope()
    return expected.id === current.id && expected.revision === current.revision
  },

  denyAccess(code, message) {
    this._loadRequest = null
    this.setData({
      authorized: false,
      loaded: false,
      loading: false,
      baseError: message || '无法查看当前机构的菜谱。',
      days: menuDays(null),
      photos: [],
      saving: false,
      conflict: false,
      saveError: ''
    })
    if (code === 'NOT_BOUND') {
      getApp().setSession(null)
      wx.reLaunch({ url: '/pages/index/index' })
    }
  },

  async loadMenu() {
    if (!this.data.authorized || this.data.saving) return
    const scope = this._scope
    const pending = {}
    this._loadRequest = pending
    this.setData({ loading: true, baseError: '', saveError: '' })
    try {
      const { menu } = await request('getWeeklyMenu', { weekStart: this.data.week.start })
      if (this._loadRequest !== pending) return
      if (!this.hasCurrentScope(scope)) {
        this.denyAccess('ORG_CHANGED', CHANGED_ORGANIZATION)
        return
      }
      this._revision = menu?.revision ?? 0
      this.setData({
        days: menuDays(menu),
        photos: menuImages(menu),
        loaded: true,
        conflict: false
      })
    } catch (error) {
      if (this._loadRequest !== pending) return
      if (ACCESS_ERRORS.includes(error.code)) this.denyAccess(error.code, error.message)
      else this.setData(this.data.loaded ? { saveError: error.message } : { baseError: error.message })
    } finally {
      if (this._loadRequest === pending) {
        this._loadRequest = null
        this.setData({ loading: false })
      }
    }
  },

  onRetry() {
    if (this.data.authorized) this.loadMenu()
    else this.onShow()
  },

  onSelectDay(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!this.data.saving && this.data.week?.days[index]) this.setData({ dayIndex: index })
  },

  onDishInput(event) {
    const { field } = event.currentTarget.dataset
    if (this.data.saving || !DISHES.some((dish) => dish.key === field)) return
    this.setData({ ['days[' + this.data.dayIndex + '].' + field]: event.detail.value })
  },

  async onChooseImage() {
    if (!this.data.authorized || this.data.saving || this._choosing) return
    const remaining = MAX_PHOTOS - this.data.photos.length
    if (remaining <= 0) return
    const scope = this._scope
    this._choosing = true
    try {
      const paths = await choosePhotos(remaining)
      if (!paths.length || !this.hasCurrentScope(scope)) return
      const photos = this.data.photos
      const added = paths.map((path) => ({ path, key: 'file:' + path }))
      const unique = new Map([...photos, ...added].map((photo) => [photo.key || photo.id, photo]))
      this.setData({ photos: [...unique.values()].slice(0, MAX_PHOTOS), saveError: '' })
    } catch (error) {
      if (this.hasCurrentScope(scope)) wx.showToast({ title: error?.message || '无法打开照片', icon: 'none' })
    } finally {
      this._choosing = false
    }
  },

  async onPreviewImage(event) {
    const { index, key } = event.detail
    let image = this.data.photos[index]
    const scope = this._scope
    if (!image || (image.key || image.id) !== key || !this.data.authorized ||
        !this.hasCurrentScope(scope) || this._previewingImage) return
    this._previewingImage = true
    try {
      if (image.id && !image.path) {
        const { menu } = await request('getWeeklyMenu', { weekStart: this.data.week.start })
        if (!this.hasCurrentScope(scope) || this.data.saving) return
        const latest = new Map(menuImages(menu).map((photo) => [photo.id, photo]))
        const refreshed = this.data.photos.map((photo) => photo.path ? photo : latest.get(photo.id) || photo)
        this.setData({ photos: refreshed })
        image = refreshed.find((photo) => (photo.key || photo.id) === key)
        if (!image) return
        if (!latest.has(image.id)) throw new Error('菜谱图片已更新，请重新加载。')
      }
      const source = image.path || image.url
      if (!source) throw new Error('照片暂时无法加载，请重试。')
      wx.previewImage({
        current: source, urls: this.data.photos.map((photo) => photo.path || photo.url).filter(Boolean),
        fail: () => {
          if (this.hasCurrentScope(scope)) wx.showToast({ title: '照片预览失败，请重试', icon: 'none' })
        },
      })
    } catch (error) {
      if (!this.hasCurrentScope(scope)) return
      if (ACCESS_ERRORS.includes(error.code)) this.denyAccess(error.code, error.message)
      else wx.showToast({ title: error.message, icon: 'none' })
    } finally {
      this._previewingImage = false
    }
  },

  onRemoveImage(event) {
    if (this.data.saving || this._choosing) return
    const { index, key } = event.detail
    const photos = this.data.photos.slice()
    if (!photos[index] || (photos[index].key || photos[index].id) !== key) return
    photos.splice(index, 1)
    this.setData({ photos, saveError: '' })
  },

  onReloadConflict() {
    if (this.data.saving || this.data.loading || !this.data.conflict) return
    wx.showModal({
      title: '载入最新菜谱',
      content: '载入后会替换当前未保存的填写内容。',
      confirmText: '载入',
      success: ({ confirm }) => {
        if (confirm && this._active) this.loadMenu()
      }
    })
  },

  async onSave() {
    if (!this.data.authorized || !this.data.loaded || this.data.loading ||
        this.data.saving || this.data.conflict || this._choosing) return
    const scope = this._scope
    if (!this.hasCurrentScope(scope)) {
      this.denyAccess('ORG_CHANGED', CHANGED_ORGANIZATION)
      return
    }

    const days = this.data.days.map(({ meat, vegetable, soup }) => ({
      meat: meat.trim(), vegetable: vegetable.trim(), soup: soup.trim()
    }))
    const photos = this.data.photos.slice()
    if (!photos.length && !days.some((day) => day.meat || day.vegetable || day.soup)) {
      this.setData({ saveError: '请填写至少一道菜，或添加一张菜谱图片。' })
      return
    }

    this.setData({ saving: true, saveError: '' })
    try {
      const assetIds = []
      for (const [index, photo] of photos.entries()) {
        if (photo.id) {
          assetIds.push(photo.id)
          continue
        }
        const [uploaded] = await uploadImages([photo.path])
        if (!this._active) return
        if (!this.hasCurrentScope(scope)) {
          this.denyAccess('ORG_CHANGED', CHANGED_ORGANIZATION)
          return
        }
        if (!uploaded?.id) throw new Error('未收到图片上传结果，请重试。')
        assetIds.push(uploaded.id)
        this.setData({ ['photos[' + index + '].id']: uploaded.id })
      }
      await request('saveWeeklyMenu', { weekStart: this.data.week.start, days, assetIds, revision: this._revision })
      if (!this._active) return
      this._leaving = true
      wx.showToast({ title: '菜谱已保存', icon: 'success' })
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/dynamics/index' }) })
    } catch (error) {
      if (!this._active) return
      if (ACCESS_ERRORS.includes(error.code)) this.denyAccess(error.code, error.message)
      else {
        const conflict = error.code === 'MENU_CHANGED'
        this.setData({
          conflict,
          saveError: conflict ? '这周菜谱已更新。当前填写已保留。' : error.message
        })
      }
    } finally {
      if (this._active && !this._leaving) this.setData({ saving: false })
    }
  }
})
