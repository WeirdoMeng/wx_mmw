const {request} = require('../../utils/api')
const {getNavigationInsets} = require('../../utils/navigation')
const {parseDate, dateLabel} = require('../../components/mmw-calendar/date')

const NO_ACCESS = '当前账号没有这条作业记录的查看权限。'
const OTHER_ORGANIZATION = '当前机构已变更，请重新打开此记录。'
const PAGE_SIZE = 15

function staffRole(role) {
  return role === 'teacher'
}

function accessDenied(error) {
  return /^(FORBIDDEN|NOT_BOUND|UNAUTHENTICATED|UNAUTHORIZED|NOT_FOUND|ACCESS_DENIED|BINDING_REQUIRED)$/i
    .test((error && error.code) || '')
}

function safeOption(value) {
  if (typeof value !== 'string') return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

Page({
  data: {
    navTitle: '查看作业',
    kind: 'work',
    dateLabel: '',
    statusBar: 20,
    navHeight: 66,
    studentName: '',
    role: '',
    loading: true,
    needsBinding: false,
    error: '',
    retryable: false,
    previewing: false,
    assignments: [],
    hasMore: false,
    loadingMore: false,
    moreError: '',
    feedback: null,
  },

  onLoad(options = {}) {
    const {topInset, navHeight} = getNavigationInsets()
    const kind = safeOption(options.kind) === 'feedback' ? 'feedback' : 'work'
    const date = safeOption(options.date)
    const studentId = safeOption(options.studentId)
    const organizationId = safeOption(options.org)
    const validStudent = options.studentId === undefined || /^[a-f0-9]{32}$/.test(studentId)
    const validOrganization = options.org === undefined || /^[a-zA-Z0-9_-]{1,64}$/.test(organizationId)
    this._scope = parseDate(date) && validStudent && validOrganization ? {date, studentId, kind, organizationId} : null
    this._disposed = false
    this._sequence = 0
    this.setData({
      kind,
      navTitle: kind === 'feedback' ? '作业反馈' : '查看作业',
      dateLabel: dateLabel(date),
      statusBar: topInset || 20,
      navHeight: topInset + navHeight,
    })
  },

  onShow() {
    return this.loadDetail()
  },

  onUnload() {
    this._disposed = true
  },

  async loadDetail() {
    if (!this._scope) {
      this.setData({loading: false, error: '这条作业记录链接无效，请从首页重新打开。'})
      return
    }

    const sequence = ++this._sequence
    const scope = this._scope
    const stale = () => this._disposed || sequence !== this._sequence
    this._studentId = ''
    this._workPage = 0
    this.setData({
      loading: true, needsBinding: false, error: '', retryable: false, previewing: false,
      studentName: '', assignments: [], hasMore: false, loadingMore: false, moreError: '', feedback: null,
    })
    try {
      const app = getApp()
      let session = await app.ensureSession({refresh: true})
      if (stale()) return
      if (scope.organizationId && session?.organization && session.organization.id !== scope.organizationId) {
        session = await app.changeContext('selectOrganization', {organizationId: scope.organizationId})
        if (stale()) return
      }
      const role = session && session.role
      const student = session && session.student
      const organizationId = session?.organization?.id
      this.setData({role: role || ''})
      if (!role || role === 'guest' || !organizationId || (role === 'parent' && !student)) {
        this.setData({loading: false, needsBinding: true})
        return
      }
      const studentId = scope.studentId || (student && student.id)
      const target = role === 'parent' ? (session.students || [student]).find((child) => child?.id === studentId) : null
      if ((scope.organizationId && scope.organizationId !== organizationId) || !studentId
        || (role === 'parent' && !target) || (!staffRole(role) && role !== 'parent')) {
        this.setData({loading: false, error: NO_ACCESS})
        return
      }

      const work = scope.kind === 'work'
      const day = await request('getDay', {
        date: scope.date, studentId, section: work ? 'assignments' : 'feedback',
        ...(work ? {page: 1, pageSize: PAGE_SIZE} : {}),
      })
      if (stale()) return
      this._studentId = studentId
      this._organizationId = organizationId
      this._workPage = work ? 1 : 0
      this.setData({
        studentName: day.student?.name || target?.name || '',
        assignments: work ? day.assignments || [] : [],
        hasMore: work && day.hasMore === true,
        feedback: work ? null : day.feedback || null,
        loading: false,
      })
    } catch (error) {
      if (stale()) return
      const unauthorized = accessDenied(error)
      this.setData({
        loading: false,
        error: unauthorized
          ? NO_ACCESS
          : (error && error.message) || '暂时无法读取此记录，请重试。',
        retryable: !unauthorized,
      })
    }
  },

  async loadMoreAssignments() {
    const {loading, loadingMore, previewing, hasMore} = this.data
    if (loading || loadingMore || previewing || !hasMore || !this._studentId) return
    const sequence = this._sequence
    const current = () => !this._disposed && sequence === this._sequence
    const page = this._workPage + 1
    this.setData({loadingMore: true, moreError: ''})
    try {
      if (getApp().globalData.session?.organization?.id !== this._organizationId) {
        this._studentId = ''
        this.setData({error: OTHER_ORGANIZATION, retryable: true, studentName: '', assignments: [], hasMore: false})
        return
      }
      const day = await request('getDay', {
        date: this._scope.date, studentId: this._studentId, section: 'assignments', page, pageSize: PAGE_SIZE,
      })
      if (!current()) return
      const assignments = [...new Map([...this.data.assignments, ...day.assignments].map(item => [item.id, item])).values()]
      this._workPage = page
      this.setData({assignments, hasMore: day.hasMore === true})
    } catch (error) {
      if (!current()) return
      const changed = error.code === 'ORG_CHANGED'
      if (changed || accessDenied(error)) {
        this._studentId = ''
        this.setData({error: changed ? error.message : NO_ACCESS, retryable: changed, studentName: '', assignments: [], hasMore: false})
      } else {
        this.setData({moreError: error.message || '加载更多失败，请重试。'})
      }
    } finally {
      if (current()) this.setData({loadingMore: false})
    }
  },

  photoFrom(event) {
    const {assignment} = event.currentTarget.dataset
    const {index, key} = event.detail
    const feedback = this.data.kind === 'feedback'
    const entry = feedback
      ? this.data.feedback
      : this.data.assignments[Number(assignment)]
    const photo = entry?.images?.[index]
    return {entry, photo: photo?.id === key ? photo : null}
  },

  async previewPhoto(event) {
    if (this.data.previewing || this.data.loading || !this._studentId) return
    const {entry, photo} = this.photoFrom(event)
    if (!photo) return

    const sequence = this._sequence
    const stale = () => this._disposed || sequence !== this._sequence
    this.setData({previewing: true})
    try {
      if (getApp().globalData.session?.organization?.id !== this._organizationId) {
        this._studentId = ''
        this.setData({error: OTHER_ORGANIZATION, retryable: true, studentName: '', assignments: [], feedback: null})
        return
      }
      const feedback = this.data.kind === 'feedback'
      const day = await request('getDay', {
        date: this._scope.date, studentId: this._studentId, section: feedback ? 'feedback' : 'assignments',
        ...(!feedback ? {assignmentId: entry.id} : {}),
      })
      if (stale()) return
      const latest = feedback
        ? day.feedback
        : (day.assignments || []).find((assignment) => assignment.id === entry.id)
      if (feedback) this.setData({feedback: latest || null})
      else if (latest) this.setData({assignments: this.data.assignments.map(assignment => assignment.id === latest.id ? latest : assignment)})
      const images = (latest && latest.images) || []
      const selected = images.find((item) => item.id === photo.id)
      if (!selected || !selected.url) {
        wx.showToast({title: selected ? '照片暂不可用，请重试' : '照片已更新，请重新选择', icon: 'none'})
        return
      }
      wx.previewImage({
        current: selected.url,
        urls: images.map((item) => item.url).filter(Boolean),
        fail: () => {
          if (!stale()) wx.showToast({title: '照片预览失败，请重试', icon: 'none'})
        },
      })
    } catch (error) {
      if (stale()) return
      if (accessDenied(error) || error.code === 'ORG_CHANGED') {
        this._studentId = ''
        const changed = error.code === 'ORG_CHANGED'
        this.setData({error: changed ? error.message : NO_ACCESS, retryable: changed, studentName: '', assignments: [], feedback: null})
      } else {
        wx.showToast({title: '照片加载失败，请重试', icon: 'none'})
      }
    } finally {
      if (!stale()) this.setData({previewing: false})
    }
  },

  openEntry() {
    wx.reLaunch({url: '/pages/index/index'})
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
    } else if (this.data.role && this.data.role !== 'guest' && !this.data.needsBinding) {
      wx.switchTab({url: '/pages/home/index'})
    } else {
      this.openEntry()
    }
  },
})
