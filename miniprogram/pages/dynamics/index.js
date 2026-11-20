const { request } = require('../../utils/api')
const { getNavigationInsets, syncTab } = require('../../utils/navigation')
const { MAX_PHOTOS } = require('../../utils/photo-picker')
const { moveDate } = require('../../components/mmw-calendar/date')
const { PUBLISH_TYPES, POST_CHANGED, newPublishForm, publishEditor } = require('../publish/editor')
const { DISHES, describeWeek, menuDays, menuImages, canEditMenu } = require('../menu/week')

const PAGE_SIZE = 10
const TYPES = [
  { key: 'meal', label: '餐食', icon: 'meal' },
  { key: 'daily', label: '日常', icon: 'daily' },
  { key: 'menu', label: '每周菜谱', icon: 'weekly-menu' }
]
const DISPLAY_AGE = 60_000

function newFeed() {
  return { items: [], cursor: null, loading: false, loaded: false, error: '', age: 0, stamp: 0, retryReset: true }
}

function decoratePost(post) {
  const parts = String(post.date).split('-').map(Number)
  const day = new Date(parts[0], parts[1] - 1, parts[2], 12)
  const year = day.getFullYear() === new Date().getFullYear() ? '' : day.getFullYear() + '年'
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const photos = Array.isArray(post.images) ? post.images : []
  return {
    ...post,
    dateText: Number.isNaN(day.getTime()) ? post.date : year + parts[1] + '月' + parts[2] + '日 · 周' + weekdays[day.getDay()],
    cover: photos[0]?.url || '',
    photoCount: post.photoCount ?? photos.length
  }
}

