const { request } = require('../../utils/api')
const { resetHome } = require('../../utils/navigation')
const { inviteToken } = require('../../utils/invites')
const { GRADES, toStudent, toParent, validPhone } = require('../profile/fields')

Page({
  data: {
    loading: true, saving: false, error: '', ready: false, type: '', organizationName: '', submitted: false,
    grades: ['请选择年级', ...GRADES], gradeIndex: 0
  },

  onLoad(query = {}) {
    const token = inviteToken(query.token)
    const organizationId = typeof query.organizationId === 'string' ? query.organizationId : ''
    this._entry = token ? { token } : (!query.token && organizationId ? { organizationId, type: 'parent' } : null)
    return this.inspect()
  },

  async inspect() {
    if (!this._entry) {
      this.setData({ loading: false, error: '二维码无法识别，请向机构索取最新二维码。' })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const { type, organization } = await request('enrollmentInspect', this._entry)
      if (this._closed) return
      if (!organization?.id || !['parent', 'teacher'].includes(type)) throw new Error('登记入口已失效，请重新扫码。')
      wx.setNavigationBarTitle({ title: type === 'teacher' ? '教师登记' : '孩子登记' })
      this.setData({ ready: true, type, organizationName: organization.name })
    } catch (error) {
      if (!this._closed) this.setData({ error: error.message || '二维码暂时无法使用。' })
    } finally {
      if (!this._closed) this.setData({ loading: false })
    }
  },

  onUnload() {
    this._closed = true
  },

  onGradeChange(event) {
    if (this.data.saving) return
    const gradeIndex = Number(event.detail.value)
    if (Number.isInteger(gradeIndex) && this.data.grades[gradeIndex]) this.setData({ gradeIndex })
  },

  showPrivacy() {
    if (!wx.openPrivacyContract) {
      wx.showToast({ title: '请更新微信后查看隐私保护指引', icon: 'none' })
      return
    }
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '暂时无法打开隐私保护指引', icon: 'none' }),
    })
  },

  async submit(event) {
    const { ready, saving, type, submitted } = this.data
    if (!ready || saving || submitted) return
    this.setData({ saving: true, error: '' })
    try {
      const values = event.detail.value || {}
      const payload = { ...this._entry, type }
      if (type === 'teacher') {
        const name = String(values.name || '').trim()
        const phone = String(values.phone || '').trim()
        if (!name) throw new Error('请填写教师姓名。')
        if (!validPhone(phone)) throw new Error('教师联系电话请输入有效的 11 位手机号。')
        payload.teacher = { name, phone }
      } else {
        const student = toStudent({ ...values, grade: GRADES[this.data.gradeIndex - 1] })
        const parent = toParent(values)
        if (!Array.isArray(values.guardianConsent) || !values.guardianConsent.includes('agree')) {
          throw new Error('请由监护人阅读并同意隐私保护指引。')
        }
        Object.assign(payload, { student, parent, guardianConsent: true })
      }
      const result = await request('enrollmentSubmit', payload)
      if (this._closed) return
      if (result.status === 'active' && result.organization?.id) {
        const app = getApp()
        const session = await app.changeContext('selectOrganization', { organizationId: result.organization.id })
        if (this._closed) return
        if (session.role === 'parent' && result.student?.id) app.selectStudent(result.student.id)
        resetHome()
        return
      }
      this.setData({ submitted: true })
      this.goEntry()
    } catch (error) {
      if (!this._closed) this.setData({ error: error.message || '登记失败，请重试。' })
    } finally {
      if (!this._closed) this.setData({ saving: false })
    }
  },

  goEntry() {
    const success = () => {
      if (this.data.submitted) wx.showToast({ title: '登记已提交，等待审核', icon: 'none' })
    }
    const relaunch = () => wx.reLaunch({ url: '/pages/index/index', success })
    if (getCurrentPages().length > 1) wx.navigateBack({ success, fail: relaunch })
    else relaunch()
  },
})
