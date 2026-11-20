const { generateWorksheet } = require('../../utils/arithmetic-worksheet')
const { createArithmeticPdf } = require('../../utils/arithmetic-pdf')
const { runToolActionWithAd } = require('../../utils/tool-action-ad')
const { createPdfPreviewDocument, getPdfPreviewDocument, releasePdfPreviewDocument } = require('../../utils/pdf-preview-document')

const OPERATIONS = [
  { key: 'add', label: '加法', symbol: '+' },
  { key: 'sub', label: '减法', symbol: '−' },
  { key: 'mul', label: '乘法', symbol: '×' },
  { key: 'div', label: '除法', symbol: '÷' },
]
const FORMATS = [
  { key: 'horizontal', label: '横式' },
  { key: 'blank', label: '填空' },
  { key: 'vertical', label: '竖式' },
]
const LIMITS = [5, 10, 15, 20, 30, 50, 100, 500, 1000]
const REGROUP = [
  { key: 'any', label: '不限' },
  { key: 'required', label: '必须进位或退位' },
  { key: 'never', label: '不进位或退位' },
]
const DIVISION = [
  { key: 'exact', label: '整除' },
  { key: 'remainder', label: '有余数' },
]
const PICKERS = { limitIndex: LIMITS, regroupIndex: REGROUP, divisionIndex: DIVISION }
const TOOL_KEY = 'sst-make'
const PDF_TITLE = '算术练习题'
const COUNT_ERROR = '题数请输入 1 到 100 的整数。'

