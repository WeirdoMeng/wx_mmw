const { request } = require('../../utils/api')
const { shareCardFields } = require('../../utils/share-preview')
const { POST_CHANGED } = require('../publish/editor')

const SHARE_TITLE = '托管动态'
const SHARE_PAGE = '/pages/post/index'
const SHARE_MENUS = ['shareAppMessage', 'shareTimeline']
const TIMELINE_SCENE = 1154

function shareTitle(type) {
  if (type === 'meal') return '托管餐食'
  if (type === 'daily') return '托管日常'
  return SHARE_TITLE
}

function setShareMenu(enabled) {
  if (enabled) wx.showShareMenu?.({ menus: SHARE_MENUS })
  else wx.hideShareMenu?.({ menus: SHARE_MENUS })
}

function postShareRecord(post, loadId) {
  return {
    key: post.id + ':' + post.revision + ':' + loadId,
    title: post.title || shareTitle(post.type),
    summary: post.note || post.date,
    images: post.images,
    aspect: 'both',
  }
}

Page({
  data: {
    singlePage: false,
    previewTitle: SHARE_TITLE,
    previewIcon: 'feed',
    loading: true,
    error: '',
    retryable: false,
    post: null,
    shareRecord: null,
    canManage: false,
    deleting: false
  },

  onLoad(options = {}) {
    this._id = typeof options.id === 'string' ? options.id : ''
    this._expectedOrganization = typeof options.org === 'string' ? options.org : ''
    const entry = wx.getEnterOptionsSync?.() || wx.getLaunchOptionsSync?.()
    // WeChat Moments uses a restricted single-page preview that has no login.
    const singlePage = Number(entry?.scene) === TIMELINE_SCENE
    const type = options.type
    const previewIcon = type === 'meal' || type === 'daily' ? type : 'feed'
    this.setData({ singlePage, previewTitle: shareTitle(type), previewIcon, loading: !singlePage })
  },

  onShow() {
    if (!this.data.singlePage) return this.loadPost()
  },

  onUnload() {
    this._loadId = 0
    this.clearShareCover()
  },

  async loadPost() {
    if (this.data.singlePage) return
    setShareMenu(false)
    const loadId = (this._loadId || 0) + 1
    this._loadId = loadId
    if (!/^[a-f0-9]{32}$/.test(this._id) || (this._expectedOrganization && !/^[a-zA-Z0-9_-]{1,64}$/.test(this._expectedOrganization))) {
      this.setData({ loading: false, error: '这条动态链接无效。', retryable: false })
      return
    }
    this.clearShareCover()
    this.setData({ loading: true, error: '', retryable: false, post: null, shareRecord: null, canManage: false })
    try {
      const app = getApp()
      let session = await app.ensureSession({ refresh: true })
      if (this._loadId !== loadId) return
      if (!session?.organization || !['parent', 'teacher'].includes(session.role)) {
        this.setData({ loading: false, error: '加入对应机构后可以查看这条动态。' })
        return
      }
      if (this._expectedOrganization && this._expectedOrganization !== session.organization.id) {
        session = await app.changeContext('selectOrganization', { organizationId: this._expectedOrganization })
        if (this._loadId !== loadId) return
        if (session?.organization?.id !== this._expectedOrganization) {
          this.setData({ loading: false, error: '你没有查看此机构的权限。' })
          return
        }
      }
      const { post } = await request('getPost', { id: this._id })
      if (this._loadId !== loadId) return
      this._organizationId = session.organization.id
      const category = post.type === 'meal' ? '餐食' : '日常'
      const shareRecord = postShareRecord(post, loadId)
      this.prepareShareCover()
      this.setData({
        post, category, loading: false, canManage: session.role === 'teacher',
        shareRecord,
      })
      wx.setNavigationBarTitle({ title: category + '详情' })
      setShareMenu(true)
    } catch (error) {
      if (this._loadId !== loadId) return
      const retryable = !['FORBIDDEN', 'NOT_BOUND', 'NOT_FOUND'].includes(error.code)
      this.setData({ post: null, loading: false, error: error.message || '暂时无法读取这条动态。', retryable })
    }
  },

  onPostActions() {
    const post = this.data.post
    if (!this.data.canManage || !post || this.data.deleting || this._postActionOpen) return
    const loadId = this._loadId
    this._postActionOpen = true
    wx.showActionSheet({
      itemList: ['编辑并重新发布', '删除'],
      success: ({ tapIndex }) => {
        if (this._loadId !== loadId || !this.data.canManage) return
        if (tapIndex === 0) {
          wx.navigateTo({
            url: '/pages/publish/index?id=' + encodeURIComponent(post.id) + '&org=' + encodeURIComponent(this._organizationId),
            events: { [POST_CHANGED]: (change) => this.notifyPostChanged(change) },
            fail: () => wx.showToast({ title: '无法打开动态编辑', icon: 'none' })
          })
        } else if (tapIndex === 1) {
          wx.showModal({
            title: '删除动态',
            content: '删除后，机构成员将无法查看这条动态和它的照片。',
            confirmText: '删除',
            confirmColor: '#953e3c',
            success: (result) => {
              if (result.confirm && this._loadId === loadId) void this.deletePost(post)
            }
          })
        }
      },
      complete: () => { this._postActionOpen = false }
    })
  },

  notifyPostChanged(change) {
    if (this._organizationId) getApp().globalData.postsChangedOrganization = this._organizationId
    this.getOpenerEventChannel?.()?.emit(POST_CHANGED, change)
  },

  async deletePost(post) {
    if (!this.data.canManage || this.data.deleting || this.data.post?.id !== post.id) return
    const loadId = this._loadId
    this.setData({ deleting: true })
    try {
      await request('deletePost', { id: post.id })
      this.notifyPostChanged({ previousType: post.type })
      if (this._loadId !== loadId) return
      setShareMenu(false)
      this.clearShareCover()
      this.setData({ post: null, shareRecord: null, canManage: false, error: '这条动态已删除。', retryable: false })
      wx.showToast({ title: '已删除', icon: 'success' })
      const toDynamics = () => wx.switchTab({ url: '/pages/dynamics/index' })
      const pages = getCurrentPages()
      if (pages[pages.length - 2]?.route === 'pages/dynamics/index') wx.navigateBack({ fail: toDynamics })
      else toDynamics()
    } catch (error) {
      if (this._loadId === loadId) wx.showToast({ title: error.message, icon: 'none' })
    } finally {
      if (this._loadId === loadId) this.setData({ deleting: false })
    }
  },

  async onPreview(event) {
    if (this.data.singlePage || !this.data.post || this.data.deleting || this._previewing) return
    const {key} = event.detail
    if (!this.data.post.images.some((image) => image.id === key)) return
    const loadId = this._loadId
    this._previewing = true
    try {
      if (getApp().globalData.session?.organization?.id !== this._organizationId) return this.loadPost()
      const { post } = await request('getPost', { id: this._id })
      if (!this.data.post || this._loadId !== loadId) return
      const shareRecord = postShareRecord(post, loadId)
      const recoveredPhoto = this._shareCover && !this._shareCover.photo && post.images.some((image) => image.url)
      if (shareRecord.key !== this.data.shareRecord?.key || recoveredPhoto) {
        this.prepareShareCover()
        this.setData({ post, shareRecord })
      } else {
        this.setData({ post })
      }
      const urls = post.images.map((image) => image.url).filter(Boolean)
      const current = post.images.find((image) => image.id === key)?.url
      if (current) wx.previewImage({
        current, urls,
        fail: () => {
          if (this._loadId === loadId) wx.showToast({ title: '照片预览失败，请重试', icon: 'none' })
        },
      })
      else wx.showToast({ title: '照片暂不可用', icon: 'none' })
    } catch (error) {
      if (this._loadId !== loadId) return
      if (['ORG_CHANGED', 'NOT_BOUND', 'FORBIDDEN', 'NOT_FOUND'].includes(error.code)) {
        setShareMenu(false)
        this.clearShareCover()
        this.setData({ post: null, shareRecord: null, canManage: false, error: error.message, retryable: error.code === 'ORG_CHANGED' })
      } else {
        wx.showToast({ title: error.message, icon: 'none' })
      }
    } finally {
      this._previewing = false
    }
  },

  onStart() {
    wx.reLaunch({ url: '/pages/index/index' })
  },

  clearShareCover() {
    this._finishShareCover?.()
    this._finishShareCover = null
    this._shareCover = null
    this._shareCoverReady = null
  },

  prepareShareCover() {
    this.clearShareCover()
    this._shareCoverReady = new Promise((resolve) => { this._finishShareCover = resolve })
  },

  onShareCoverReady({ detail }) {
    if (detail.key !== this.data.shareRecord?.key) return
    this._shareCover = detail
    this._finishShareCover?.()
    this._finishShareCover = null
  },

  shareOptions(query, format) {
    const record = query ? this.data.shareRecord : null
    const cover = this._shareCover?.key === record?.key ? this._shareCover : null
    return {
      ...shareCardFields(record || { title: SHARE_TITLE }, cover?.[format], cover?.photo),
      ...(format === 'chat' ? { path: query ? SHARE_PAGE + '?' + query : '/pages/index/index' } : { query }),
    }
  },

  sharePost(format) {
    const query = this.shareQuery()
    const options = this.shareOptions(query, format)
    if (!query || !this._finishShareCover) return options

    const key = this.data.shareRecord?.key
    const pending = this._shareCoverReady
    options.promise = pending.then(() => {
      const current = this._shareCoverReady === pending && this.data.shareRecord?.key === key
      return this.shareOptions(current ? this.shareQuery() : '', format)
    })
    return options
  },

  onShareAppMessage() {
    return this.sharePost('chat')
  },

  onShareTimeline() {
    return this.sharePost('timeline')
  },

  shareQuery() {
    const { post, deleting } = this.data
    const organizationId = this._organizationId
    if (!post || deleting || !organizationId) return ''
    const session = getApp().globalData.session
    if (session?.organization?.id !== organizationId || !['parent', 'teacher'].includes(session.role)) return ''
    return 'id=' + encodeURIComponent(post.id) + '&org=' + encodeURIComponent(organizationId)
      + '&type=' + encodeURIComponent(post.type)
  },
})
