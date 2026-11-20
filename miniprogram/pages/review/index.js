const { request } = require('../../utils/api')
const { formatGrade } = require('../profile/fields')

const PAGE_SIZE = 15
const STATUS_LABELS = { pending: '待审核', approved: '已审核', active: '已办理', rejected: '已拒绝' }
const DENIED = '当前账号没有此机构的审核权限，请联系管理员。'
const NO_CONTEXT = ['NOT_BOUND', 'UNAUTHENTICATED', 'ORG_CHANGED', 'REVIEW_FORBIDDEN']
const APPROVAL_OPTIONS = [
  { id: 'approve', label: '绑定到已有档案' },
  { id: 'new', label: '创建并绑定新生' },
  { id: 'reject', label: '拒绝申请' },
]
const TEACHER_OPTIONS = [
  { id: 'approve', label: '通过并绑定微信' },
  { id: 'reject', label: '拒绝申请' },
]

function presentRequest(item) {
  const teacher = item.type === 'teacher'
  const applicant = teacher ? item.teacher || {} : item.student || {}
  const parent = item.parent || {}
  return {
    id: item.id,
    status: item.status,
    candidates: item.candidates || [],
    teacherRequest: teacher,
    typeLabel: teacher ? '教师登记' : '家长绑定',
    statusLabel: STATUS_LABELS[item.status] || '待确认',
    actionable: item.status === 'pending' || item.status === 'approved',
    name: applicant.name || '未填写姓名',
    meta: teacher ? applicant.phone : [applicant.school, formatGrade(applicant.grade)].filter(Boolean).join(' · '),
    facts: teacher
      ? [{ label: '联系电话', value: applicant.phone }]
      : [
        { label: '年龄', value: applicant.age == null ? '' : `${applicant.age} 岁` },
        { label: '学校', value: applicant.school },
        { label: '年级', value: formatGrade(applicant.grade) },
        { label: '家长姓名', value: parent.guardianName },
        { label: '与孩子关系', value: parent.relationship },
        { label: '联系电话', value: [parent.contact1, parent.contact2].filter(Boolean).join(' · ') },
        ...(item.candidates?.length ? [{ label: '可能重复的档案', value: `${item.candidates.length} 份` }] : []),
      ],
  }
}

function presentOption(item, teacherRequest, candidates) {
  const id = teacherRequest ? item.openid : item.id
  return {
    id,
    name: item.name,
    meta: teacherRequest ? item.phone : [item.school, formatGrade(item.grade), item.age == null ? '' : `${item.age} 岁`]
      .filter(Boolean).join(' · '),
    matched: candidates.has(id),
  }
}

