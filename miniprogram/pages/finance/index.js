const { financeRequest, uploadFinanceProof, loadFinanceProof, openFinanceWorkbook } = require('../../utils/finance-api')
const { choosePhotos } = require('../../utils/photo-picker')
const {
  PAGE_SIZE, PROOF_LIMIT, BILL_STATUSES, PAYMENT_METHODS, EVENT_LABELS, decimal, money, cents, today, stageForm,
  stageDateError, stageInput, stageView, billView, summaryView, overviewView, eventView, paymentPreview, financeEventInput, query, listState,
} = require('./model')

const ACCESS_ERRORS = ['FINANCE_FORBIDDEN', 'NOT_BOUND', 'ORG_CHANGED', 'UNAUTHENTICATED']
const DENIED = '当前账号没有此机构的财务管理权限，请联系管理员。'
const STAGE_PAGE_SIZE = 6
const statuses = [{ key: '', label: '全部状态' }, ...Object.entries(BILL_STATUSES).map(([key, label]) => ({ key, label }))]
const BILL_PATH = id => '/bills/' + encodeURIComponent(id)
const STAGE_PATH = id => '/stages/' + encodeURIComponent(id)
const PANEL_TITLES = { create: '创建收费阶段', batch: '批量建账', student: '查找学生缴费记录', history: '学生缴费记录',
  bill: '账单流水', due: '调整应收', remove: '移除学生' }
const listViews = { stages: stageView, bills: billView, history: billView, events: eventView }
const loaders = { stages: 'loadStages', bills: 'loadBills', candidates: 'loadCandidates', history: 'loadHistory', events: 'loadEvents' }

function blanks() {
  return {
    stages: listState(), bills: listState(), candidates: listState(), history: listState(), events: listState(),
    currentStage: null, stagePickerOpen: false, stageSettings: false, stageDraft: stageForm(), selectedStages: [], selectedStageKeys: {}, overview: null,
    panel: '', activeBill: null, eventTarget: null, eventDraft: null, proofItems: [], recordedProofs: {}, batchItems: [], batchKeys: {},
  }
}

