const { request, rememberOrganization, ServiceError } = require('./utils/api')
const { configureLocalDebug } = require('./utils/local-debug')
const CHILD_STORAGE_PREFIX = 'mmw.student.'

App({
  globalData: { session: null },

  onLaunch(options) {
    configureLocalDebug(options?.query)
  },

  onShow(options) {
    if (!configureLocalDebug(options?.query)) return
    this._requestAuth = null
    if (this.globalData.session || this._pendingSession) {
      this._pendingSession = null
      this.setSession(null)
    }
  },

  getRequestScope() {
    return {
      id: this.globalData.session?.organization?.id || '',
      revision: this._organizationRevision || 0,
    }
  },

  getRequestAuth() {
    if (!this._requestAuth) this._requestAuth = { token: '', pendingLogin: null }
    return this._requestAuth
  },

  setSession(session) {
    const previous = this.globalData.session
    if (session?.role === 'parent' && session.organization?.id) {
      const students = Array.isArray(session.students) ? session.students : (session.student ? [session.student] : [])
      const key = CHILD_STORAGE_PREFIX + session.organization.id
      let remembered = previous?.organization?.id === session.organization.id && previous.student?.id
      if (!remembered) {
        try { remembered = wx.getStorageSync(key) } catch {}
      }
      const child = students.find(({ id }) => id === remembered) || students[0] || null
      session = { ...session, students, student: child }
      if (previous?.organization?.id !== session.organization.id || previous.student?.id !== child?.id) {
        try {
          if (child) wx.setStorageSync(key, child.id)
          else wx.removeStorageSync(key)
        } catch {}
      }
    }
    if (previous?.organization?.id !== session?.organization?.id
      || previous?.role !== session?.role || previous?.student?.id !== session?.student?.id) {
      this._organizationRevision = (this._organizationRevision || 0) + 1
    }
    this._sessionRevision = (this._sessionRevision || 0) + 1
    this.globalData.session = session
    if (!previous || previous.organization?.id !== session?.organization?.id) {
      rememberOrganization(session?.organization?.id || '')
    }
    return session
  },

  selectStudent(studentId) {
    const session = this.globalData.session
    const target = !this._pendingContext && session?.role === 'parent' && session.students?.find((item) => item.id === studentId)
    if (!target) return null
    try { wx.setStorageSync(CHILD_STORAGE_PREFIX + session.organization.id, target.id) } catch {}
    // The selected child is part of the scope used to reject stale asynchronous results.
    if (session.student?.id !== target.id) this._organizationRevision = (this._organizationRevision || 0) + 1
    this.globalData.session = { ...session, student: target }
    return target
  },

  ensureSession({ refresh = false } = {}) {
    if (this._pendingContext) return this._pendingContext
    if (this.globalData.session && !refresh) return Promise.resolve(this.globalData.session)
    if (this._pendingSession) return this._pendingSession

    const revision = this._sessionRevision
    const reading = request('getSession')
    this._pendingSessionRequest = reading
    const pending = reading
      .then((session) => {
        if (this._sessionRevision === revision) {
          return this.setSession(session)
        }
        if (this._pendingContext || this.globalData.session) return this._pendingContext || this.globalData.session
        if (this._pendingSession === pending) this._pendingSession = null
        return this.ensureSession()
      })
      .finally(() => {
        if (this._pendingSession === pending) this._pendingSession = null
        if (this._pendingSessionRequest === reading) this._pendingSessionRequest = null
      })
    this._pendingSession = pending
    return pending
  },

  changeContext(action, payload) {
    if (this._pendingContext) {
      return Promise.reject(new ServiceError('ORG_CHANGED', '正在切换机构，请稍候。'))
    }
    // getSession can set a default organization on the server. Let its request finish before changing it explicitly.
    const reading = this._pendingSessionRequest
    this._sessionRevision = (this._sessionRevision || 0) + 1
    this._pendingSession = null
    this._pendingContext = Promise.resolve(reading).catch(() => {})
      .then(() => request(action, payload))
      .then((session) => this.setSession(session))
      .finally(() => { this._pendingContext = null })
    return this._pendingContext
  },
})