Page({
  data: {
    organizationName: '',
    loading: true, error: '', denied: false,
    items: [], total: 0, hasMore: false, loadingMore: false, moreError: '',
    active: null, decisions: [], decision: '', target: null, suggestions: [],
    search: '', options: [], optionsLoading: false, optionsHasMore: false, optionsError: '',
    saving: false, formError: '',
  },

  onLoad(query = {}) {
    this._organizationId = typeof query.org === 'string' ? query.org : ''
    this._listSequence = 0
    this._optionsSequence = 0
  },

  onShow() {
    if (!this.data.saving) return this.loadRequests()
  },

  onUnload() {
    this._closed = true
    clearTimeout(this._searchTimer)
  },

  async onPullDownRefresh() {
    try {
      if (!this.data.saving) await this.loadRequests()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  checkError(error) {
    if (!NO_CONTEXT.includes(error?.code)) return false
    ++this._listSequence
    this.closeReview()
    this.setData({ denied: true, loading: false, error: DENIED, items: [], total: 0, hasMore: false, loadingMore: false })
    return true
  },

  async loadRequests() {
    if (this.data.saving) return
    const sequence = ++this._listSequence
    this.closeReview()
    this.setData({ loading: true, error: '', denied: false, items: [], total: 0, hasMore: false, loadingMore: false, moreError: '' })
    try {
      const session = await getApp().ensureSession({ refresh: true })
      if (this._closed || this._listSequence !== sequence) return
      const org = session?.organization
      if (!org || session.role !== 'teacher' || session.teacher?.canReviewEnrollment !== true
        || (this._organizationId && this._organizationId !== org.id)) {
        this.setData({ denied: true, loading: false, error: DENIED })
        return
      }
      this._organizationId = org.id
      this.setData({ organizationName: org.name })
      await this.loadRequestPage(1, sequence)
    } catch (error) {
      if (!this._closed && this._listSequence === sequence && !this.checkError(error)) {
        this.setData({ loading: false, error: error.message || '审核列表加载失败，请重试。' })
      }
    }
  },

  async loadRequestPage(page, sequence) {
    const more = page > 1
    if (more) this.setData({ loadingMore: true, moreError: '' })
    try {
      const result = await request('listEnrollmentRequests', { page, pageSize: PAGE_SIZE })
      if (this._closed || this._listSequence !== sequence) return
      const batch = result.items.map(presentRequest)
        .sort((first, second) => Number(second.status === 'pending') - Number(first.status === 'pending'))
      const items = [...(more ? this.data.items : []), ...batch]
      this._requestPage = page
      this.setData({ items: [...new Map(items.map(item => [item.id, item])).values()], total: result.total, hasMore: result.hasMore === true })
    } catch (error) {
      if (this._closed || this._listSequence !== sequence || this.checkError(error)) return
      this.setData({ [more ? 'moreError' : 'error']: error.message || '审核列表加载失败，请重试。' })
    } finally {
      if (!this._closed && this._listSequence === sequence) this.setData(more ? { loadingMore: false } : { loading: false })
    }
  },

  loadMoreRequests() {
    if (!this.data.loading && !this.data.loadingMore && !this.data.active && this.data.hasMore) {
      return this.loadRequestPage(this._requestPage + 1, this._listSequence)
    }
  },

  onReachBottom() {
    return this.loadMoreRequests()
  },

  openReview(event) {
    if (this.data.denied || this.data.active || this.data.loading) return
    const active = this.data.items.find(item => item.id === event.currentTarget.dataset.id)
    if (!active) return
    const candidates = active.candidates || []
    this._candidateIds = new Set(candidates.map(item => item.id))
    this.setData({
      active,
      decisions: active.teacherRequest ? TEACHER_OPTIONS : APPROVAL_OPTIONS,
      suggestions: candidates.slice(0, 3).map(item => presentOption(item, false, this._candidateIds)),
      decision: '', target: null, formError: '', search: '', options: [], optionsError: '',
    })
  },

  closeReview() {
    if (this.data.saving) return
    clearTimeout(this._searchTimer)
    ++this._optionsSequence
    this.setData({
      active: null, decisions: [], decision: '', target: null, suggestions: [], formError: '',
      search: '', optionsLoading: false, optionsHasMore: false, options: [], optionsError: '',
    })
  },

  preventScroll() {},

  chooseDecision(event) {
    const decision = event.currentTarget.dataset.id
    const { active, saving, decisions } = this.data
    if (!active?.actionable || saving || decision === this.data.decision || !decisions.some(item => item.id === decision)) return
    clearTimeout(this._searchTimer)
    ++this._optionsSequence
    this.setData({ decision, target: null, formError: '', search: '', options: [], optionsError: '', optionsLoading: false, optionsHasMore: false })
    if (decision === 'approve') return this.loadOptions()
  },

  searchOptions(event) {
    if (this.data.decision !== 'approve' || this.data.saving) return
    clearTimeout(this._searchTimer)
    ++this._optionsSequence
    this.setData({ search: event.detail.value, options: [], optionsLoading: true, optionsHasMore: false, optionsError: '' })
    this._searchTimer = setTimeout(() => this.loadOptions(), 250)
  },

  async loadOptions(page = 1) {
    const { active, decision, search } = this.data
    if (!active?.actionable || decision !== 'approve' || this.data.saving) return
    const sequence = ++this._optionsSequence
    const current = () => !this._closed && sequence === this._optionsSequence
    this.setData({ optionsLoading: true, optionsError: '' })
    try {
      const result = await request('listEnrollmentOptions', {
        kind: active.teacherRequest ? 'teachers' : 'students', page, pageSize: PAGE_SIZE, search: search.trim(),
      })
      if (!current()) return
      const options = result.items.map(item => presentOption(item, active.teacherRequest, this._candidateIds))
      if (active.teacherRequest && active.meta) {
        for (const option of options) option.matched = option.name === active.name && option.meta === active.meta
      }
      this._optionPage = page
      const combined = [...(page === 1 ? [] : this.data.options), ...options]
      this.setData({
        options: [...new Map(combined.map(option => [option.id, option])).values()], optionsHasMore: result.hasMore === true,
      })
    } catch (error) {
      if (current() && !this.checkError(error)) this.setData({ optionsError: error.message || '档案加载失败，请重试。' })
    } finally {
      if (current()) this.setData({ optionsLoading: false })
    }
  },

  moreOptions() {
    if (!this.data.optionsLoading && this.data.optionsHasMore) return this.loadOptions(this._optionPage + 1)
  },

  retryOptions() {
    return this.loadOptions(this.data.options.length ? this._optionPage + 1 : 1)
  },

  chooseTarget(event) {
    const { id, create } = event.currentTarget.dataset
    const { active, decision, saving, options, suggestions } = this.data
    if (!active || decision !== 'approve' || saving) return
    const target = active.teacherRequest && create
      ? { id: '', name: '创建新教师档案' }
      : [...options, ...suggestions].find(item => item.id === id)
    if (target) this.setData({ target, formError: '' })
  },

  confirmReview() {
    const { active, decision, target, saving } = this.data
    if (!active?.actionable || saving || this._confirming) return
    if (!decision || (decision === 'approve' && !target)) {
      this.setData({ formError: !decision ? '请选择审核结果。' : '请选择要关联的档案。' })
      return
    }
    const content = decision === 'reject'
      ? `拒绝「${active.name}」的申请？`
      : target?.id
        ? `将这条申请关联到「${target.name}」？`
        : `为「${active.name}」创建档案并绑定微信？`
    this._confirming = true
    wx.showModal({
      title: decision === 'reject' ? '确认拒绝' : '确认通过', content,
      confirmText: decision === 'reject' ? '拒绝' : '通过',
      success: ({ confirm }) => {
        if (confirm && !this._closed && this.data.active?.id === active.id && this.data.decision === decision) {
          void this.submitReview(active, decision, target)
        }
      },
      complete: () => { this._confirming = false },
    })
  },

  async submitReview(active, decision, target) {
    this.setData({ saving: true, formError: '' })
    try {
      await request('resolveEnrollmentRequest', {
        requestId: active.id, decision,
        ...(decision === 'approve' ? (active.teacherRequest ? { teacherId: target.id } : { studentId: target.id }) : {}),
      })
      if (this._closed) return
      this.setData({ saving: false })
      wx.showToast({ title: '审核已提交', icon: 'success' })
      await this.loadRequests()
    } catch (error) {
      if (this._closed) return
      this.setData({ saving: false })
      if (!this.checkError(error)) this.setData({ formError: error.message || '审核提交失败，请重试。' })
    }
  },

  goBack() {
    const profile = () => wx.switchTab({ url: '/pages/profile/index' })
    if (getCurrentPages().length > 1) wx.navigateBack({ fail: profile })
    else profile()
  },
})
