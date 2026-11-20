const { goHome } = require('../../utils/navigation')
const { usesLocalApi } = require('../../utils/api')
const { inviteToken, tokenFromScan } = require('../../utils/invites')

Page({
  data: { loading: true, connectionError: false },

  onLoad(query = {}) {
    this._incomingCode = query.scene || query.token || ''
  },

  onShow() {
    return this.open()
  },

  onUnload() {
    this._closed = true
  },

  async open() {
    if (this._opening || this._navigating || this._scanning) return
    const incoming = this._incomingCode
    if (incoming) {
      this._incomingCode = ''
      const token = inviteToken(incoming)
      if (token) return this.openRegistration(token)
      this.setData({ loading: false })
      wx.showToast({ title: '二维码无法识别', icon: 'none' })
      return
    }

    this._opening = true
    this.setData({ loading: true, connectionError: false })
    try {
      const session = await getApp().ensureSession({ refresh: true })
      if (!this._closed && session.organization && ['parent', 'teacher'].includes(session.role)) goHome()
    } catch (error) {
      if (!this._closed) {
        this.setData({ connectionError: true })
        wx.showToast({ title: error.message || '打开小程序失败，请重试。', icon: 'none' })
      }
    } finally {
      this._opening = false
      if (!this._closed) this.setData({ loading: false })
    }
  },

  openRegistration(token) {
    if (this._navigating) return
    this._navigating = true
    this.setData({ loading: false })
    wx.navigateTo({
      url: '/pages/register/index?token=' + encodeURIComponent(token),
      fail: () => {
        if (!this._closed) wx.showToast({ title: '无法打开登记页，请重新扫码', icon: 'none' })
      },
      complete: () => { this._navigating = false },
    })
  },

  scan() {
    if (this._scanning || this._navigating) return
    this._scanning = true
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['wxCode', 'qrCode'],
      success: (result) => {
        if (this._closed) return
        const local = usesLocalApi()
        const token = tokenFromScan(result, local)
        if (token) return this.openRegistration(token)
        if (!local && tokenFromScan(result, true)) {
          return wx.showModal({
            title: '这是本机联调登记码',
            content: '请先用微信扫一扫打开开发者工具「本地真机联调」的调试码，再在小程序里扫描这张机构登记码。',
            showCancel: false,
          })
        }
        wx.showToast({ title: '请扫描后台发放的机构登记码', icon: 'none' })
      },
      fail: (error) => {
        if (!this._closed && !String(error?.errMsg || '').includes('cancel')) {
          wx.showToast({ title: '扫描失败，请重试', icon: 'none' })
        }
      },
      complete: () => { this._scanning = false },
    })
  },
})
