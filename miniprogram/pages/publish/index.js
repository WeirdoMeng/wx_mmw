const { request } = require('../../utils/api')
const { MAX_PHOTOS } = require('../../utils/photo-picker')
const { PUBLISH_TYPES, POST_CHANGED, editPublishForm, publishEditor } = require('./editor')

Page({
  ...publishEditor,

  data: {
    loading: true,
    error: '',
    publishTypes: PUBLISH_TYPES,
    maxPublishPhotos: MAX_PHOTOS,
    publishForm: null,
    publishing: false,
    publishError: ''
  },

  async onLoad(options = {}) {
    const id = String(options.id || '').slice(0, 128)
    const organizationId = String(options.org || '').slice(0, 128)
    try {
      const session = await getApp().ensureSession({ refresh: true })
      if (this._disposed) return
      if (session.role !== 'teacher' || !organizationId || session.organization?.id !== organizationId) {
        throw new Error('当前账号没有编辑这条动态的权限')
      }
      const { post } = await request('getPost', { id })
      if (this._disposed) return
      this._originalType = post.type
      this._publishDraft = { organizationId }
      this.setData({ loading: false, publishForm: editPublishForm(post) })
    } catch (error) {
      if (!this._disposed) this.setData({ loading: false, error: error.message })
    }
  },

  onUnload() {
    this._disposed = true
    this._publishDraft = null
  },

  onPostPublished(type) {
    this.getOpenerEventChannel?.()?.emit(POST_CHANGED, { previousType: this._originalType, type })
    wx.showToast({ title: '已重新发布', icon: 'success' })
    this.onBack()
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/dynamics/index' }) })
  }
})