function validQuestionCount(count) {
  return /^\d{1,3}$/.test(count) && Number(count) >= 1 && Number(count) <= 100
}

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    categoryId: { type: String, value: '' },
  },

  data: {
    operations: OPERATIONS,
    formats: FORMATS,
    rangeLabels: LIMITS.map(limit => String(limit) + ' 以内'),
    regroupOptions: REGROUP,
    divisionOptions: DIVISION,
    selected: { add: true, sub: true, mul: false, div: false },
    format: 'horizontal',
    limitIndex: 3,
    regroupIndex: 0,
    divisionIndex: 0,
    count: '30',
    unique: true,
    includeKey: true,
    advancedOpen: false,
    dirty: false,
    questions: [],
    pdfDocumentId: '',
    paperFormat: 'horizontal',
    notice: '',
    error: '',
    generating: false,
    exporting: false,
    exportError: '',
  },

  lifetimes: {
    attached() {
      this._active = true
      this.generate()
    },
    detached() {
      this._active = false
      this._cancelActionAd?.()
      if (this.data.pdfDocumentId) releasePdfPreviewDocument(this.data.pdfDocumentId)
    },
  },

  pageLifetimes: {
    hide() { this._visibilityVersion = (this._visibilityVersion || 0) + 1 },
  },

  methods: {
    setDraft(update) {
      this._draftVersion = (this._draftVersion || 0) + 1
      const previous = this.data.pdfDocumentId
      this.setData({ ...update, pdfDocumentId: '', dirty: true, error: '', notice: '', exportError: '' })
      if (previous) releasePdfPreviewDocument(previous)
    },

    toggleOperation(event) {
      const { key } = event.currentTarget.dataset
      if (!OPERATIONS.some(operation => operation.key === key)) return
      const selected = { ...this.data.selected, [key]: !this.data.selected[key] }
      if (!Object.values(selected).some(Boolean)) {
        this.setData({ error: '至少选择一种运算。' })
        return
      }
      this.setDraft({ selected })
    },

    chooseFormat(event) {
      const { format } = event.currentTarget.dataset
      if (format !== this.data.format && FORMATS.some(item => item.key === format)) this.setDraft({ format })
    },

    chooseOption(event) {
      const { field } = event.currentTarget.dataset
      const index = Number(event.detail.value)
      if (PICKERS[field]?.[index] !== undefined && index !== this.data[field]) this.setDraft({ [field]: index })
    },

    changeCount(event) {
      if (event.detail.value !== this.data.count) this.setDraft({ count: event.detail.value })
    },

    toggleAdvanced() {
      this.setData({ advancedOpen: !this.data.advancedOpen })
    },

    changeUnique(event) {
      this.setDraft({ unique: event.detail.value })
    },

    changeKey(event) {
      const includeKey = event.detail.value
      const { questions, paperFormat, dirty } = this.data
      if (dirty || !questions.length) {
        this.setData({ includeKey, exportError: '' })
        return
      }
      try {
        this.updatePdf(questions, paperFormat, includeKey, { includeKey, exportError: '', error: '' })
      } catch {
        this.setDraft({ includeKey })
        this.setData({ error: '暂时无法更新 PDF，请重新生成。' })
      }
    },

    async requestGenerate() {
      if (this._generating || this._exporting) return
      if (!validQuestionCount(this.data.count)) {
        this.setData({ error: COUNT_ERROR })
        return
      }
      const draftVersion = this._draftVersion
      this._generating = true
      this.setData({ generating: true, error: '' })
      try {
        await runToolActionWithAd(this, {
          toolKey: TOOL_KEY,
          isActionCurrent: () => this._draftVersion === draftVersion,
          onConfigError: error => this.setData({ error }),
          run: () => this.generate(),
        })
      } finally {
        this._generating = false
        if (this._active) this.setData({ generating: false })
      }
    },

    generate() {
      const { selected, format, limitIndex, regroupIndex, divisionIndex, count, unique, includeKey } = this.data
      if (!validQuestionCount(count)) {
        this.setData({ error: COUNT_ERROR })
        return
      }
      try {
        const { questions, shortfall } = generateWorksheet({
          operations: OPERATIONS.filter(({ key }) => selected[key]).map(({ key }) => key),
          format, count: Number(count), limit: LIMITS[limitIndex],
          regroup: REGROUP[regroupIndex].key, division: DIVISION[divisionIndex].key, unique, includeKey,
        })
        const notice = !questions.length
          ? '当前设置下没有可用题目，请扩大数值范围或调整专项条件。'
          : shortfall ? '按当前设置生成了 ' + questions.length + ' 道。可以扩大范围或允许重复。' : ''
        this.updatePdf(questions, format, includeKey, {
          questions, paperFormat: format, dirty: false, notice, error: '', exportError: '',
        })
      } catch (error) {
        this.setData({ error: error.message || '生成失败，请调整设置后重试。' })
      }
    },

    updatePdf(questions, format, includeKey, update) {
      const previous = this.data.pdfDocumentId
      const pdfDocumentId = questions.length
        ? createPdfPreviewDocument(PDF_TITLE, createArithmeticPdf(questions, { format, includeKey }), TOOL_KEY, this.data.categoryId)
        : ''
      this.setData({ ...update, pdfDocumentId })
      if (previous) releasePdfPreviewDocument(previous)
    },

    async exportPdf() {
      const { dirty, pdfDocumentId } = this.data
      if (dirty || !pdfDocumentId || this._generating || this._exporting) return
      const document = getPdfPreviewDocument(pdfDocumentId)
      if (!document) return
      const draftVersion = this._draftVersion
      this._exporting = true
      this.setData({ exporting: true, exportError: '' })
      try {
        await runToolActionWithAd(this, {
          toolKey: TOOL_KEY,
          isActionCurrent: () => this._draftVersion === draftVersion && this.data.pdfDocumentId === pdfDocumentId,
          onConfigError: exportError => this.setData({ exportError }),
          run: async canProceed => {
            try {
              const { title, bytes } = document
              const filePath = wx.env.USER_DATA_PATH + '/' + title + '.pdf'
              await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
                filePath, data: bytes.buffer, success: resolve, fail: reject,
              }))
              if (!canProceed()) return
              await new Promise((resolve, reject) => wx.openDocument({
                filePath, fileType: 'pdf', showMenu: true, success: resolve, fail: reject,
              }))
            } catch {
              if (canProceed()) this.setData({ exportError: '暂时无法打开 PDF，请重试。' })
            }
          },
        })
      } finally {
        this._exporting = false
        if (this._active) this.setData({ exporting: false })
      }
    },
  },
})
