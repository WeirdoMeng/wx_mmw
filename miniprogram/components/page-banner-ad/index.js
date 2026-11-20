const { request } = require('../../utils/api')
const { bannerRotation, currentBannerVisit } = require('../../utils/tool-banner-ad')

const routes = new Map([
  ['tools', 'pages/tools/index'],
  ['profile', 'pages/profile/index'],
  ['work', 'pages/work/index'],
  ['mealPost', 'pages/post/index'],
  ['dailyPost', 'pages/post/index'],
  ['weeklyMenu', 'pages/menu/detail'],
  ['toolDetail', 'pages/tool/index'],
])

function bannerContext(placement) {
  const route = routes.get(placement)
  if (!route) return ''
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const topRoute = pages[pages.length - 1]?.route
  if (topRoute && topRoute !== route) return ''
  const app = getApp()
  const { id, revision } = app.getRequestScope()
  const session = app.globalData.session
  if (!id || session?.organization?.id !== id || !['parent', 'teacher'].includes(session.role)) return ''
  return [placement, id, revision, session.role, currentBannerVisit(placement)].join(':')
}

Component({
  properties: {
    placement: { type: String, value: '' },
    blocked: { type: Boolean, value: false },
  },

  data: { allowed: false, slots: [] },

  observers: {
    'placement, blocked'() { this.refresh() },
  },

  lifetimes: {
    attached() {
      this._visible = true
      this.refresh()
    },
    detached() {
      this._visible = false
      this._check = null
    },
  },

  pageLifetimes: {
    show() {
      this._visible = true
      this.refresh()
    },
    hide() {
      this._visible = false
      this._check = null
      if (this.data.allowed) this.setData({ allowed: false })
    },
  },

  methods: {
    async refresh() {
      if (!this._visible) return
      if (this.data.blocked) {
        this._check = null
        if (this.data.allowed) this.setData({ allowed: false })
        return
      }
      const { placement } = this.data
      const context = bannerContext(placement)
      if (!context || (typeof wx.canIUse === 'function' && !wx.canIUse('ad-custom'))) {
        this._check = null
        this._slotContext = null
        this.setData({ allowed: false, slots: [] })
        return
      }
      if (this._check?.context === context) return
      const check = { context }
      this._check = check
      const keepSlot = this._slotContext === context
      this._slotContext = context
      this.setData({ allowed: false, ...(keepSlot ? {} : { slots: [] }) })

      try {
        const { banners } = await request('getBannerSettings')
        if (this._check !== check || !this._visible || bannerContext(this.data.placement) !== context) return
        if (banners?.[placement] !== true) {
          this.setData({ slots: [] })
          return
        }

        const slot = this.data.slots[0]
        if (slot) {
          this.setData({ allowed: true })
          if (slot.loaded) bannerRotation.remember(slot.unitId)
          return
        }
        this._slotNumber = (this._slotNumber || 0) + 1
        this.setData({
          allowed: true,
          slots: [{ token: this._slotNumber, unitId: bannerRotation.choose(), loaded: false, failed: false }],
        })
      } catch {
        // The host page stays usable while the placement remains hidden.
      } finally {
        if (this._check === check) this._check = null
      }
    },

    onBannerLoad(event) {
      const slot = this.data.slots[0]
      if (!slot || slot.token !== event.currentTarget.dataset.token) return
      this.setData({ 'slots[0].loaded': true, 'slots[0].failed': false })
      if (this._visible && this.data.allowed && bannerContext(this.data.placement) === this._slotContext) {
        bannerRotation.remember(slot.unitId)
      }
    },

    onBannerError(event) {
      const slot = this.data.slots[0]
      if (slot && slot.token === event.currentTarget.dataset.token) {
        this.setData({ 'slots[0].loaded': false, 'slots[0].failed': true })
      }
    },
  },
})
