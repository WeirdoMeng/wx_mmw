const { request } = require('../../utils/api')
const { getNavigationInsets, syncTab, resetHome } = require('../../utils/navigation')
const { GRADES, FIELDS, CHILD_FIELDS, PARENT_FIELDS, toForm, toStudent, toParent, onFieldInput } = require('./fields')

const PAGE_SIZE = 10

function appendById(previous, items) {
  return [...new Map(previous.concat(items).map(item => [item.id, item])).values()]
}

function profileRows(student) {
  const values = toForm(student)
  return FIELDS.filter(({ key }) => key !== 'name').map(({ key, label }) => ({
    key,
    label,
    value: key === 'age' && values[key] !== ''
      ? values[key] + ' 岁'
      : values[key] || (key === 'contact2' ? '选填' : '—')
  }))
}

Page({
  onFieldInput,

  data: {
    topInset: 20,
    menuHeight: 44,
    menuWidth: 80,
    role: '',
    organizationId: '',
    organizationName: '托管中心',
    organizations: [],
    organizationsPage: 0,
    organizationsTotal: 0,
    organizationsHasMore: false,
    organizationsLoading: false,
    choosingOrganization: false,
    switchingOrganization: false,
    organizationError: '',
    switchError: '',
    loading: true,
    error: '',
    children: [],
    childrenPage: 0,
    childrenHasMore: false,
    childrenLoading: false,
    childrenError: '',
    teacher: null,
    childFields: CHILD_FIELDS,
    parentFields: PARENT_FIELDS,
    grades: ['请选择年级', ...GRADES],
    gradeIndex: 0,
    form: {},
    editing: false,
    editingStudentId: '',
    editingStudentName: '',
    saving: false,
    formError: ''
  },

  onLoad() {
    const { topInset, navHeight, menuWidth } = getNavigationInsets()
    this.setData({ topInset, menuHeight: navHeight, menuWidth })
  },

  async onShow() {
    const loadId = (this._loadId || 0) + 1
    this._loadId = loadId
    const app = getApp()
    const current = app.globalData.session
    const sameContext = current?.organization?.id === this.data.organizationId && current?.role === this.data.role
    syncTab(this, 2, current?.organization ? current.role : 'guest',
      Boolean(sameContext && (this.data.editing || this.data.choosingOrganization)))
    const emptyLists = {
      organizations: [], organizationsPage: 0, organizationsTotal: 0, organizationsHasMore: false,
      children: [], childrenPage: 0, childrenHasMore: false,
    }
    this.setData({
      organizationsLoading: false, organizationError: '', childrenLoading: false, childrenError: '',
      ...(!sameContext ? { ...emptyLists, loading: true, error: '',
        role: '', organizationName: current?.organization?.name || '托管中心',
        teacher: null, editing: false, choosingOrganization: false } : {}),
    })
    try {
      const session = await app.ensureSession({ refresh: true })
      if (this._loadId !== loadId) return
      const { role, organization } = session
      if (role === 'guest' || !organization) {
        this.setData({ role: '', children: [], teacher: null, organizationId: '', organizationName: '托管中心', form: {} })
        wx.reLaunch({ url: '/pages/index/index' })
        return
      }

      const changed = this.data.organizationId !== organization.id || this.data.role !== role
      const invalidEditor = this.data.editing && !session.students?.some(child => child.id === this.data.editingStudentId)
      this.setData({
        ...(changed ? emptyLists : {}),
        role,
        organizationId: organization.id,
        organizationName: organization.name,
        ...(changed || invalidEditor ? { form: {}, editing: false, editingStudentId: '', editingStudentName: '', saving: false,
          choosingOrganization: false, switchingOrganization: false, switchError: '' } : {}),
        teacher: role === 'teacher' ? session.teacher || null : null,
        loading: false,
        error: ''
      })
      syncTab(this, 2, role, this.data.editing || this.data.choosingOrganization)
      await Promise.all([
        this.loadOrganizations(loadId),
        role === 'parent' ? this.loadChildren(loadId) : undefined,
      ])
    } catch (error) {
      if (this._loadId === loadId) this.setData({ loading: false, error: error.message })
    }
  },

  onUnload() {
    this._loadId = 0
  },

  async loadChildren(loadId = this._loadId, append = false) {
    if (!loadId || loadId !== this._loadId || this.data.role !== 'parent' || this.data.childrenLoading) return
    if (append && !this.data.childrenHasMore) return
    const page = append ? this.data.childrenPage + 1 : 1
    this.setData({ childrenLoading: true, childrenError: '' })
    try {
      const result = await request('listLinkedStudents', { page, pageSize: PAGE_SIZE })
      if (this._loadId !== loadId) return
      const items = result.items.map(student => ({ ...student, rows: profileRows(student) }))
      this.setData({
        children: append ? appendById(this.data.children, items) : items,
        childrenPage: result.page,
        childrenHasMore: result.hasMore,
      })
    } catch (error) {
      if (this._loadId === loadId) this.setData({ childrenError: error.message })
    } finally {
      if (this._loadId === loadId) this.setData({ childrenLoading: false })
    }
  },

  onRetryChildren() {
    return this.loadChildren()
  },

  onLoadMoreChildren() {
    return this.loadChildren(this._loadId, true)
  },

  async loadOrganizations(loadId = this._loadId, append = false) {
    if (!loadId || loadId !== this._loadId || this.data.organizationsLoading) return
    if (append && (!this.data.organizationsHasMore || this.data.switchingOrganization)) return
    const page = append ? this.data.organizationsPage + 1 : 1
    this.setData({ organizationsLoading: true, organizationError: '' })
    try {
      const result = await request('listOrganizations', { page, pageSize: PAGE_SIZE })
      if (this._loadId !== loadId) return
      this.setData({
        organizations: append ? appendById(this.data.organizations, result.items) : result.items,
        organizationsPage: result.page,
        organizationsTotal: result.total,
        organizationsHasMore: result.hasMore,
      })
    } catch (error) {
      if (this._loadId === loadId) this.setData({ organizationError: error.message })
    } finally {
      if (this._loadId === loadId) this.setData({ organizationsLoading: false })
    }
  },

  onRetryOrganizations() {
    return this.loadOrganizations()
  },

  onLoadMoreOrganizations() {
    return this.loadOrganizations(this._loadId, true)
  },

  onChooseOrganization() {
    if (this.data.loading || this.data.error || this.data.editing || this.data.organizationsTotal < 2) return
    if (typeof this.getTabBar === 'function') this.getTabBar()?.setData({ hidden: true })
    this.setData({ choosingOrganization: true, switchError: '' })
  },

  onCloseOrganizations() {
    if (this.data.switchingOrganization) return
    this.setData({ choosingOrganization: false, switchError: '' })
    syncTab(this, 2, this.data.role)
  },

  async onSelectOrganization(event) {
    const { id } = event.currentTarget.dataset
    if (!this.data.choosingOrganization || this.data.switchingOrganization || !this.data.organizations.some((item) => item.id === id)) return
    if (id === this.data.organizationId) {
      this.onCloseOrganizations()
      return
    }
    this.setData({ switchingOrganization: true, switchError: '' })
    try {
      await getApp().changeContext('selectOrganization', { organizationId: id })
      if (this._loadId) resetHome()
    } catch (error) {
      if (this._loadId) this.setData({ switchingOrganization: false, switchError: error.message })
    }
  },

  onEdit(event) {
    const { role, children, editing } = this.data
    if (role !== 'parent' || editing) return
    const student = children.find(child => child.id === event.currentTarget.dataset.id)
    if (!student) return
    if (typeof this.getTabBar === 'function') this.getTabBar()?.setData({ hidden: true })
    const form = toForm(student)
    this._initialProfile = form
    this.setData({
      form: { ...form }, gradeIndex: GRADES.indexOf(form.grade) + 1,
      editing: true, editingStudentId: student.id, editingStudentName: student.name, formError: ''
    })
  },

  onGradeChange(event) {
    if (this.data.saving) return
    const gradeIndex = Number(event.detail.value)
    if (Number.isInteger(gradeIndex) && this.data.grades[gradeIndex]) {
      this.setData({ gradeIndex, 'form.grade': GRADES[gradeIndex - 1] || '' })
    }
  },

  onCloseEdit() {
    if (this.data.saving) return
    this.setData({ editing: false, editingStudentId: '', editingStudentName: '' })
    syncTab(this, 2, this.data.role)
  },

  async onSave() {
    if (!this.data.editing || this.data.saving) return
    const { organizationId, editingStudentId } = this.data
    const app = getApp()
    const session = app.globalData.session
    if (session?.organization?.id !== organizationId || session.role !== 'parent'
      || !session.students?.some(child => child.id === editingStudentId)) {
      this.setData({ formError: '当前绑定已变更，请刷新页面后重试。' })
      return
    }
    const stillEditing = () => this._loadId && this.data.organizationId === organizationId
      && this.data.editingStudentId === editingStudentId
    try {
      const { form } = this.data
      const initial = this._initialProfile
      const preserveGrade = form.grade === initial.grade && !GRADES.includes(form.grade)
      const details = toStudent(form, { preserveGrade })
      const parent = toParent(form)
      const studentPatch = Object.fromEntries(
        Object.entries(details).filter(([key, value]) => String(value) !== initial[key])
      )
      this.setData({ saving: true, formError: '' })
      const { student } = await request('saveProfile', {
        studentId: editingStudentId, student: studentPatch, parent
      })
      if (!stillEditing()) return
      const children = this.data.children.map(child => child.id === editingStudentId
        ? { ...student, rows: profileRows(student) } : child)
      this.setData({ children, saving: false, editing: false, editingStudentId: '', editingStudentName: '' })
      syncTab(this, 2, this.data.role)
      wx.showToast({ title: '资料已保存', icon: 'success' })
      app.ensureSession({ refresh: true }).catch(() => {})
    } catch (error) {
      if (stillEditing()) this.setData({ saving: false, formError: error.message })
    }
  },

  onOpenStudents() {
    if (this.data.role === 'teacher') wx.navigateTo({ url: '/pages/students/index' })
  },

  onOpenReview() {
    const { role, teacher, organizationId } = this.data
    if (role === 'teacher' && teacher?.canReviewEnrollment === true && organizationId) {
      wx.navigateTo({ url: '/pages/review/index?org=' + encodeURIComponent(organizationId) })
    }
  },

  onOpenFinance() {
    const { role, teacher, organizationId } = this.data
    if (role === 'teacher' && teacher?.canManageFinance === true && organizationId) {
      wx.navigateTo({ url: '/pages/finance/index?org=' + encodeURIComponent(organizationId) })
    }
  },

  onOpenMealExpenses() {
    const { role, teacher, organizationId } = this.data
    if (role === 'teacher' && teacher?.canManageMealExpenses === true && organizationId) {
      wx.navigateTo({ url: '/pages/meal-expenses/index?org=' + encodeURIComponent(organizationId) })
    }
  },

  onAddChild() {
    const { role, organizationId } = this.data
    if (role === 'parent' && organizationId) {
      wx.navigateTo({ url: '/pages/register/index?organizationId=' + encodeURIComponent(organizationId) })
    }
  }
})