Page({
  ...publishEditor,

  data: {
    topInset: 20,
    menuHeight: 44,
    authorized: false,
    role: '',
    organizationName: '托管中心',
    type: 'meal',
    types: TYPES,
    items: [],
    nextCursor: null,
    loading: true,
    loaded: false,
    error: '',
    publishTypes: PUBLISH_TYPES,
    maxPublishPhotos: MAX_PHOTOS,
    publishForm: null,
    publishing: false,
    publishError: '',
    week: null,
    weekRows: [],
    dishes: DISHES,
    menuLoading: true,
    menuError: '',
    hasMenu: false,
    menuPhotos: [],
    canEditMenu: false
  },

  onLoad() {
    const { topInset, navHeight, menuWidth } = getNavigationInsets()
    this.setData({ topInset, menuHeight: navHeight, menuWidth, week: describeWeek() })
    this._feeds = { meal: newFeed(), daily: newFeed() }
  },

  async onShow() {
    const showId = (this._showId || 0) + 1
    this._showId = showId
    const app = getApp()
    const current = app.globalData.session
    const keep = this.data.authorized && current?.organization?.id === this._organizationId && current?.role === this.data.role
    syncTab(this, 1, current?.organization ? current.role : 'guest', Boolean(keep && this.data.publishForm))
    if (!keep) {
      this._weekRequest = null
      this.setData({ authorized: false, loading: true, error: '', organizationName: current?.organization?.name || '托管中心' })
    }
    try {
      const session = await app.ensureSession({ refresh: true })
      if (this._showId !== showId) return
      if (session.role === 'guest' || !session.organization) {
        this.clearPrivateFeed()
        return
      }

      const changed = this._organizationId !== session.organization.id || this.data.role !== session.role
      if (changed) {
        this._feeds = { meal: newFeed(), daily: newFeed() }
        this._publishDraft = null
        this._weekRequest = null
        this.setData({
          items: [],
          nextCursor: null,
          loading: true,
          loaded: false,
          publishForm: null,
          publishing: false,
          publishError: '',
          week: describeWeek(),
          weekRows: [],
          hasMenu: false,
          menuPhotos: []
        })
      }
      this._organizationId = session.organization.id
      if (app.globalData.postsChangedOrganization === this._organizationId) {
        app.globalData.postsChangedOrganization = ''
        this._feeds = { meal: newFeed(), daily: newFeed() }
      }
      this.setData({
        authorized: true,
        role: session.role,
        organizationName: session.organization.name,
        error: '',
        canEditMenu: canEditMenu(session.role)
      })
      syncTab(this, 1, session.role, Boolean(this.data.publishForm))
      const type = this.data.type
      if (type === 'menu') {
        await this.loadWeek(this.data.week, keep && !changed)
        return
      }
      const feed = this._feeds[type]
      this.showFeed(type)
      if ((!feed.loaded || Date.now() - feed.age > DISPLAY_AGE) && !feed.loading) {
        await this.loadFeed(type, true)
      }
    } catch (error) {
      if (this._showId !== showId) return
      if (error.code === 'NOT_BOUND' || error.code === 'FORBIDDEN' || error.code === 'ORG_CHANGED') this.clearPrivateFeed(error)
      else this.setData({ loading: false, error: error.message })
    }
  },

  onUnload() {
    this._showId = 0
    this._feeds = null
    this._weekRequest = null
  },

  clearPrivateFeed(error) {
    this._showId = (this._showId || 0) + 1
    this._feeds = { meal: newFeed(), daily: newFeed() }
    this._publishDraft = null
    this._organizationId = ''
    this._weekRequest = null
    const showError = error?.code === 'FORBIDDEN' || error?.code === 'ORG_CHANGED'
    this.setData({
      authorized: false,
      role: '',
      organizationName: '托管中心',
      items: [],
      nextCursor: null,
      loading: false,
      loaded: false,
      error: showError ? error.message : '',
      publishForm: null,
      publishing: false,
      publishError: '',
      weekRows: [],
      hasMenu: false,
      canEditMenu: false,
      menuPhotos: [],
      menuLoading: false,
      menuError: ''
    })
    if (showError) {
      if (typeof this.getTabBar === 'function') this.getTabBar()?.setData({ hidden: false })
    } else {
      getApp().setSession(null)
      wx.reLaunch({ url: '/pages/index/index' })
    }
  },

  showFeed(type) {
    if (!this._feeds || type !== this.data.type) return
    const feed = this._feeds[type]
    this.setData({
      items: feed.items,
      nextCursor: feed.cursor,
      loading: feed.loading,
      loaded: feed.loaded,
      error: feed.error
    })
  },

  async loadFeed(type, reset) {
    const feed = this._feeds?.[type]
    if (!this.data.authorized || !feed || (!reset && (feed.loading || !feed.cursor))) return
    const stamp = ++feed.stamp
    feed.loading = true
    feed.error = ''
    feed.retryReset = reset
    this.showFeed(type)

    try {
      const result = await request('listPosts', {
        type,
        cursor: reset ? null : feed.cursor,
        limit: PAGE_SIZE
      })
      if (this._feeds?.[type] !== feed || feed.stamp !== stamp) return
      const items = result.items.map(decoratePost)
      if (reset) {
        feed.items = items
        feed.age = Date.now()
      } else {
        const known = new Set(feed.items.map((item) => item.id))
        feed.items = feed.items.concat(items.filter((item) => !known.has(item.id)))
      }
      feed.cursor = result.nextCursor || null
      feed.loaded = true
    } catch (error) {
      if (this._feeds?.[type] !== feed || feed.stamp !== stamp) return
      if (error.code === 'NOT_BOUND' || error.code === 'FORBIDDEN' || error.code === 'ORG_CHANGED') {
        this.clearPrivateFeed(error)
        return
      }
      feed.error = error.message
      if (error.code === 'INVALID_CURSOR') feed.retryReset = true
    } finally {
      if (this._feeds?.[type] === feed && feed.stamp === stamp) {
        feed.loading = false
        this.showFeed(type)
      }
    }
  },

  onTypeTap(event) {
    const { type } = event.currentTarget.dataset
    if (!this.data.authorized || (type !== 'menu' && !this._feeds?.[type]) || type === this.data.type) return
    this.setData({ type })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    if (type === 'menu') {
      this.loadWeek(this.data.week)
      return
    }
    this._weekRequest = null
    this.showFeed(type)
    const feed = this._feeds[type]
    if (!feed.loaded || Date.now() - feed.age > DISPLAY_AGE) this.loadFeed(type, true)
  },

  async onPullDownRefresh() {
    try {
      if (!this.data.authorized) await this.onShow()
      else if (this.data.type === 'menu') await this.loadWeek(this.data.week)
      else await this.loadFeed(this.data.type, true)
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  onReachBottom() {
    if (this.data.authorized && this.data.type !== 'menu' && !this.data.error) this.loadFeed(this.data.type, false)
  },

  onLoadMore() {
    this.loadFeed(this.data.type, false)
  },

  onRetry() {
    if (!this.data.authorized) this.onShow()
    else if (this.data.type === 'menu') this.loadWeek(this.data.week)
    else this.loadFeed(this.data.type, this._feeds[this.data.type].retryReset)
  },

  async loadWeek(week, preserve = false) {
    if (!this.data.authorized || this.data.type !== 'menu' || !week) return
    const current = {}
    this._weekRequest = current
    if (!preserve || this.data.week?.start !== week.start || !this.data.weekRows.length || this.data.menuError) {
      this.setData({
        week,
        weekRows: [],
        hasMenu: false,
        menuPhotos: [],
        menuError: '',
        menuLoading: true
      })
    }
    try {
      const { menu } = await request('getWeeklyMenu', { weekStart: week.start })
      if (this._weekRequest !== current) return
      const days = menuDays(menu)
      this.setData({
        weekRows: week.days.map((day, index) => ({ ...day, ...days[index] })),
        hasMenu: Boolean(menu),
        menuPhotos: menuImages(menu),
        menuLoading: false
      })
    } catch (error) {
      if (this._weekRequest !== current) return
      if (['NOT_BOUND', 'FORBIDDEN', 'ORG_CHANGED'].includes(error.code)) this.clearPrivateFeed(error)
      else this.setData({ menuError: error.message, menuLoading: false })
    }
  },

  onMoveWeek(event) {
    const offset = Number(event.currentTarget.dataset.offset)
    if (offset !== 1 && offset !== -1) return
    this.loadWeek(describeWeek(moveDate(this.data.week.start, offset, false)))
  },

  onChooseMenuDate(event) {
    const week = describeWeek(event.detail.value)
    if (week && week.start !== this.data.week.start) this.loadWeek(week)
  },

  onEditMenu() {
    if (!this.data.authorized || !this.data.canEditMenu || this.data.menuLoading ||
        this.data.menuError || !this._organizationId || this._openingMenu) return
    this._openingMenu = true
    wx.navigateTo({
      url: '/pages/menu/index?weekStart=' + encodeURIComponent(this.data.week.start)
        + '&org=' + encodeURIComponent(this._organizationId),
      fail: () => wx.showToast({ title: '暂时无法打开菜谱编辑', icon: 'none' }),
      complete: () => { this._openingMenu = false }
    })
  },

  onOpenMenuDetail() {
    const { authorized, type, week, hasMenu, menuError, menuLoading } = this.data
    if (!authorized || type !== 'menu' || !week || !hasMenu || menuError || menuLoading || !this._organizationId || this._openingMenu) return
    if (getApp().globalData.session?.organization?.id !== this._organizationId) return
    this._openingMenu = true
    wx.navigateTo({
      url: '/pages/menu/detail?weekStart=' + encodeURIComponent(week.start) + '&org=' + encodeURIComponent(this._organizationId),
      fail: () => wx.showToast({ title: '暂时无法打开菜谱详情', icon: 'none' }),
      complete: () => { this._openingMenu = false }
    })
  },

  async onPreviewMenuImage(event) {
    const weekStart = this.data.week?.start
    const { index, key } = event.detail
    if (!this.data.authorized || !weekStart || this._previewingMenuImage || this.data.menuPhotos[index]?.id !== key) return
    const showId = this._showId
    const isCurrent = () => this._showId === showId && this.data.authorized
      && this.data.type === 'menu' && this.data.week?.start === weekStart
    this._previewingMenuImage = true
    try {
      const { menu } = await request('getWeeklyMenu', { weekStart })
      if (!isCurrent()) return
      const photos = menuImages(menu)
      this.setData({ menuPhotos: photos })
      const photo = photos.find((item) => item.id === key)
      if (!photo?.url) throw new Error(photo ? '照片暂时无法加载，请重试。' : '菜谱图片已更新，请重新点按。')
      wx.previewImage({
        current: photo.url, urls: photos.map((item) => item.url).filter(Boolean),
        fail: () => {
          if (isCurrent()) wx.showToast({ title: '照片预览失败，请重试', icon: 'none' })
        },
      })
    } catch (error) {
      if (!isCurrent()) return
      if (['NOT_BOUND', 'FORBIDDEN', 'ORG_CHANGED'].includes(error.code)) this.clearPrivateFeed(error)
      else wx.showToast({ title: error.message, icon: 'none' })
    } finally {
      this._previewingMenuImage = false
    }
  },

  onOpenPost(event) {
    const { id } = event.currentTarget.dataset
    if (this.data.authorized && this._organizationId) {
      const organizationId = this._organizationId
      wx.navigateTo({
        url: '/pages/post/index?id=' + encodeURIComponent(id) + '&org=' + encodeURIComponent(organizationId),
        events: {
          [POST_CHANGED]: ({ previousType, type }) => {
            if (!this._feeds || this._organizationId !== organizationId) return
            if (this._feeds[previousType]) this._feeds[previousType] = newFeed()
            if (type !== previousType && this._feeds[type]) this._feeds[type] = newFeed()
          }
        }
      })
    }
  },

  onPublish() {
    if (!this.data.authorized || this.data.type === 'menu' || this.data.publishForm ||
        this.data.role !== 'teacher') return
    if (typeof this.getTabBar === 'function') this.getTabBar()?.setData({ hidden: true })
    this._publishDraft = { organizationId: this._organizationId }
    this.setData({ publishForm: newPublishForm('meal'), publishError: '' })
  },

  onClosePublish() {
    if (this.data.publishing || this._choosingPublishPhotos) return
    this._publishDraft = null
    this.setData({ publishForm: null, publishError: '' })
    syncTab(this, 1, this.data.role)
  },

  onPostPublished(type) {
    this.onClosePublish()
    this.setData({ type }, () => {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      this.loadFeed(type, true)
    })
    wx.showToast({ title: '已发布', icon: 'success' })
  },

  onCoverError(event) {
    const { id, url } = event.currentTarget.dataset
    const feed = this._feeds?.[this.data.type]
    const post = feed?.items.find((item) => item.id === id)
    if (!post?.cover || url !== post.cover) return
    post.cover = ''
    this.showFeed(this.data.type)
  }
})
