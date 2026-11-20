const { request } = require('../../utils/api')
const { shareCardFields, shareText } = require('../../utils/share-preview')
const { DISHES, describeWeek, menuDays, menuImages } = require('./week')

const PAGE = '/pages/menu/detail'
const TITLE = '每周菜谱'
const SHARE_MENUS = ['shareAppMessage', 'shareTimeline']
const TIMELINE_SCENE = 1154
const COVER_WAIT = 2600
const ACCESS_ERRORS = ['NOT_BOUND', 'FORBIDDEN', 'UNAUTHENTICATED', 'ORG_CHANGED']

function presentRows(week, menu) {
  const days = menuDays(menu)
  return week.days.map((day, index) => ({ ...day, ...days[index] }))
}

function shareSummary(rows) {
  return rows.map(day => {
    const names = DISHES.map(({key}) => shareText(day[key], 12)).filter(Boolean)
    return names.length ? `${day.label} ${names.join('、')}` : ''
  }).filter(Boolean).join('；')
}

Page({
  data: {
    singlePage: false,
    week: null,
    dishes: DISHES,
    weekRows: [],
    photos: [],
    shareRecord: null,
    loading: true,
    hasMenu: false,
    error: '',
    retryable: false,
  },

  onLoad(query = {}) {
    const week = describeWeek(query.weekStart || '')
    const org = query.org
    this._organizationId = typeof org === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(org) ? org : ''
    const enter = wx.getEnterOptionsSync?.() || wx.getLaunchOptionsSync?.()
    const singlePage = Number(enter?.scene) === TIMELINE_SCENE
    this._loadId = 0
    this._recordId = 0
    this.setData({ week: week?.start === query.weekStart ? week : null, singlePage, loading: !singlePage })
  },

  onShow() {
    if (!this.data.singlePage) return this.loadMenu()
  },

  onUnload() {
    this._disposed = true
    this.finishWait()
  },

  async onPullDownRefresh() {
    try { await this.loadMenu() } finally { wx.stopPullDownRefresh() }
  },

  clearMenu(changes = {}) {
    this._scope = null
    this.finishWait()
    this._cover = null
    wx.hideShareMenu?.({ menus: SHARE_MENUS })
    this.setData({ weekRows: [], photos: [], shareRecord: null, hasMenu: false, ...changes })
  },

  sameScope() {
    if (!this._scope || this._disposed) return false
    const current = getApp().getRequestScope()
    return current.id === this._scope.id && current.revision === this._scope.revision
  },

  async loadMenu() {
    if (this.data.singlePage || this._disposed) return
    const id = ++this._loadId
    const current = () => !this._disposed && this._loadId === id
    const { week } = this.data
    this.clearMenu({ loading: true, error: '', retryable: false })
    if (!week || !this._organizationId) {
      this.setData({ loading: false, error: '这条菜谱链接无效。' })
      return
    }
    try {
      const app = getApp()
      let session = await app.ensureSession({ refresh: true })
      if (!current()) return
      if (!session?.organization || !['parent', 'teacher'].includes(session.role)) {
        this.setData({ loading: false, error: '加入对应机构后可以查看这份菜谱。' })
        return
      }
      if (session.organization.id !== this._organizationId) {
        session = await app.changeContext('selectOrganization', { organizationId: this._organizationId })
        if (!current()) return
      }
      if (session?.organization?.id !== this._organizationId || !['parent', 'teacher'].includes(session.role)) {
        this.setData({ loading: false, error: '当前账号没有查看此机构菜谱的权限。' })
        return
      }

      this._scope = app.getRequestScope()
      const { menu } = await request('getWeeklyMenu', { weekStart: week.start })
      if (!current()) return
      if (!this.sameScope()) {
        this.clearMenu({ loading: false, error: '当前机构已变更，请重新打开菜谱。' })
        return
      }
      this.presentMenu(week, menu)
    } catch (error) {
      if (!current()) return
      const denied = ACCESS_ERRORS.includes(error.code)
      this.clearMenu({ loading: false, error: error.message || '暂时无法读取菜谱。', retryable: !denied })
    }
  },

  presentMenu(week, menu) {
    this.finishWait()
    this._cover = null
    const weekRows = presentRows(week, menu)
    const photos = menuImages(menu)
    const shareRecord = menu ? {
      key: String(++this._recordId),
      title: `${TITLE} · ${week.label}`,
      summary: shareSummary(weekRows),
      images: photos,
      aspect: 'both',
    } : null
    this.setData({ weekRows, photos, hasMenu: Boolean(menu), loading: false, shareRecord })
    if (shareRecord) wx.showShareMenu?.({ menus: SHARE_MENUS })
    else wx.hideShareMenu?.({ menus: SHARE_MENUS })
  },

  async onPreviewPhoto(event) {
    const { index, key } = event.detail
    const { week, photos } = this.data
    if (this._previewing || this.data.loading || photos[index]?.id !== key || !this.sameScope()) return
    const id = this._loadId
    this._previewing = true
    try {
      const { menu } = await request('getWeeklyMenu', { weekStart: week.start })
      if (this._loadId !== id || !this.sameScope()) return
      const latest = menuImages(menu)
      const active = latest.find(photo => photo.id === key)
      this.presentMenu(week, menu)
      if (!active?.url) throw Error(active ? '照片暂时无法加载，请重试。' : '菜谱图片已更新，请重新点按。')
      wx.previewImage({
        current: active.url, urls: latest.map(photo => photo.url).filter(Boolean),
        fail: () => wx.showToast({ title: '照片预览失败，请重试', icon: 'none' }),
      })
    } catch (error) {
      if (this._disposed || this._loadId !== id) return
      if (ACCESS_ERRORS.includes(error.code)) this.clearMenu({ error: error.message, retryable: false })
      else wx.showToast({ title: error.message || '暂时无法加载照片', icon: 'none' })
    } finally {
      this._previewing = false
    }
  },

  onShareCoverReady({ detail }) {
    if (detail.key !== this.data.shareRecord?.key || !this.sameScope()) return
    this._cover = detail
    this.finishWait(detail)
  },

  waitForCover() {
    if (!this._waiting) {
      const pending = {}
      pending.promise = new Promise(resolve => { pending.resolve = resolve })
      pending.timer = setTimeout(() => this.finishWait(), COVER_WAIT)
      this._waiting = pending
    }
    return this._waiting.promise
  },

  finishWait(cover) {
    const pending = this._waiting
    if (!pending) return
    clearTimeout(pending.timer)
    this._waiting = null
    pending.resolve(cover)
  },

  shareMenu(format) {
    const { shareRecord, singlePage, week } = this.data
    const fallback = {
      ...shareCardFields({ title: TITLE }),
      ...(format === 'chat' ? { path: '/pages/index/index' } : { query: '' }),
    }
    if (!shareRecord || singlePage || !this.sameScope()) return fallback
    const query = 'weekStart=' + encodeURIComponent(week.start) + '&org=' + encodeURIComponent(this._organizationId)
    const options = cover => ({
      ...shareCardFields(shareRecord, cover?.[format], cover?.photo),
      ...(format === 'chat' ? { path: PAGE + '?' + query } : { query }),
    })
    const cover = this._cover?.key === shareRecord.key ? this._cover : null
    if (cover) return options(cover)
    const promise = this.waitForCover().then(result =>
      this.sameScope() && this.data.shareRecord?.key === shareRecord.key ? options(result) : fallback)
    return { ...options(null), promise }
  },

  onShareAppMessage() { return this.shareMenu('chat') },

  onShareTimeline() { return this.shareMenu('timeline') },

  onBack() {
    wx.switchTab({ url: '/pages/dynamics/index' })
  },
})
