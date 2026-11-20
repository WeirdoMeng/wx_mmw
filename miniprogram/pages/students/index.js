const { request } = require('../../utils/api')
const { formatGrade, validPhone } = require('../profile/fields')

const PAGE_SIZE = 15

function cardFor({ id, name, grade, school }) {
  return { id, name, grade: formatGrade(grade), school, initial: (name || '学').slice(0, 1) }
}

function hasContact(contact) {
  return Boolean(contact && (contact.guardianName || contact.relationship || contact.contact1 || contact.contact2))
}

function phoneForDial(value) {
  const number = typeof value === 'string' ? value.replace(/[\s-]/g, '') : ''
  return validPhone(number) ? number : ''
}

function contactForDisplay(contact) {
  return { ...contact, dial1: phoneForDial(contact.contact1), dial2: phoneForDial(contact.contact2) }
}

Page({
  data: {
    students: [],
    studentsTotal: 0,
    studentsHasMore: false,
    studentsMoreLoading: false,
    studentsMoreError: '',
    query: '',
    loading: true,
    error: '',
    activeId: '',
    activeName: '',
    parents: [],
    fallbackContact: null,
    detailLoading: false,
    detailError: '',
    parentsTotal: 0,
    parentsHasMore: false,
    parentsMoreLoading: false,
    parentsMoreError: '',
  },

  onShow() {
    return this.loadStudents()
  },

  onUnload() {
    this._loadId = 0
    this._studentRequest = 0
    clearTimeout(this._searchTimer)
  },

  async loadStudents() {
    const loadId = (this._loadId || 0) + 1
    this._loadId = loadId
    this._studentPage = 0
    this.setData({
      loading: true, error: '', students: [], studentsTotal: 0,
      studentsHasMore: false, studentsMoreLoading: false, studentsMoreError: '',
    })
    try {
      const { role, organization } = await getApp().ensureSession({ refresh: true })
      if (this._loadId !== loadId) return
      if (role === 'guest' || !organization) {
        wx.reLaunch({ url: '/pages/index/index' })
        return
      }
      if (role !== 'teacher') {
        wx.switchTab({ url: '/pages/profile/index' })
        return
      }
      if (this._organizationId !== organization.id) {
        this._organizationId = organization.id
        this.onCloseStudent()
        this.setData({ query: '' })
      }
      const loaded = await this.loadStudentPage(1, loadId)
      if (loaded && this._loadId === loadId && this.data.activeId) {
        await this.loadStudentDetails({ id: this.data.activeId, name: this.data.activeName })
      }
    } catch (error) {
      if (this._loadId === loadId) this.setData({ loading: false, error: error.message })
    }
  },

  async loadStudentPage(page, loadId = this._loadId) {
    const organizationId = this._organizationId
    const relevant = () => this._loadId === loadId && getApp().globalData.session?.organization?.id === organizationId
    const first = page === 1
    if (!first) this.setData({ studentsMoreLoading: true, studentsMoreError: '' })
    try {
      const result = await request('listStudents', { page, pageSize: PAGE_SIZE, query: this.data.query.trim() })
      if (!relevant()) return false
      const previous = first ? [] : this.data.students
      const students = [...new Map([...previous, ...result.items.map(cardFor)].map(student => [student.id, student])).values()]
      this._studentPage = page
      this.setData({ students, studentsTotal: result.total ?? students.length, studentsHasMore: result.hasMore === true })
      return true
    } catch (error) {
      if (relevant()) this.setData({ [first ? 'error' : 'studentsMoreError']: error.message })
      return false
    } finally {
      if (relevant()) this.setData(first ? { loading: false } : { studentsMoreLoading: false })
    }
  },

  onSearch(event) {
    const query = event.detail.value
    if (query === this.data.query) return
    clearTimeout(this._searchTimer)
    this._loadId = (this._loadId || 0) + 1
    this.setData({ query, loading: true, error: '', students: [], studentsHasMore: false, studentsMoreError: '' })
    this._searchTimer = setTimeout(() => this.loadStudents(), 220)
  },

  onLoadMoreStudents() {
    if (!this.data.activeId && !this.data.loading && !this.data.studentsMoreLoading && this.data.studentsHasMore) {
      return this.loadStudentPage(this._studentPage + 1)
    }
  },

  onOpenStudent(event) {
    const target = !this.data.activeId && this.data.students.find((item) => item.id === event.currentTarget.dataset.id)
    if (target) return this.loadStudentDetails(target)
  },

  async loadStudentDetails({ id, name }) {
    const sequence = (this._studentRequest || 0) + 1
    this._studentRequest = sequence
    this._parentPage = 0
    this.setData({
      activeId: id, activeName: name, parents: [], fallbackContact: null, detailLoading: true, detailError: '',
      parentsTotal: 0, parentsHasMore: false, parentsMoreLoading: false, parentsMoreError: '',
    })
    return this.loadParentPage(1)
  },

  async loadParentPage(page) {
    const id = this.data.activeId
    const sequence = this._studentRequest
    const organizationId = this._organizationId
    const relevant = () => this._studentRequest === sequence && this.data.activeId === id
      && getApp().globalData.session?.organization?.id === organizationId
    const first = page === 1
    if (!first) this.setData({ parentsMoreLoading: true, parentsMoreError: '' })
    try {
      const { items, contact, total, hasMore } = await request('listStudentParents', { studentId: id, page, pageSize: PAGE_SIZE })
      if (!relevant()) return
      const previous = first ? [] : this.data.parents
      const parents = items.map((parent, index) => ({ ...contactForDisplay(parent), key: previous.length + index }))
      this._parentPage = page
      this.setData({
        parents: [...previous, ...parents],
        fallbackContact: hasContact(contact) ? contactForDisplay(contact) : null,
        parentsTotal: total ?? previous.length + parents.length,
        parentsHasMore: hasMore === true,
      })
    } catch (error) {
      if (relevant()) this.setData({ [first ? 'detailError' : 'parentsMoreError']: error.message })
    } finally {
      if (relevant()) this.setData(first ? { detailLoading: false } : { parentsMoreLoading: false })
    }
  },

  onRetryParents() {
    if (this.data.activeId && !this.data.detailLoading) {
      return this.loadStudentDetails({ id: this.data.activeId, name: this.data.activeName })
    }
  },

  onLoadMoreParents() {
    if (this.data.activeId && !this.data.detailLoading && !this.data.parentsMoreLoading && this.data.parentsHasMore) {
      return this.loadParentPage(this._parentPage + 1)
    }
  },

  onDialContact(event) {
    const number = phoneForDial(event.currentTarget.dataset.number)
    const session = getApp().globalData.session
    if (!number || !this.data.activeId || session?.role !== 'teacher' ||
        session.organization?.id !== this._organizationId) return

    wx.makePhoneCall({
      phoneNumber: number,
      fail: (error) => {
        if (!/cancel/i.test(error?.errMsg || '')) wx.showToast({ title: '无法打开拨号，请稍后重试', icon: 'none' })
      },
    })
  },

  onCloseStudent() {
    this._studentRequest = (this._studentRequest || 0) + 1
    this.setData({ activeId: '', activeName: '', parents: [], fallbackContact: null, detailLoading: false, detailError: '' })
  },
})
