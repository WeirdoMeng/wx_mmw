const { mealExpenseRequest, uploadMealExpenseProof, loadMealExpenseProof, openMealExpenseWorkbook } = require('../../utils/meal-expense-api')
const { choosePhotos } = require('../../utils/photo-picker')
const { parseDate } = require('../../components/mmw-calendar/date')
const { cents, decimal, money, today, query } = require('../finance/model')

const PAGE_SIZE = 15
const PROOF_LIMIT = 5
const DENIED = '当前账号没有此机构的餐食费用管理权限，请联系管理员。'
const ACCESS_ERRORS = ['MEAL_EXPENSES_FORBIDDEN', 'NOT_BOUND', 'ORG_CHANGED', 'UNAUTHENTICATED']
const CATEGORIES = [
  { key: 'ingredients', label: '食材采购' }, { key: 'catering', label: '外购餐食' },
  { key: 'supplies', label: '餐具耗材' }, { key: 'other', label: '其他支出' },
]
const FILTERS = [{ key: '', label: '全部类别' }, ...CATEGORIES]
const FORM_CATEGORIES = [{ key: '', label: '选择类别' }, ...CATEGORIES]
const expensePath = id => '/' + encodeURIComponent(id)

function categoryLabel(category) {
  return CATEGORIES.find(item => item.key === category)?.label || '其他支出'
}

function listState() {
  return { items: [], summary: null, page: 0, hasMore: false, loading: false, listError: '' }
}

function defaultFilters() {
  return { month: today().slice(0, 7), category: '', search: '' }
}

function panelState() {
  return {
    panel: '', record: null, form: null, proofs: [], panelLoading: false,
    panelError: '', saving: false, picking: false, confirming: false,
  }
}

function summaryView(result) {
  const categories = result.categories || []
  return {
    amount: money(result.total), count: result.count,
    categories: CATEGORIES.map(item => {
      const row = categories.find(({ category }) => category === item.key)
      const amount = row?.amount || 0
      return { ...item, amount: money(amount), count: row?.count || 0, width: result.total ? amount / result.total * 100 : 0 }
    }),
  }
}

function expenseView(record) {
  return {
    ...record, categoryLabel: categoryLabel(record.category), amountLabel: money(record.amount),
    headline: record.merchant || record.note || categoryLabel(record.category),
    imageCount: record.images?.length || 0,
  }
}

function expenseForm(record = {}) {
  const categoryIndex = Math.max(0, FORM_CATEGORIES.findIndex(item => item.key === record.category))
  return {
    date: record.date || today(), categoryIndex,
    categoryLabel: FORM_CATEGORIES[categoryIndex].label,
    amount: decimal(record.amount), merchant: record.merchant || '', handler: record.handler || '', note: record.note || '',
  }
}

function formValues(form) {
  const category = FORM_CATEGORIES[form.categoryIndex]?.key
  if (!parseDate(form.date)) throw new Error('请选择有效的支出日期。')
  if (!category) throw new Error('请选择支出类别。')
  return {
    date: form.date, category, amount: cents(form.amount, '支出金额', true),
    merchant: form.merchant.trim(), handler: form.handler.trim(), note: form.note.trim(),
  }
}

function newRequestId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
}

