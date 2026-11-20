const {request, uploadImages} = require('../../utils/api')
const {syncTab, getNavigationInsets} = require('../../utils/navigation')
const {shareCardFields} = require('../../utils/share-preview')
const {MAX_PHOTOS, choosePhotos} = require('../../utils/photo-picker')
const {formatGrade} = require('../profile/fields')
const {todayKey, dateLabel, parseDate, calendarDays} = require('../../components/mmw-calendar/date')

const PAGE_SIZE = 15
const SHARE_COVER_TIMEOUT = 2600

function message(error, fallback) {
  return (error && error.message) || fallback
}

function isStaff(role) {
  return role === 'teacher'
}

function displayStudent(student) {
  return {...student, grade: formatGrade(student.grade)}
}

function draftFrom(feedback) {
  return {
    status: feedback ? feedback.status : '',
    note: feedback ? feedback.note || '' : '',
    photos: feedback ? (feedback.images || []).map((photo) => ({...photo, key: 'asset:' + photo.id})) : [],
    dirty: false,
  }
}

function previewFrom(feedback) {
  if (!feedback) return null
  const images = feedback.images || []
  return {
    status: feedback.status,
    note: feedback.note || '',
    count: images.length,
    photos: images.slice(0, 3),
  }
}

async function prepareImages(photos, isCurrent, onUploaded) {
  const result = photos.slice()
  for (const [index, photo] of result.entries()) {
    if (!isCurrent()) return null
    if (photo.id) continue
    const uploaded = await uploadImages([photo.localPath])
    if (!uploaded[0] || !uploaded[0].id) throw new Error('照片尚未完整上传，请重试')
    result[index] = {...photo, ...uploaded[0]}
    onUploaded(result.slice())
  }
  return result
}

function appendPhotos(previous, selected) {
  return [...new Map(previous.concat(selected).map((photo) => [photo.key, photo])).values()].slice(0, MAX_PHOTOS)
}

function detailPath(kind, {studentId, date, organizationId}) {
  return '/pages/work/index?kind=' + encodeURIComponent(kind)
    + '&studentId=' + encodeURIComponent(studentId) + '&date=' + encodeURIComponent(date)
    + '&org=' + encodeURIComponent(organizationId)
}

function homeShareCard() {
  return {
    title: '托管中心',
    path: '/pages/index/index',
    imageUrl: '/images/brand/after-school.png',
  }
}

function makeRequestId() {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12)
}