Page({
  data: {
    ...blanks(),
    tab: 'billing', authorized: false, authLoading: true, accessError: '', authRetry: false, organizationName: '',
    stageSearch: '', billSearch: '', statusIndex: 0, statuses, overviewLoading: false, overviewError: '', exporting: false,
    panelTitle: '', formError: '', stageError: '', saving: false, picking: false, proofLoading: '', proofLimit: PROOF_LIMIT,
    stageNew: stageForm(), candidateSearch: '', dueForm: { due: '', note: '' }, paymentMethods: Object.values(PAYMENT_METHODS),
    paymentHint: '',
  },

  onLoad(options = {}) {
    this._expectedOrg = typeof options.org === 'string' ? options.org : ''
    this._sequence = {}
    this._listFilters = {}
  },

  async onShow() {
    await this.checkAccess()
  },

  onUnload() { this._closed = true },

  async checkAccess() {
    const ticket = this.next('auth')
    if (!this.data.authorized) this.setData({ authLoading: true, accessError: '', authRetry: false })
    try {
      const app = getApp()
      const session = await app.ensureSession({ refresh: true })
      if (this._closed || this._sequence.auth !== ticket) return
      const org = session?.organization
      if (!org || this._expectedOrg !== org.id || session.role !== 'teacher' || session.teacher?.canManageFinance !== true) {
        this.denyAccess()
        return
      }
      const scope = app.getRequestScope()
      const first = !this.data.authorized || this._scope?.revision !== scope.revision
      if (first) this._scope = scope
      this.setData({ authorized: true, authLoading: false, organizationName: org.name, accessError: '' })
      if (first) await this.loadStages()
    } catch (error) {
      if (this._closed || this._sequence.auth !== ticket) return
      if (!this.checkPermissionError(error)) {
        this.setData({ authLoading: false, authorized: false, authRetry: true, accessError: error.message || '暂时无法核对财务管理权限。' })
      }
    }
  },

  denyAccess() {
    this._scope = null
    this._stageInitialized = false
    this._eventAttempt = null
    this._historyId = ''
    this.setData({ ...blanks(), authorized: false, authLoading: false, authRetry: false, accessError: DENIED,
      saving: false, picking: false, exporting: false, proofLoading: '', overviewLoading: false })
  },

  checkPermissionError(error) {
    if (!ACCESS_ERRORS.includes(error?.code)) return false
    this.denyAccess()
    return true
  },

  next(key) {
    const ticket = (this._sequence[key] || 0) + 1
    this._sequence[key] = ticket
    return ticket
  },

  current(scope = this._scope) {
    if (this._closed || !this.data.authorized || !scope || scope !== this._scope) return false
    const app = getApp()
    const current = app.getRequestScope()
    return current.id === scope.id && current.revision === scope.revision && app.globalData.session?.teacher?.canManageFinance === true
  },

  resetList(key) {
    this.next(key)
    this.setData({ [key]: listState() })
  },

  onListAction(event) {
    const { key, append } = event.currentTarget.dataset
    if (loaders[key]) return this[loaders[key]](append === true)
  },

  async requestList(key, path, filters, append = false) {
    if (!this.current()) return null
    const previous = this.data[key]
    if (append && (previous.loading || !previous.hasMore)) return null
    const scope = this._scope
    const ticket = this.next(key)
    const current = () => this.current(scope) && this._sequence[key] === ticket
    const page = append ? previous.page + 1 : 1
    if (!append) this._listFilters[key] = filters
    const applied = this._listFilters[key]
    const state = append ? previous : listState()
    if (!append && key === 'bills' && previous.summary) state.summary = previous.summary
    this.setData({ [key]: { ...state, loading: true, error: '' } })
    try {
      const result = await financeRequest(query(path, { page, pageSize: key === 'stages' ? STAGE_PAGE_SIZE : PAGE_SIZE, ...applied }))
      if (!current()) return null
      if (!Array.isArray(result.items)) throw new Error('财务数据格式有误，请重试。')
      const format = listViews[key]
      const items = format ? result.items.map(format) : result.items
      const combined = [...new Map([...state.items, ...items].map(item => [item.id, item])).values()]
      const value = { ...result, items: combined, loading: false, error: '', page,
        summary: result.totals ? summaryView(result.totals) : null }
      this.setData({ [key]: value })
      return value
    } catch (error) {
      if (current() && !this.checkPermissionError(error)) {
        this.setData({ [key]: { ...state, loading: false, error: error.message || '暂时无法加载，请重试。' } })
      }
      return null
    }
  },

  async loadStages(append = false, preferred) {
    const result = await this.requestList('stages', '/stages', { search: this.data.stageSearch.trim() }, append)
    if (!result || !this.current()) return
    const version = this._sequence.stages
    const stage = preferred ? stageView(preferred) : result.items.find(item => item.id === this.data.currentStage?.id)
      || this.data.currentStage || result.items[0]
    if (stage && (preferred || !this.data.currentStage)) await this.useStage(stage)
    else if (stage) this.setData({ currentStage: stage })
    if (!this.current() || version !== this._sequence.stages) return
    const refreshed = new Map(result.items.map(item => [item.id, item]))
    this.setData({ selectedStages: this.data.selectedStages.map(item => refreshed.get(item.id) || item) })
    if (!this._stageInitialized && result.items.length) {
      this._stageInitialized = true
      this.setOverviewStages([result.items[0]])
    }
  },

  onSearchStages() { return this.loadStages() },

  toggleStagePicker() {
    if (!this.current() || this.data.saving) return
    this.setData({ stagePickerOpen: !this.data.stagePickerOpen })
  },

  onTab(event) {
    const tab = event.currentTarget.dataset.tab
    if (!this.current() || this.data.saving || this.data.tab === tab || !['overview', 'billing'].includes(tab)) return
    this.setData({ tab, stagePickerOpen: false })
    if (tab === 'billing' && this.data.currentStage && !this.data.bills.page) return this.loadBills()
  },

  setOverviewStages(stages) {
    this.setData({ selectedStages: stages, selectedStageKeys: Object.fromEntries(stages.map(stage => [stage.id, true])) })
    return this.loadOverview()
  },

  onToggleStage(event) {
    if (!this.current()) return
    const { id } = event.currentTarget.dataset
    const { selectedStages, stages } = this.data
    if (this.data.selectedStageKeys[id]) return this.setOverviewStages(selectedStages.filter(stage => stage.id !== id))
    const stage = stages.items.find(item => item.id === id)
    if (stage) return this.setOverviewStages([...selectedStages, stage])
  },

  onSelectAll(event) {
    if (!this.current() || this.data.saving) return
    const { stages, selectedStages, selectedStageKeys, candidates, batchItems, batchKeys, currentStage } = this.data
    if (event.currentTarget.dataset.key === 'stages') {
      if (this.data.tab !== 'overview' || stages.loading) return
      const additional = stages.items.filter(stage => !selectedStageKeys[stage.id])
      if (additional.length) return this.setOverviewStages([...selectedStages, ...additional])
    } else if (this.data.panel === 'batch' && currentStage && !candidates.loading) {
      const due = decimal(currentStage.referenceAmount)
      const additional = candidates.items.filter(student => !batchKeys[student.id]).map(student => ({ ...student, due }))
      if (additional.length) this.setBatchItems([...batchItems, ...additional])
    }
  },

  onClearSelection(event) {
    if (!this.current() || this.data.saving) return
    if (event.currentTarget.dataset.key === 'stages') {
      if (this.data.tab === 'overview' && this.data.selectedStages.length) return this.setOverviewStages([])
    } else if (this.data.panel === 'batch') {
      this.setBatchItems([])
    }
  },

  async loadOverview() {
    if (!this.current()) return
    const scope = this._scope
    const ticket = this.next('overview')
    const stageIds = this.data.selectedStages.map(stage => stage.id)
    this.setData({ overview: null, overviewLoading: Boolean(stageIds.length), overviewError: '' })
    if (!stageIds.length) return
    const current = () => this.current(scope) && this._sequence.overview === ticket
    try {
      const report = await financeRequest('/overview', { method: 'POST', data: { stageIds } })
      if (current()) this.setData({ overview: overviewView(report), overviewLoading: false })
    } catch (error) {
      if (current() && !this.checkPermissionError(error)) {
        this.setData({ overviewLoading: false, overviewError: error.message || '统计加载失败。' })
      }
    }
  },

  onChooseBillingStage(event) {
    const stage = this.data.stages.items.find(item => item.id === event.currentTarget.dataset.id)
    if (!stage || !this.current() || this.data.saving) return
    this.setData({ stagePickerOpen: false })
    if (stage.id !== this.data.currentStage?.id) return this.useStage(stage)
  },

  useStage(stage) {
    this.resetList('bills')
    this._listFilters.bills = {}
    this.setData({ currentStage: stage, stageDraft: stageForm(stage), stageSettings: false, stageError: '', billSearch: '', statusIndex: 0 })
    if (this.data.tab === 'billing') return this.loadBills()
  },

  billFilters() {
    return { search: this.data.billSearch.trim(), status: statuses[this.data.statusIndex].key }
  },

  async loadBills(append = false) {
    const { currentStage } = this.data
    if (!currentStage) return
    const result = await this.requestList('bills', STAGE_PATH(currentStage.id) + '/bills', this.billFilters(), append)
    if (result?.stage && this.current() && this.data.currentStage?.id === result.stage.id) {
      this.setData({ currentStage: stageView(result.stage) })
    }
  },

  onSearchBills() { return this.loadBills() },
  onStatus(event) {
    const statusIndex = Number(event.detail.value)
    if (!this.current() || !statuses[statusIndex]) return
    this.setData({ statusIndex })
    return this.loadBills()
  },

  async onPullDownRefresh() {
    try {
      if (this.data.saving || this.data.panel) return
      if (!this.current()) return await this.checkAccess()
      await this.loadStages()
      if (this.data.tab === 'overview') await this.loadOverview()
      else await this.loadBills()
    } finally { wx.stopPullDownRefresh() }
  },

  onText(event) {
    const { field } = event.currentTarget.dataset
    if (!this.data.saving && this.current()) this.setData({ [field]: event.detail.value })
    if (field === 'eventDraft.amount') this.updatePaymentHint()
  },

  onDate(event) {
    const { field } = event.currentTarget.dataset
    if (field === 'eventDraft.date') this.onText(event)
    else this.setStageDate(field, event.detail.value)
  },

  clearStageDate(event) {
    this.setStageDate(event.currentTarget.dataset.field, '')
  },

  setStageDate(field, value) {
    if (!this.current() || this.data.saving) return
    const [formKey, dateKey] = field.split('.')
    const errorField = formKey === 'stageNew' ? 'formError' : 'stageError'
    const { startDate, endDate } = { ...this.data[formKey], [dateKey]: value }
    const error = value && stageDateError(startDate, endDate)
    if (error) this.setData({ [errorField]: error })
    else this.setData({ [field]: value, [errorField]: '' })
  },

  toggleStageSettings() {
    if (!this.current() || this.data.saving || !this.data.currentStage) return
    this.setData({ stageSettings: !this.data.stageSettings, stageDraft: stageForm(this.data.currentStage), stageError: '' })
  },

  showPanel(panel, changes = {}) {
    const leavingBill = this.data.panel === 'bill' && panel !== 'bill'
    if (leavingBill) this.next('proof')
    this.setData({ panel, panelTitle: PANEL_TITLES[panel] || '', formError: '', ...(leavingBill ? { proofLoading: '' } : {}), ...changes })
  },

  closePanel() {
    if (this.data.saving || this.data.picking) return
    const { panel } = this.data
    if (['due', 'event', 'remove'].includes(panel) && this._mutationFromBill) {
      this.showPanel('bill', { proofItems: [] })
      return
    }
    if (panel === 'bill' && this._billFromHistory) {
      this.resetList('events')
      this.showPanel('history', { activeBill: null })
      return this.loadHistory()
    }
    if (panel === 'history' && this._historyFromPicker) {
      this.resetList('history')
      this.showPanel('student')
      return
    }
    for (const key of ['candidates', 'history', 'events']) this.resetList(key)
    this.showPanel('', { activeBill: null, eventTarget: null, eventDraft: null, proofItems: [], batchItems: [], batchKeys: {} })
  },

  stopTouch() {},

  onNewStage() {
    if (this.current()) this.showPanel('create', { stageNew: stageForm() })
  },

  async write(action, complete, errorField = 'formError') {
    if (!this.current() || this.data.saving || this.data.picking) return
    const scope = this._scope
    const ticket = this.next('write')
    this.setData({ saving: true, [errorField]: '' })
    try {
      const result = await action(scope)
      if (!this.current(scope)) return
      this.setData({ saving: false })
      await complete(result)
    } catch (error) {
      if (this.current(scope) && !this.checkPermissionError(error)) {
        this.setData({ [errorField]: error.message || '保存失败，请重试。' })
      }
    } finally {
      if (this.current(scope) && this._sequence.write === ticket) this.setData({ saving: false })
    }
  },

  saveNewStage() {
    return this.write(() => financeRequest('/stages', { method: 'POST', data: stageInput(this.data.stageNew) }), async ({ stage }) => {
      this.closePanel()
      this.setData({ stageSearch: '', stagePickerOpen: false })
      await this.loadStages(false, stage)
      wx.showToast({ title: '收费阶段已创建', icon: 'success' })
    })
  },

  updateStage() {
    const stage = this.data.currentStage
    if (!stage) return
    return this.write(() => financeRequest(STAGE_PATH(stage.id), { method: 'PATCH', data: stageInput(this.data.stageDraft) }), ({ stage }) => {
      const formatted = stageView(stage)
      const stages = this.data.stages
      this.setData({ currentStage: formatted, stageDraft: stageForm(stage),
        stages: { ...stages, items: stages.items.map(item => item.id === stage.id ? formatted : item) },
        selectedStages: this.data.selectedStages.map(item => item.id === stage.id ? formatted : item) })
      wx.showToast({ title: '收费阶段已保存', icon: 'success' })
      return this.loadOverview()
    }, 'stageError')
  },

  startStudentSearch(panel) {
    if (!this.current() || (panel === 'batch' && !this.data.currentStage)) return
    this.resetList('candidates')
    this.showPanel(panel, { candidateSearch: '', batchItems: [], batchKeys: {} })
    return this.loadCandidates()
  },

  onBatch() { return this.startStudentSearch('batch') },
  onStudentLookup() { return this.startStudentSearch('student') },

  loadCandidates(append = false) {
    const { panel, currentStage, candidateSearch } = this.data
    if (!['batch', 'student'].includes(panel)) return
    return this.requestList('candidates', '/students', { search: candidateSearch.trim(),
      ...(panel === 'batch' ? { stageId: currentStage.id } : {}) }, append)
  },

  onSearchCandidates() { return this.loadCandidates() },

  onStudentSelect(event) {
    const { id } = event.currentTarget.dataset
    const { panel, batchItems, candidates, currentStage } = this.data
    if (!this.current() || this.data.saving) return
    const student = candidates.items.find(item => item.id === id)
    if (panel === 'student' && student) return this.openHistory(id, true)
    if (panel !== 'batch') return
    const selected = batchItems.some(item => item.id === id)
    if (!selected && !student) return
    const items = selected ? batchItems.filter(item => item.id !== id) : [...batchItems, { ...student, due: decimal(currentStage.referenceAmount) }]
    this.setBatchItems(items)
  },

  setBatchItems(items) {
    this.setData({ batchItems: items, batchKeys: Object.fromEntries(items.map(item => [item.id, true])) })
  },

  onBatchAmount(event) {
    if (!this.current() || this.data.saving) return
    const index = this.data.batchItems.findIndex(item => item.id === event.currentTarget.dataset.id)
    if (index >= 0) this.setData({ ['batchItems[' + index + '].due']: event.detail.value })
  },

  saveBatch() {
    const stage = this.data.currentStage
    if (!stage || this.data.panel !== 'batch') return
    return this.write(async () => {
      const { batchItems } = this.data
      if (!batchItems.length) throw new Error('请选择至少一名学生。')
      const items = batchItems.map(item => ({ studentId: item.id, due: cents(item.due, `${item.name}的应收金额`) }))
      await financeRequest(STAGE_PATH(stage.id) + '/bills', { method: 'POST', data: { items } })
      return items.length
    }, async count => {
      this.closePanel()
      wx.showToast({ title: `已创建 ${count} 张账单`, icon: 'success' })
      await Promise.all([this.loadBills(), this.loadOverview()])
    })
  },

  openHistory(id, fromPicker = false) {
    if (!this.current() || !id) return
    this._historyId = id
    this._historyFromPicker = fromPicker
    this.resetList('history')
    this.showPanel('history')
    return this.loadHistory()
  },

  onHistory(event) { return this.openHistory(event.currentTarget.dataset.id) },

  loadHistory(append = false) {
    if (!this._historyId || this.data.panel !== 'history') return
    return this.requestList('history', '/students/' + encodeURIComponent(this._historyId) + '/history', {}, append)
  },

  onBill(event) {
    const fromHistory = this.data.panel === 'history'
    const list = fromHistory ? this.data.history : this.data.bills
    const bill = list.items.find(item => item.id === event.currentTarget.dataset.id)
    if (!bill || !this.current()) return
    this._billFromHistory = fromHistory
    this.next('proof')
    this.resetList('events')
    this.showPanel('bill', { activeBill: bill, proofLoading: '', recordedProofs: {} })
    return this.loadEvents()
  },

  async loadEvents(append = false) {
    const id = this.data.activeBill?.id
    if (!id || this.data.panel !== 'bill') return
    const result = await this.requestList('events', BILL_PATH(id) + '/events', {}, append)
    if (result?.bill?.id === id && this.current() && this.data.activeBill?.id === id) {
      this.setData({ activeBill: billView(result.bill) })
    }
  },

  onDue() {
    const { activeBill } = this.data
    if (!this.current() || !activeBill || activeBill.removed) return
    this._mutationFromBill = true
    this.showPanel('due', { dueForm: { due: decimal(activeBill.due), note: '' } })
  },

  finishBill(message) {
    const inBill = this._mutationFromBill
    this.closePanel()
    wx.showToast({ title: message, icon: 'success' })
    return Promise.all([inBill ? this.loadEvents() : null, this.loadBills(), this.loadOverview()])
  },

  saveDue() {
    if (this.data.panel !== 'due') return
    return this.write(async () => {
      const { activeBill, dueForm } = this.data
      const note = dueForm.note.trim()
      if (!note) throw new Error('请填写调整原因。')
      const due = cents(dueForm.due, '应收金额')
      if (due < activeBill.net) throw new Error(`应收金额不能低于净实收 ${money(activeBill.net)}。`)
      await financeRequest(BILL_PATH(activeBill.id), { method: 'PATCH', data: { due, note } })
    }, () => this.finishBill('应收金额已更新'))
  },

  onRemove(event) {
    const fromBill = this.data.panel === 'bill'
    const bill = fromBill ? this.data.activeBill : this.data.bills.items.find(item => item.id === event.currentTarget.dataset.id)
    if (!this.current() || !bill || bill.removed) return
    this._mutationFromBill = fromBill
    this.showPanel('remove', { activeBill: bill })
  },

  removeBill() {
    const { activeBill, panel } = this.data
    if (panel !== 'remove' || activeBill?.net !== 0) return
    return this.write(() => financeRequest(BILL_PATH(activeBill.id), { method: 'DELETE' }), result => {
      this.setData({ activeBill: billView(result.bill) })
      return this.finishBill('已从本阶段移除')
    })
  },

  onEvent(event) {
    const { type, id } = event.currentTarget.dataset
    const { activeBill, events } = this.data
    if (!this.current() || !activeBill || activeBill.removed || !['payment', 'refund', 'reversal'].includes(type)) return
    if ((type === 'payment' && activeBill.balance <= 0) || (type === 'refund' && activeBill.net <= 0)) return
    const target = type === 'reversal' ? events.items.find(item => item.id === id && item.reversible) : null
    if (type === 'reversal' && !target) return
    this._mutationFromBill = true
    this._eventAttempt = null
    this.showPanel('event', { panelTitle: type === 'reversal' ? EVENT_LABELS.reversal : '登记' + EVENT_LABELS[type], eventTarget: target,
      proofItems: [], eventDraft: { type, date: today(), amount: type === 'payment' ? decimal(activeBill.balance) : '',
        methodIndex: 0, fullPayment: true, note: '' } })
    this.updatePaymentHint()
  },

  onMethod(event) {
    const index = Number(event.detail.value)
    if (!this.data.saving && this.current() && this.data.eventDraft && this.data.paymentMethods[index]) {
      this.setData({ 'eventDraft.methodIndex': index })
    }
  },
  onFullPayment(event) {
    if (this.data.saving || !this.current() || this.data.eventDraft?.type !== 'payment') return
    this.setData({ 'eventDraft.fullPayment': event.detail.value })
    this.updatePaymentHint()
  },

  updatePaymentHint() {
    const { eventDraft, activeBill } = this.data
    if (eventDraft?.type === 'payment' && activeBill) this.setData({ paymentHint: paymentPreview(eventDraft.amount, activeBill.balance, eventDraft.fullPayment) })
  },

  async chooseProofs() {
    if (!this.current() || this.data.saving || this.data.picking || this.data.panel !== 'event' || this.data.eventDraft.type === 'reversal') return
    const scope = this._scope
    this.setData({ picking: true, formError: '' })
    try {
      const paths = await choosePhotos(PROOF_LIMIT - this.data.proofItems.length)
      if (!this.current(scope) || this.data.panel !== 'event') return
      const items = new Map(this.data.proofItems.map(photo => [photo.key, photo]))
      for (const localPath of paths) {
        const key = 'file:' + localPath
        if (!items.has(key)) items.set(key, { key, localPath })
      }
      this.setData({ proofItems: [...items.values()].slice(0, PROOF_LIMIT) })
    } catch (error) {
      if (this.current(scope)) this.setData({ formError: error.message || '无法打开照片。' })
    } finally { if (this.current(scope)) this.setData({ picking: false }) }
  },

  removeProof(event) {
    if (this.current() && !this.data.saving && !this.data.picking) {
      this.setData({ proofItems: this.data.proofItems.filter(photo => photo.key !== event.detail.key) })
    }
  },

  previewDraftProof(event) {
    if (!this.current()) return
    const photos = this.data.proofItems
    const current = photos.find(photo => photo.key === event.detail.key)?.localPath
    if (current) wx.previewImage({ current, urls: photos.map(photo => photo.localPath) })
  },

  async viewRecordedProofs(event) {
    const { id } = event.currentTarget.dataset
    const item = this.data.events.items.find(row => row.id === id)
    if (!this.current() || !item?.photos.length || this.data.proofLoading) return
    if (this.data.recordedProofs[id]) {
      const proofs = { ...this.data.recordedProofs }
      delete proofs[id]
      this.setData({ recordedProofs: proofs })
      return
    }
    return this.loadRecordedProofs(item)
  },

  async loadRecordedProofs(item) {
    const { id } = item
    const scope = this._scope
    const billId = this.data.activeBill?.id
    const ticket = this.next('proof')
    const current = () => this.current(scope) && this._sequence.proof === ticket && this.data.activeBill?.id === billId && this.data.panel === 'bill'
    this.setData({ proofLoading: id })
    try {
      const results = await Promise.allSettled(item.photos.map(photo => loadFinanceProof(photo.url)))
      if (!current()) return
      const access = results.find(result => result.status === 'rejected' && ACCESS_ERRORS.includes(result.reason?.code))
      if (access && this.checkPermissionError(access.reason)) return
      const photos = item.photos.map((photo, index) => {
        const result = results[index]
        return { id: photo.id, localPath: result.status === 'fulfilled' ? result.value : '', failed: result.status !== 'fulfilled' }
      })
      this.setData({ recordedProofs: { ...this.data.recordedProofs, [id]: photos } })
    } catch (error) {
      if (current() && !this.checkPermissionError(error)) wx.showToast({ title: error.message, icon: 'none' })
    } finally { if (current()) this.setData({ proofLoading: '' }) }
  },

  previewRecordedProof(event) {
    const { id } = event.currentTarget.dataset
    const photos = this.data.recordedProofs[id]
    if (!this.current() || !photos || this.data.proofLoading) return
    const proof = photos.find(photo => photo.id === event.detail.key)
    if (proof?.localPath && !event.detail.failed) {
      wx.previewImage({ current: proof.localPath, urls: photos.map(photo => photo.localPath).filter(Boolean) })
      return
    }
    const item = this.data.events.items.find(row => row.id === id)
    if (item) return this.loadRecordedProofs(item)
  },

  saveEvent() {
    if (this.data.panel !== 'event') return
    return this.write(async scope => {
      const { activeBill, eventDraft, eventTarget, proofItems } = this.data
      const values = financeEventInput(eventDraft, activeBill, eventTarget)
      const fingerprint = JSON.stringify([values, proofItems.map(photo => photo.key)])
      if (this._eventAttempt?.fingerprint !== fingerprint) {
        this._eventAttempt = { fingerprint, requestId: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12) }
      }
      const proofIds = []
      for (const [index, photo] of proofItems.entries()) {
        if (!this.current(scope)) return
        const id = photo.id || (await uploadFinanceProof(activeBill.id, photo.localPath)).id
        if (!this.current(scope)) return
        if (!id) throw new Error('凭证没有上传成功，请重试。')
        proofIds.push(id)
        if (!photo.id) this.setData({ ['proofItems[' + index + '].id']: id })
      }
      try {
        return await financeRequest(BILL_PATH(activeBill.id) + '/events', { method: 'POST',
          data: { ...values, requestId: this._eventAttempt.requestId, proofIds } })
      } catch (error) {
        if (error.code === 'INVALID_UPLOAD' && this.current(scope)) {
          this.setData({ proofItems: this.data.proofItems.map(({ key, localPath }) => ({ key, localPath })) })
        }
        throw error
      }
    }, () => this.finishBill('账单流水已保存'))
  },

  async exportWorkbook(event) {
    if (!this.current() || this.data.exporting) return
    const scope = this._scope
    const tab = this.data.tab
    const overview = event.currentTarget.dataset.kind === 'overview'
    const { currentStage, selectedStages } = this.data
    if (overview ? !selectedStages.length || !this.data.overview : !currentStage) return
    const stageIds = selectedStages.map(stage => stage.id)
    const stageWorkbook = stage => query(STAGE_PATH(stage.id) + '/workbook', this._listFilters.bills)
    const path = overview ? '/overview/workbook' : stageWorkbook(currentStage)
    const isCurrent = () => this.current(scope) && this.data.tab === tab && (overview
      ? this.data.selectedStages.map(stage => stage.id).join(',') === stageIds.join(',')
      : Boolean(this.data.currentStage) && stageWorkbook(this.data.currentStage) === path)
    this.setData({ exporting: true })
    try {
      await openFinanceWorkbook(path, { ...(overview ? { method: 'POST', data: { stageIds } } : {}), isCurrent })
    } catch (error) {
      if (this.current(scope) && !this.checkPermissionError(error)) wx.showToast({ title: error.message || '导出失败。', icon: 'none' })
    } finally { if (this.current(scope)) this.setData({ exporting: false }) }
  },

  onBack() {
    const back = () => wx.switchTab({ url: '/pages/profile/index' })
    if (getCurrentPages().length > 1) wx.navigateBack({ fail: back })
    else back()
  },
})