Page({
  data: {
    ...listState(), ...panelState(), categoryOptions: FORM_CATEGORIES, filterOptions: FILTERS, proofLimit: PROOF_LIMIT,
    authorized: false, authLoading: true, accessError: '', authRetry: false, organizationName: '',
    month: '', filterIndex: 0, search: '', filtered: false, exporting: false,
  },

  onLoad(options = {}) {
    this._org = typeof options.org === 'string' ? options.org : ''
    this._filters = defaultFilters()
    this._authTicket = 0
    this._listTicket = 0
    this._panelTicket = 0
    this.setData({ month: this._filters.month })
  },

  onShow() { return this.checkAccess() },
  onUnload() { this._closed = true },

  async checkAccess() {
    const ticket = ++this._authTicket
    if (!this.data.authorized) this.setData({ authLoading: true, authRetry: false, accessError: '' })
    try {
      const app = getApp()
      const session = await app.ensureSession({ refresh: true })
      if (this._closed || ticket !== this._authTicket) return
      const org = session?.organization
      if (org?.id !== this._org || session?.role !== 'teacher' || session.teacher?.canManageMealExpenses !== true) {
        this.clearAccess(DENIED)
        return
      }
      const scope = app.getRequestScope()
      if (!this.current()) {
        this.clearPanel()
        this._scope = scope
        this.resetFilters()
      }
      this.setData({ authorized: true, authLoading: false, organizationName: org.name, accessError: '', authRetry: false })
      if (!this.data.panel && !this.data.exporting) await this.loadList()
    } catch (error) {
      if (this._closed || ticket !== this._authTicket) return
      if (!this.checkPermissionError(error)) this.clearAccess(error.message || '暂时无法核对餐食费用管理权限。', true)
    }
  },

  current(scope = this._scope) {
    if (this._closed || !this.data.authorized || !scope || this._scope !== scope) return false
    const app = getApp()
    const active = app.getRequestScope()
    const session = app.globalData.session
    return active.id === scope.id && active.revision === scope.revision && session?.organization?.id === this._org
      && session.role === 'teacher' && session.teacher?.canManageMealExpenses === true
  },

  resetFilters() {
    ++this._listTicket
    this._filters = defaultFilters()
    this.setData({
      ...listState(), exporting: false, month: this._filters.month, filterIndex: 0, search: '', filtered: false,
    })
  },

  clearAccess(message, retry = false) {
    this._scope = null
    this.clearPanel()
    this.resetFilters()
    this.setData({ authorized: false, authLoading: false, accessError: message, authRetry: retry, organizationName: '' })
  },

  checkPermissionError(error) {
    if (!ACCESS_ERRORS.includes(error?.code)) return false
    this.clearAccess(DENIED)
    return true
  },

  async onPullDownRefresh() {
    try { await this.checkAccess() }
    finally { wx.stopPullDownRefresh() }
  },

  applyFilters(filters) {
    this._filters = filters
    this.setData({
      ...listState(), month: filters.month, filterIndex: FILTERS.findIndex(item => item.key === filters.category),
      filtered: Boolean(filters.category || filters.search),
    })
    return this.loadList()
  },

  onMonthChange(event) {
    const month = event.detail.value
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return this.applyFilters({ ...this._filters, month })
  },

  onCategoryChange(event) {
    const category = FILTERS[Number(event.detail.value)]?.key
    if (category !== undefined) return this.applyFilters({ ...this._filters, category })
  },

  onSearchInput(event) { this.setData({ search: event.detail.value }) },

  onSearch() {
    return this.applyFilters({ ...this._filters, search: this.data.search.trim() })
  },

  onListRetry() { return this.loadList(this._retryAppend) },
  onMore() { return this.loadList(true) },

  async loadList(append = false) {
    if (!this.current() || (append && (this.data.loading || !this.data.hasMore))) return
    const scope = this._scope
    const ticket = ++this._listTicket
    const page = append ? this.data.page + 1 : 1
    this.setData({ loading: true, listError: '' })
    try {
      const result = await mealExpenseRequest(query('/', { ...this._filters, page, pageSize: PAGE_SIZE }))
      if (!this.current(scope) || ticket !== this._listTicket) return
      const items = result.items.map(expenseView)
      this.setData({
        items: append ? [...this.data.items, ...items] : items,
        summary: summaryView(result.summary), page: result.page, hasMore: result.hasMore, loading: false,
      })
    } catch (error) {
      if (!this.current(scope) || ticket !== this._listTicket) return
      this._retryAppend = append
      if (!this.checkPermissionError(error)) this.setData({ loading: false, listError: error.message || '暂时无法获取支出记录。' })
    }
  },

  async onExport() {
    if (!this.current() || this.data.exporting || this.data.loading || !this.data.summary || this.data.listError) return
    const scope = this._scope
    const filters = this._filters
    const isCurrent = () => this.current(scope) && this._filters === filters
    this.setData({ exporting: true })
    try {
      await openMealExpenseWorkbook(query('/workbook', filters), { isCurrent })
    } catch (error) {
      if (isCurrent() && !this.checkPermissionError(error)) {
        wx.showToast({ title: error.message || '暂时无法导出费用明细。', icon: 'none' })
      }
    } finally {
      if (this.current(scope)) this.setData({ exporting: false })
    }
  },

  clearPanel() {
    ++this._panelTicket
    this._detailId = ''
    this._uploaded = new Map()
    this._attempt = null
    this.setData(panelState())
  },

  panelCurrent(scope, ticket) {
    return this.current(scope) && ticket === this._panelTicket
  },

  onCreate() {
    if (!this.current()) return
    this.clearPanel()
    this.setData({ panel: 'edit', form: expenseForm() })
  },

  onOpenExpense(event) { return this.loadDetail(event.currentTarget.dataset.id) },
  onRetryDetail() { return this.loadDetail(this._detailId) },

  async loadDetail(id) {
    if (!this.current() || !id) return
    this.clearPanel()
    this._detailId = id
    const scope = this._scope
    const ticket = this._panelTicket
    this.setData({ panel: 'detail', panelLoading: true })
    try {
      const result = await mealExpenseRequest(expensePath(id))
      if (!this.panelCurrent(scope, ticket)) return
      const record = expenseView(result.expense)
      const proofs = (record.images || []).map(photo => ({
        key: photo.id, id: photo.id, remoteUrl: photo.url, localPath: '', failed: false, loading: true,
      }))
      this.setData({ record, proofs, panelLoading: false })
      await Promise.all(proofs.map(photo => this.downloadProof(photo, scope, ticket)))
    } catch (error) {
      if (!this.panelCurrent(scope, ticket)) return
      if (!this.checkPermissionError(error)) this.setData({ panelError: error.message || '暂时无法打开支出详情。', panelLoading: false })
    }
  },

  async downloadProof(photo, scope, ticket) {
    try {
      const localPath = await loadMealExpenseProof(photo.remoteUrl)
      if (!this.panelCurrent(scope, ticket)) return ''
      this.applyProofUpdate(photo.key, { localPath, failed: false, loading: false })
      return localPath
    } catch (error) {
      if (this.panelCurrent(scope, ticket) && !this.checkPermissionError(error)) {
        this.applyProofUpdate(photo.key, { localPath: '', failed: true, loading: false })
      }
      return ''
    }
  },

  applyProofUpdate(key, updates) {
    const proofs = this.data.proofs.map(photo => photo.key === key ? { ...photo, ...updates } : photo)
    this.setData({ proofs })
  },

  async onPreviewProof(event) {
    if (!this.current() || this.data.saving) return
    const scope = this._scope
    const ticket = this._panelTicket
    const photo = this.data.proofs.find(item => item.key === event.detail.key)
    if (!photo || photo.loading) return
    let path = photo.localPath
    if (photo.remoteUrl && (!path || event.detail.failed)) {
      this.applyProofUpdate(photo.key, { loading: true })
      path = await this.downloadProof(photo, scope, ticket)
    }
    if (!this.panelCurrent(scope, ticket)) return
    if (!path || !this.data.proofs.some(item => item.key === photo.key)) {
      wx.showToast({ title: '暂时无法加载凭证图片。', icon: 'none' })
      return
    }
    const urls = this.data.proofs.map(item => item.localPath).filter(Boolean)
    wx.previewImage({ current: path, urls })
  },

  onEdit() {
    if (!this.current() || !this.data.record) return
    this.setData({ panel: 'edit', form: expenseForm(this.data.record), panelError: '' })
  },

  onClosePanel() {
    if (this.data.saving || this.data.picking || this.data.confirming) return
    this.clearPanel()
  },

  stopTouch() {},

  onDateChange(event) {
    if (!this.data.saving) this.setData({ 'form.date': event.detail.value })
  },

  onFormCategory(event) {
    if (this.data.saving) return
    const index = Number(event.detail.value)
    if (FORM_CATEGORIES[index]) this.setData({ 'form.categoryIndex': index, 'form.categoryLabel': FORM_CATEGORIES[index].label })
  },

  onFormInput(event) {
    const field = event.currentTarget.dataset.field
    if (!this.data.saving && ['amount', 'merchant', 'handler', 'note'].includes(field)) {
      this.setData({ ['form.' + field]: event.detail.value })
    }
  },

  async onPickProofs() {
    const remaining = PROOF_LIMIT - this.data.proofs.length
    if (!this.current() || this.data.saving || this.data.picking || remaining < 1) return
    const scope = this._scope
    const ticket = this._panelTicket
    this.setData({ picking: true, panelError: '' })
    try {
      const paths = await choosePhotos(remaining)
      if (!this.panelCurrent(scope, ticket)) return
      const selected = new Set(this.data.proofs.map(item => item.filePath))
      const added = paths.filter(path => !selected.has(path)).map(path => ({
        key: newRequestId(), filePath: path, localPath: path, loading: false, failed: false,
      }))
      this.setData({ proofs: [...this.data.proofs, ...added].slice(0, PROOF_LIMIT) })
    } catch (error) {
      if (this.panelCurrent(scope, ticket)) this.setData({ panelError: error.message || '暂时无法选择照片。' })
    } finally {
      if (this.panelCurrent(scope, ticket)) this.setData({ picking: false })
    }
  },

  onRemoveProof(event) {
    if (this.data.saving || this.data.picking) return
    const key = event.detail.key
    this._uploaded.delete(key)
    this.setData({ proofs: this.data.proofs.filter(photo => photo.key !== key) })
  },

  async onSave() {
    if (!this.current() || this.data.saving || this.data.picking || !this.data.form) return
    const scope = this._scope
    const ticket = this._panelTicket
    const { record, proofs, form } = this.data
    let submitted = false
    this.setData({ saving: true, panelError: '' })
    try {
      const fields = formValues(form)
      const assetIds = []
      for (const photo of proofs) {
        let id = photo.id || this._uploaded.get(photo.key)
        if (!id) {
          const upload = await uploadMealExpenseProof(photo.filePath)
          if (!this.panelCurrent(scope, ticket)) return
          id = upload.id
          this._uploaded.set(photo.key, id)
        }
        assetIds.push(id)
      }
      if (!this.panelCurrent(scope, ticket)) return
      const data = { ...fields, assetIds, ...(record ? { revision: record.revision } : {}) }
      const signature = JSON.stringify(data)
      if (this._attempt?.signature !== signature) this._attempt = { signature, id: newRequestId() }
      submitted = true
      await mealExpenseRequest(record ? expensePath(record.id) : '/', {
        method: record ? 'PATCH' : 'POST', data: { ...data, requestId: this._attempt.id },
      })
      if (!this.panelCurrent(scope, ticket)) return
      this.clearPanel()
      wx.showToast({ title: record ? '已保存修改' : '已登记支出', icon: 'success' })
      const month = fields.date.slice(0, 7)
      if (month !== this._filters.month) {
        this.setData({ search: '' })
        await this.applyFilters({ month, category: '', search: '' })
      } else await this.loadList()
    } catch (error) {
      if (!this.panelCurrent(scope, ticket) || this.checkPermissionError(error)) return
      if (submitted && error.code === 'INVALID_UPLOAD') this._uploaded.clear()
      this.setData({ panelError: error.message || '暂时无法保存支出。' })
    } finally {
      if (this.panelCurrent(scope, ticket)) this.setData({ saving: false })
    }
  },

  onDelete() {
    const record = this.data.record
    if (!this.current() || this.data.saving || this.data.confirming || !record) return
    const scope = this._scope
    const ticket = this._panelTicket
    this.setData({ confirming: true })
    wx.showModal({
      title: '删除支出记录',
      content: '删除后，这笔支出将从费用统计中移除。确定删除？',
      confirmText: '删除', confirmColor: '#a43b30',
      success: result => {
        if (!this.panelCurrent(scope, ticket)) return
        this.setData({ confirming: false })
        if (result.confirm) this.deleteExpense(record, scope, ticket)
      },
      fail: () => {
        if (this.panelCurrent(scope, ticket)) this.setData({ confirming: false, panelError: '暂时无法确认删除，请重试。' })
      },
    })
  },

  async deleteExpense(record, scope, ticket) {
    this.setData({ saving: true, panelError: '' })
    try {
      await mealExpenseRequest(query(expensePath(record.id), { revision: record.revision }), { method: 'DELETE' })
      if (!this.panelCurrent(scope, ticket)) return
      this.clearPanel()
      wx.showToast({ title: '已删除', icon: 'success' })
      await this.loadList()
    } catch (error) {
      if (this.panelCurrent(scope, ticket) && !this.checkPermissionError(error)) {
        this.setData({ panelError: error.message || '暂时无法删除支出。' })
      }
    } finally {
      if (this.panelCurrent(scope, ticket)) this.setData({ saving: false })
    }
  },
})