Page({
  data: {
    role: '',
    organizationName: '托管中心',
    staff: false,
    headerInset: 58,
    date: '',
    dateLabel: '',
    markedDates: [],
    feedbackDates: [],
    student: null,
    students: [],
    sessionLoading: true,
    sessionError: '',
    dayLoading: false,
    dayError: '',
    feedbackPreview: null,
    hasSavedFeedback: false,
    shareRecord: null,
    editorStatus: '',
    editorNote: '',
    editorPhotos: [],
    maxPhotos: MAX_PHOTOS,
    saving: false,
    picking: false,
    sheet: '',
    studentQuery: '',
    filteredStudents: [],
    studentListLoading: false,
    studentListError: '',
    studentListHasMore: false,
    uploadNote: '',
    uploadPhotos: [],
    uploadError: '',
    submitting: false,
  },

  onLoad() {
    this._drafts = new Map()
    this._shareRevision = 0
    this._sessionSequence = 0
    this._daySequence = 0
    this._studentSequence = 0
    this._disposed = false
    const date = todayKey()
    const {topInset, navHeight} = getNavigationInsets()
    this.setData({date, dateLabel: dateLabel(date), headerInset: topInset + navHeight})
  },

  onShow() {
    const session = getApp().globalData.session
    syncTab(this, 0, session?.organization ? session.role : 'guest', Boolean(this.data.sheet))
    if (this.data.sheet || this.data.picking || this.data.saving) {
      return
    }
    return this.loadSession()
  },

  onPullDownRefresh() {
    if (this.data.sheet || this.data.saving || this.data.picking) {
      wx.stopPullDownRefresh()
      return
    }
    return this.loadSession().finally(() => wx.stopPullDownRefresh())
  },

  onUnload() {
    this._disposed = true
    this.finishShareCover(null)
    clearTimeout(this._studentSearchTimer)
    this.setTabHidden(false)
  },

  async loadSession(retryConflict = true) {
    const sequence = ++this._sessionSequence
    ++this._daySequence
    const app = getApp()
    const previous = app.globalData.session
    const sameContext = Boolean(this._organizationId && previous?.organization?.id === this._organizationId
      && previous.role === this.data.role && (this.data.staff || previous.student?.id === this.data.student?.id))
    if (!sameContext || this.data.sessionError) {
      this.finishShareCover(null)
      this._loadedDayKey = null
      this._feedbackSignature = null
      this.setData({sessionLoading: true, sessionError: '', dayError: '', feedbackPreview: null, hasSavedFeedback: false, shareRecord: null,
        ...(!sameContext ? {role: '', staff: false, organizationName: '托管中心'} : {})})
    }
    try {
      const session = await app.ensureSession({refresh: true})
      if (this._disposed || sequence !== this._sessionSequence) return
      if (!session?.organization || session.role === 'guest' || (session.role === 'parent' && !session.student)) {
        wx.reLaunch({url: '/pages/index/index'})
        return
      }
      const staff = isStaff(session.role)
      const organization = session.organization
      const changed = this._organizationId !== organization.id || this.data.role !== session.role
      const childChanged = !staff && this.data.student?.id !== session.student?.id
      const currentId = !changed && this.data.student?.id
      this._organizationId = organization.id
      if (changed) {
        this.finishShareCover(null)
        this._loadedDayKey = null
        this._feedbackSignature = null
        this._drafts.clear()
        this._uploadScope = null
        this._uploadAttempt = null
        this.setData({
          student: null, students: [], filteredStudents: [], sheet: '', uploadNote: '', uploadPhotos: [], uploadError: '',
          editorStatus: '', editorNote: '', editorPhotos: [],
          sessionLoading: true, dayError: '', feedbackPreview: null, hasSavedFeedback: false, shareRecord: null,
        })
      } else if (childChanged) {
        this._loadedDayKey = null
      }
      syncTab(this, 0, session.role)
      this.setData({role: session.role, staff, organizationName: organization.name})
      let students = session.students || []
      let student = session.student
      if (staff) {
        const result = await request('listStudents', {page: 1, pageSize: PAGE_SIZE, selectedStudentId: currentId || undefined})
        if (this._disposed || sequence !== this._sessionSequence) return
        students = result.items || []
        student = result.selectedStudent || students.find((item) => item.id === currentId) || students[0] || null
      }
      students = students.map(displayStudent)
      student = student ? displayStudent(student) : null
      this.setData({students, student, sessionLoading: false})
      await Promise.all([this.loadMarkedDates(true), this.loadDay(retryConflict, !changed && !childChanged)])
    } catch (error) {
      if (!this._disposed && sequence === this._sessionSequence) {
        if (retryConflict && error.code === 'ORG_CHANGED') return this.loadSession(false)
        this.setData({
          sessionLoading: false,
          sessionError: message(error, '暂时无法读取账号信息，请重试'),
          dayLoading: false,
          feedbackPreview: null,
          hasSavedFeedback: false,
          shareRecord: null,
        })
        this._loadedDayKey = null
        this._feedbackSignature = null
      }
    }
  },

  dayScope() {
    const student = this.data.student
    return student ? {studentId: student.id, date: this.data.date, organizationId: this._organizationId} : null
  },

  isCurrent(scope) {
    const current = this.dayScope()
    const session = getApp().globalData.session
    return !this._disposed && current && current.studentId === scope.studentId && current.date === scope.date
      && current.organizationId === scope.organizationId
      && session?.organization?.id === scope.organizationId && session.role === this.data.role
      && (this.data.staff || session.student?.id === scope.studentId)
  },

  draftKey(scope) {
    return scope.studentId + ':' + scope.date
  },

  showDraft(draft) {
    this.setData({
      editorStatus: draft.status,
      editorNote: draft.note,
      editorPhotos: draft.photos,
    })
  },

  rememberSavedFeedback(scope, feedback) {
    const signature = JSON.stringify([scope, feedback?.status, feedback?.note, feedback?.images])
    if (signature === this._feedbackSignature) return
    this._feedbackSignature = signature
    this.finishShareCover(null)
    this._shareScope = null
    this._shareCover = null
    let shareRecord = null
    if (this.data.staff && feedback) {
      const date = dateLabel(scope.date).split(' · ')[0]
      const status = feedback.status === 'done' ? '已完成' : '未完成'
      const summary = (feedback.note || '').replace(/\s+/g, ' ').trim()
      const key = String(++this._shareRevision)
      this._shareScope = scope
      shareRecord = {
        key,
        title: `${this.data.student.name} · ${date} · 作业${status}`,
        summary,
        images: feedback.images || [],
      }
    }
    this.setData({hasSavedFeedback: Boolean(feedback), feedbackPreview: previewFrom(feedback), shareRecord})
  },

  onShareCoverReady({detail}) {
    if (detail.key === this.data.shareRecord?.key && this._shareScope && this.isCurrent(this._shareScope)) {
      this._shareCover = detail
      this.finishShareCover(detail)
    }
  },

  waitForShareCover() {
    if (!this._shareWait) {
      const pending = {}
      pending.promise = new Promise(resolve => { pending.resolve = resolve })
      pending.timer = setTimeout(() => this.finishShareCover(null), SHARE_COVER_TIMEOUT)
      this._shareWait = pending
    }
    return this._shareWait.promise
  },

  finishShareCover(cover) {
    const pending = this._shareWait
    if (!pending) return
    clearTimeout(pending.timer)
    this._shareWait = null
    pending.resolve(cover)
  },

  async loadDay(retryConflict = true, preserve = false) {
    const sequence = ++this._daySequence
    const scope = this.dayScope()
    const key = scope && JSON.stringify(scope)
    const keepDay = preserve && key && key === this._loadedDayKey && !this.data.dayError
    if (!keepDay) {
      this._loadedDayKey = null
      this._feedbackSignature = null
      this.finishShareCover(null)
      this.setData({dayLoading: Boolean(scope), dayError: '', feedbackPreview: null, hasSavedFeedback: false, shareRecord: null})
    }
    if (!scope) return
    const existingDraft = this._drafts.get(this.draftKey(scope))
    if (this.data.staff && !keepDay) this.showDraft(existingDraft || draftFrom(null))

    try {
      const day = await request('getDay', {studentId: scope.studentId, date: scope.date, section: 'summary'}, {feedbackPhotosOnly: true})
      if (!this.isCurrent(scope) || sequence !== this._daySequence) return
      const draftKey = this.draftKey(scope)
      if (this.data.staff) {
        const currentDraft = this._drafts.get(draftKey)
        const draft = currentDraft && currentDraft.dirty ? currentDraft : draftFrom(day.feedback)
        this._drafts.set(draftKey, draft)
        this.showDraft(draft)
      }
      this._loadedDayKey = key
      this.rememberSavedFeedback(scope, day.feedback)
      this.setData({dayLoading: false})
      if (day.feedback) this.markDate(scope.date, true)
      else if (day.hasAssignments || day.assignments?.length) this.markDate(scope.date)
    } catch (error) {
      if (this.isCurrent(scope) && sequence === this._daySequence) {
        if (retryConflict && error.code === 'ORG_CHANGED') return this.loadSession(false)
        this.setData({dayLoading: false, dayError: message(error, '加载作业记录失败，请重试')})
      }
    }
  },

  async loadMarkedDates(refresh = false) {
    const scope = this.dayScope()
    const days = scope ? calendarDays(scope.date, true) : []
    const start = days[0]?.key
    const end = days[days.length - 1]?.key
    const range = scope ? JSON.stringify([scope.organizationId, scope.studentId, start, end]) : ''
    if (range !== this._markedRange) {
      this._markedRange = range
      this._markedRequest = null
      this.setData({markedDates: [], feedbackDates: []})
    }
    if (!scope || (!refresh && this._markedRequest)) return

    const pending = request('listAssignmentDates', {studentId: scope.studentId, start, end})
    this._markedRequest = pending
    try {
      const {dates, feedbackDates = []} = await pending
      if (this._disposed || this._markedRequest !== pending) return
      const markedDates = [...new Set([...this.data.markedDates, ...dates])]
      this.setData({markedDates, feedbackDates: [...new Set([...this.data.feedbackDates, ...feedbackDates])]})
    } catch {
      if (this._markedRequest === pending) this._markedRequest = null
    }
  },

  markDate(date, hasFeedback = false) {
    const {markedDates, feedbackDates} = this.data
    const changes = {}
    if (!markedDates.includes(date)) changes.markedDates = markedDates.concat(date)
    if (hasFeedback && !feedbackDates.includes(date)) changes.feedbackDates = feedbackDates.concat(date)
    if (Object.keys(changes).length) this.setData(changes)
  },

  calendarChanged(event) {
    const date = event.detail.date
    if (this.data.saving || this.data.picking || this.data.submitting || date === this.data.date || !parseDate(date)) return
    this.setData({date, dateLabel: dateLabel(date)})
    return Promise.all([this.loadMarkedDates(), this.loadDay()])
  },

  setTabHidden(hidden) {
    const bar = typeof this.getTabBar === 'function' && this.getTabBar()
    if (bar) bar.setData({hidden})
  },

  openStudentSheet() {
    const {staff, students, saving, picking, submitting, sessionLoading} = this.data
    if ((!staff && students.length < 2) || saving || picking || submitting || sessionLoading) return
    this.setTabHidden(true)
    this.setData({sheet: 'students', studentQuery: ''})
    return this.loadStudentChoices(true)
  },

  filterStudents(event) {
    if (!this.data.staff || this.data.sheet !== 'students') return
    const query = event.detail.value
    if (query === this.data.studentQuery) return
    clearTimeout(this._studentSearchTimer)
    this._studentSequence += 1
    this._studentPage = 0
    this.setData({studentQuery: query, filteredStudents: [], studentListLoading: true, studentListError: '', studentListHasMore: false})
    this._studentSearchTimer = setTimeout(() => this.loadStudentChoices(true), 220)
  },

  async loadStudentChoices(reset = false) {
    if (this.data.sheet !== 'students' || (!reset && (this.data.studentListLoading || !this.data.studentListHasMore))) return
    const page = reset ? 1 : this._studentPage + 1
    const sequence = ++this._studentSequence
    const organizationId = this._organizationId
    const relevant = () => !this._disposed && this.data.sheet === 'students' && sequence === this._studentSequence
      && getApp().globalData.session?.organization?.id === organizationId
    if (reset) this._studentPage = 0
    this.setData({studentListLoading: true, studentListError: '', ...(reset ? {filteredStudents: [], studentListHasMore: false} : {})})
    try {
      const start = (page - 1) * PAGE_SIZE
      const result = this.data.staff
        ? await request('listStudents', {page, pageSize: PAGE_SIZE, query: this.data.studentQuery.trim()})
        : {items: this.data.students.slice(start, start + PAGE_SIZE), hasMore: this.data.students.length > start + PAGE_SIZE}
      if (!relevant()) return
      const current = reset ? [] : this.data.filteredStudents
      const items = [...new Map([...current, ...result.items.map(displayStudent)].map(item => [item.id, item])).values()]
      this._studentPage = page
      this.setData({filteredStudents: items, studentListHasMore: result.hasMore === true})
    } catch (error) {
      if (relevant()) this.setData({studentListError: message(error, '加载名单失败，请重试')})
    } finally {
      if (relevant()) this.setData({studentListLoading: false})
    }
  },

  loadMoreStudents() {
    if (!this.data.studentListLoading) return this.loadStudentChoices(!this._studentPage)
  },

  selectStudent(event) {
    const student = this.data.filteredStudents.find((item) => item.id === event.currentTarget.dataset.id)
    if (!student || this.data.sheet !== 'students' || this.data.saving || this.data.picking || this.data.submitting) return
    const current = this.data.student
    this.closeSheet()
    if (!current || current.id !== student.id) {
      if (!this.data.staff && !getApp().selectStudent(student.id)) return this.loadSession()
      this._uploadScope = null
      this._uploadAttempt = null
      this.setData({student})
      return Promise.all([this.loadMarkedDates(), this.loadDay()])
    }
  },

  openUploadSheet() {
    if (this.data.staff || !this.data.student || this.data.sessionLoading) return
    this._uploadScope = this.dayScope()
    this._uploadAttempt = null
    this.setTabHidden(true)
    this.setData({sheet: 'upload', uploadNote: '', uploadPhotos: [], uploadError: ''})
  },

  preventBubble() {},

  closeSheet() {
    if (this.data.submitting || this.data.picking) return
    clearTimeout(this._studentSearchTimer)
    this._studentSequence += 1
    this.setTabHidden(false)
    this.setData({sheet: '', uploadError: ''})
  },

  changeUploadNote(event) {
    if (!this.data.submitting) this.setData({uploadNote: event.detail.value, uploadError: ''})
  },

  replaceDraft(changes) {
    const scope = this.dayScope()
    if (!scope) return
    const key = this.draftKey(scope)
    const draft = {...(this._drafts.get(key) || draftFrom(null)), ...changes, dirty: true}
    this._drafts.set(key, draft)
    this.showDraft(draft)
  },

  changeStatus(event) {
    const status = event.currentTarget.dataset.status
    if (this.data.staff && !this.data.saving && !this.data.dayLoading && (status === 'done' || status === 'pending')) {
      this.replaceDraft({status})
    }
  },

  changeEditorNote(event) {
    if (this.data.staff && !this.data.saving && !this.data.dayLoading) {
      this.replaceDraft({note: event.detail.value})
    }
  },

  async addPhotos(event) {
    const kind = event.currentTarget.dataset.kind
    const upload = kind === 'upload'
    if (this.data.picking || this.data.submitting || this.data.saving) return
    if (upload ? this.data.sheet !== 'upload' : !this.data.staff || this.data.dayLoading || Boolean(this.data.dayError)) return
    const photos = upload ? this.data.uploadPhotos : this.data.editorPhotos
    const remaining = MAX_PHOTOS - photos.length
    if (remaining <= 0) {
      wx.showToast({title: '最多可添加 ' + MAX_PHOTOS + ' 张照片', icon: 'none'})
      return
    }

    const scope = this.dayScope()
    this.setData({picking: true})
    try {
      const paths = await choosePhotos(remaining)
      if (!paths.length || !scope || !this.isCurrent(scope)) return
      const selected = paths.map((localPath) => ({localPath, key: 'file:' + localPath}))
      if (upload) {
        this.setData({uploadPhotos: appendPhotos(photos, selected), uploadError: ''})
      } else {
        this.replaceDraft({photos: appendPhotos(photos, selected)})
      }
    } catch (error) {
      if (!this._disposed) wx.showToast({title: message(error, '无法选择照片，请重试'), icon: 'none'})
    } finally {
      if (!this._disposed) this.setData({picking: false})
    }
  },

  removePhoto(event) {
    if (this.data.saving || this.data.submitting || this.data.picking) return
    const {kind} = event.currentTarget.dataset
    const {index, key} = event.detail
    const upload = kind === 'upload'
    const photos = (upload ? this.data.uploadPhotos : this.data.editorPhotos).slice()
    if (photos[index]?.key !== key) return
    photos.splice(index, 1)
    if (upload) this.setData({uploadPhotos: photos, uploadError: ''})
    else this.replaceDraft({photos})
  },

  async previewPhoto(event) {
    const {kind} = event.currentTarget.dataset
    const {index, key} = event.detail
    let photos = kind === 'upload' ? this.data.uploadPhotos : this.data.editorPhotos
    let selected = photos[index]
    if (!selected || selected.key !== key || this._previewingPhoto) return
    const scope = this.dayScope()
    if (!scope || !this.isCurrent(scope)) return
    this._previewingPhoto = true
    try {
      if (selected.id && !selected.localPath) {
        const {feedback} = await request('getDay', {studentId: scope.studentId, date: scope.date, section: 'feedback'}, {feedbackPhotosOnly: true})
        if (!this.isCurrent(scope)) return
        const draftKey = this.draftKey(scope)
        const draft = this._drafts.get(draftKey)
        if (!draft) return
        const refreshed = new Map((feedback?.images || []).map((photo) => [photo.id, photo]))
        photos = draft.photos.map((photo) => {
          const latest = !photo.localPath && refreshed.get(photo.id)
          return latest ? {...photo, ...latest, failed: latest.failed === true} : photo
        })
        const updated = {...draft, photos}
        this._drafts.set(draftKey, updated)
        this.showDraft(updated)
        selected = photos.find((photo) => photo.key === key)
      }
      const urls = photos.map((photo) => photo.localPath || photo.url).filter(Boolean)
      const current = selected?.localPath || selected?.url
      if (!current) throw new Error('照片暂时无法加载')
      wx.previewImage({
        urls, current,
        fail: () => {
          if (this.isCurrent(scope)) wx.showToast({title: '照片预览失败，请重试', icon: 'none'})
        },
      })
    } catch (error) {
      if (this.isCurrent(scope)) wx.showToast({title: message(error, '照片加载失败，请重试'), icon: 'none'})
    } finally {
      this._previewingPhoto = false
    }
  },

  async submitAssignment() {
    const scope = this._uploadScope
    if (this.data.staff || this.data.sheet !== 'upload' || this.data.submitting || this.data.picking || !scope || !this.isCurrent(scope)) return
    const note = this.data.uploadNote.trim()
    if (!note && !this.data.uploadPhotos.length) {
      this.setData({uploadError: '请填写作业说明或选择照片。'})
      return
    }

    this.setData({submitting: true, uploadError: ''})
    try {
      const photos = await prepareImages(this.data.uploadPhotos, () => this.isCurrent(scope), (uploaded) => {
        if (!this._disposed) this.setData({uploadPhotos: uploaded})
      })
      if (!photos || !this.isCurrent(scope)) return
      const assetIds = photos.map((photo) => photo.id)
      const fingerprint = JSON.stringify([scope.studentId, scope.date, note, assetIds])
      const previous = this._uploadAttempt
      const requestId = previous && previous.fingerprint === fingerprint ? previous.requestId : makeRequestId()
      this._uploadAttempt = {fingerprint, requestId}
      await request('addAssignment', {studentId: scope.studentId, date: scope.date, note, assetIds, requestId})
      if (this._disposed) return
      if (this.isCurrent(scope)) this.markDate(scope.date)
      this.setData({sheet: '', uploadError: '', uploadPhotos: [], uploadNote: ''})
      this.setTabHidden(false)
      wx.showToast({title: '作业上传成功', icon: 'success'})
      if (this.isCurrent(scope)) await this.loadDay()
    } catch (error) {
      if (!this._disposed) this.setData({uploadError: message(error, '作业上传失败，请重试')})
    } finally {
      if (!this._disposed) this.setData({submitting: false})
    }
  },

  async submitFeedback() {
    const scope = this.dayScope()
    if (!this.data.staff || !scope || this.data.saving || this.data.picking || this.data.dayLoading || this.data.dayError) return
    const key = this.draftKey(scope)
    const draft = this._drafts.get(key)
    if (!draft || !draft.status) {
      wx.showToast({title: '请选择整体完成情况', icon: 'none'})
      return
    }

    this.setData({saving: true})
    try {
      const photos = await prepareImages(draft.photos, () => this.isCurrent(scope), (uploaded) => {
        if (this._disposed) return
        const partlyUploaded = {...draft, photos: uploaded, dirty: true}
        this._drafts.set(key, partlyUploaded)
        if (this.isCurrent(scope)) this.showDraft(partlyUploaded)
      })
      if (!photos || !this.isCurrent(scope)) return
      const withUploads = {...draft, photos, dirty: true}
      this._drafts.set(key, withUploads)
      const note = withUploads.note.trim()
      await request('saveFeedback', {
        studentId: scope.studentId,
        date: scope.date,
        status: withUploads.status,
        note,
        assetIds: photos.map((photo) => photo.id),
      })
      if (this._disposed) return
      this._drafts.set(key, {...withUploads, dirty: false})
      if (this.isCurrent(scope)) {
        this.rememberSavedFeedback(scope, {
          status: withUploads.status,
          note,
          images: photos.map(photo => ({id: photo.id, url: photo.localPath || photo.url || ''})),
        })
        this.markDate(scope.date, true)
      }
      wx.showToast({title: '反馈已保存', icon: 'success'})
    } catch (error) {
      if (!this._disposed) wx.showToast({title: message(error, '反馈保存失败，请重试'), icon: 'none'})
    } finally {
      if (!this._disposed) this.setData({saving: false})
    }
  },

  openWork() {
    this.openDetail('work')
  },

  openFeedback() {
    if (!this.data.staff && this.data.feedbackPreview) this.openDetail('feedback')
  },

  openDetail(kind) {
    const scope = this.dayScope()
    if (scope && this.isCurrent(scope) && !this.data.sessionLoading && !this.data.sessionError && !this.data.saving && !this.data.picking) {
      wx.navigateTo({url: detailPath(kind, scope)})
    }
  },

  onShareAppMessage(event) {
    const scope = this._shareScope
    const { staff, shareRecord, saving, picking } = this.data
    if (event?.from === 'button' && event.target?.dataset?.share === 'feedback' && scope && shareRecord
      && staff && !saving && !picking && this.isCurrent(scope)) {
      const cover = this._shareCover?.key === shareRecord.key ? this._shareCover : null
      const shareCard = result => ({
        ...shareCardFields(shareRecord, result?.chat, result?.photo),
        path: detailPath('feedback', scope),
      })
      if (cover) return shareCard(cover)
      const promise = this.waitForShareCover().then(result =>
        this.data.shareRecord?.key === shareRecord.key && this.isCurrent(scope) ? shareCard(result) : homeShareCard())
      return {...shareCard(null), promise}
    }
    return homeShareCard()
  },
})
