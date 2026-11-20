const { STROKES, WRITING_MODES, WRITING_INPUT_LIMIT, inspectHanzi, makeWritingWorksheet } = require('../../utils/writing-worksheet')
const { createWritingPdf } = require('../../utils/writing-pdf')
const { runToolActionWithAd } = require('../../utils/tool-action-ad')
const { ENGLISH_FONTS, DEFAULT_ENGLISH_FONT } = require('../../utils/writing-latin')
const { createPdfPreviewDocument, getPdfPreviewDocument, releasePdfPreviewDocument } = require('../../utils/pdf-preview-document')

const GRIDS = [
  { key: 'tian', name: '田字格' },
  { key: 'mi', name: '米字格' },
  { key: 'square', name: '方格' },
]
const SIZES = [10, 12, 15, 18]
const GAPS = [0, 2, 4]
const TRACE_COUNTS = Array.from({ length: 9 }, (_, index) => index)
const STROKE_BY_ID = new Map(STROKES.map(stroke => [stroke.id, stroke]))
const INITIAL_STROKES = STROKES.slice(0, 4)
const PICKERS = { sizeIndex: SIZES, gapIndex: GAPS, traceIndex: TRACE_COUNTS }
const LETTER_CASES = [
  { key: 'paired', name: '大小写' },
  { key: 'upper', name: '大写' },
  { key: 'lower', name: '小写' },
]
const INITIAL_TEXT = {
  number: '0 1 2 3 4 5 6 7 8 9',
  letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
}
const STROKE_GROUPS = [
  { key: 'basic', name: '基本笔画' },
  { key: 'turn', name: '折弯笔画' },
  { key: 'hook', name: '带钩笔画' },
].map(group => ({
  ...group,
  choices: STROKES.filter(stroke => stroke.group === group.key).map(({ id, name, preview }) => ({ id, name, preview })),
}))
const INPUT_LABELS = {
  hanzi: { label: '练习汉字', placeholder: '例如 山水日月' },
  pinyin: { label: '输入中文', placeholder: '例如 我爱学习，重庆银行' },
  number: { label: '练习数字', placeholder: '例如 0 1 12 100', maxlength: 800 },
  letters: { label: '练习字母', placeholder: '例如 ABCxyz' },
  words: { label: '练习单词', placeholder: '例如 cat apple school', maxlength: 2500 },
}

function selectionCounts(selectedStrokes) {
  return Object.fromEntries(STROKE_GROUPS.map(({ key, choices }) => [
    key, choices.filter(({ id }) => selectedStrokes[id]).length,
  ]))
}

function inputState(text, mode) {
  if (mode !== 'hanzi' && mode !== 'pinyin') return { text }
  const result = inspectHanzi(text)
  return {
    text: result.value,
    textCount: result.count,
    inputMaxLength: result.count === WRITING_INPUT_LIMIT ? result.value.length : -1,
    inputError: result.invalid ? '请输入常用汉字，空格和标点会自动跳过。' : '',
    inputNotice: result.limited ? '已保留前 ' + WRITING_INPUT_LIMIT + ' 个汉字。' : '',
  }
}

const initialSelection = Object.fromEntries(INITIAL_STROKES.map(({ id }) => [id, true]))

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { worksheetMode: String, toolKey: String, categoryId: String },

  data: {
    strokeGroups: STROKE_GROUPS,
    groupOpen: { basic: true },
    groupCounts: selectionCounts(initialSelection),
    selectedStrokes: initialSelection,
    examples: {},
    exampleFields: INITIAL_STROKES.map(({ id, name }) => ({ id, name, text: '' })),
    mode: 'strokes',
    inputLabels: INPUT_LABELS,
    inputLimit: WRITING_INPUT_LIMIT,
    inputMaxLength: -1,
    letterCases: LETTER_CASES,
    letterCase: 'paired',
    fonts: ENGLISH_FONTS.map(({ name }) => name),
    englishFontIndex: ENGLISH_FONTS.findIndex(font => font.key === DEFAULT_ENGLISH_FONT),
    text: '',
    textCount: 0,
    inputError: '',
    inputNotice: '',
    grids: GRIDS,
    grid: 'tian',
    sizeIndex: 0,
    gapIndex: 1,
    traceIndex: 5,
    sizeLabels: SIZES.map(value => value + ' mm'),
    gapLabels: GAPS.map(value => value + ' mm'),
    traceLabels: TRACE_COUNTS.map(value => value + ' 格'),
    highlight: true,
    blankRow: false,
    includeHeading: true,
    examplesOpen: false,
    advancedOpen: false,
    dirty: true,
    pdfDocumentId: '',
    error: '',
    notice: '',
    generating: false,
    exporting: false,
    exportError: '',
  },

  lifetimes: {
    attached() {
      this._active = true
      const mode = this.data.worksheetMode || 'strokes'
      const text = INITIAL_TEXT[mode] || ''
      this.setData({ mode, text })
      if (mode === 'strokes' || text) this.generate()
    },
    detached() {
      this._active = false
      this._cancelActionAd?.()
      releasePdfPreviewDocument(this.data.pdfDocumentId)
    },
  },

  pageLifetimes: {
    hide() { this._visibilityVersion = (this._visibilityVersion || 0) + 1 },
  },

  methods: {
    setDraft(update) {
      this._draftVersion = (this._draftVersion || 0) + 1
      releasePdfPreviewDocument(this.data.pdfDocumentId)
      this.setData({ ...update, dirty: true, pdfDocumentId: '', error: '', notice: '', exportError: '' })
    },

    chooseLetterCase(event) {
      const { letterCase } = event.currentTarget.dataset
      if (LETTER_CASES.some(item => item.key === letterCase) && letterCase !== this.data.letterCase) {
        this.setDraft({ letterCase })
      }
    },

    chooseEnglishFont(event) {
      const index = Number(event.detail.value)
      if (ENGLISH_FONTS[index] && index !== this.data.englishFontIndex) this.setDraft({ englishFontIndex: index })
    },

    toggleStrokeGroup(event) {
      const { group } = event.currentTarget.dataset
      if (STROKE_GROUPS.some(item => item.key === group)) {
        this.setData({ groupOpen: { ...this.data.groupOpen, [group]: !this.data.groupOpen[group] } })
      }
    },

    toggleStroke(event) {
      const { id } = event.currentTarget.dataset
      if (!STROKE_BY_ID.has(id)) return
      const selectedStrokes = { ...this.data.selectedStrokes, [id]: !this.data.selectedStrokes[id] }
      const exampleFields = STROKES.filter(item => selectedStrokes[item.id])
        .map(item => ({ id: item.id, name: item.name, text: this.data.examples[item.id] || '' }))
      this.setDraft({ selectedStrokes, exampleFields, groupCounts: selectionCounts(selectedStrokes) })
    },

    changeText(event) {
      this.setDraft(inputState(event.detail.value, this.data.mode))
    },

    changeExample(event) {
      const { id } = event.currentTarget.dataset
      if (!STROKE_BY_ID.has(id)) return
      const text = event.detail.value
      const examples = { ...this.data.examples, [id]: text }
      const exampleFields = this.data.exampleFields.map(item => item.id === id ? { ...item, text } : item)
      this.setDraft({ examples, exampleFields })
    },

    chooseGrid(event) {
      const { grid } = event.currentTarget.dataset
      if (GRIDS.some(item => item.key === grid) && grid !== this.data.grid) this.setDraft({ grid })
    },

    chooseOption(event) {
      const { field } = event.currentTarget.dataset
      const index = Number(event.detail.value)
      if (PICKERS[field]?.[index] !== undefined && index !== this.data[field]) this.setDraft({ [field]: index })
    },

    toggleOption(event) {
      const { field } = event.currentTarget.dataset
      if (['highlight', 'blankRow', 'includeHeading'].includes(field)) this.setDraft({ [field]: event.detail.value })
    },

    togglePanel(event) {
      const { field } = event.currentTarget.dataset
      if (field === 'examplesOpen' || field === 'advancedOpen') this.setData({ [field]: !this.data[field] })
    },

    generate() {
      const sheet = this.prepareWorksheet()
      if (sheet) this.showWorksheet(sheet)
    },

    async requestGenerate() {
      if (this.data.generating || this._exporting) return
      const sheet = this.prepareWorksheet()
      if (!sheet) return
      const draftVersion = this._draftVersion
      this.setData({ generating: true, error: '' })
      try {
        await runToolActionWithAd(this, {
          toolKey: this.data.toolKey,
          isActionCurrent: () => this._draftVersion === draftVersion,
          onConfigError: error => this.setData({ error }),
          run: () => this.showWorksheet(sheet),
        })
      } finally {
        if (this._active) this.setData({ generating: false })
      }
    },

    prepareWorksheet() {
      const { mode, text, grid, examples, selectedStrokes, sizeIndex, gapIndex, traceIndex,
        highlight, blankRow, letterCase, englishFontIndex, includeHeading } = this.data
      if (this.data.inputError) return
      try {
        return makeWritingWorksheet({
          mode, text, grid, examples, strokeIds: STROKES.filter(({ id }) => selectedStrokes[id]).map(({ id }) => id),
          cellMm: SIZES[sizeIndex], gapMm: GAPS[gapIndex], traceCount: TRACE_COUNTS[traceIndex],
          highlight, blankRow, letterCase, englishFont: ENGLISH_FONTS[englishFontIndex].key, includeHeading,
        })
      } catch (error) {
        this.setData({ dirty: true, error: error.message || '生成失败，请检查输入。' })
      }
    },

    showWorksheet(sheet) {
      const requestedTraceCount = TRACE_COUNTS[this.data.traceIndex]
      const previousId = this.data.pdfDocumentId
      try {
        const title = WRITING_MODES.find(item => item.key === sheet.options.mode).title
        const bytes = createWritingPdf(sheet)
        const pdfDocumentId = createPdfPreviewDocument(title, bytes, this.data.toolKey, this.data.categoryId)
        this.setData({
          pdfDocumentId,
          dirty: false,
          error: '',
          notice: sheet.options.traceCount !== requestedTraceCount
            ? '本次使用 ' + sheet.options.traceCount + ' 格描红，保留至少一格空白练习。' : '',
          exportError: '',
        })
      } catch (error) {
        this.setData({ dirty: true, pdfDocumentId: '', error: error.message || '生成失败，请检查输入。' })
      } finally {
        releasePdfPreviewDocument(previousId)
      }
    },

    async exportPdf() {
      const { pdfDocumentId, dirty, generating } = this.data
      if (dirty || !pdfDocumentId || generating || this._exporting) return
      const document = getPdfPreviewDocument(pdfDocumentId)
      if (!document) return
      this._exporting = true
      this.setData({ exporting: true, exportError: '' })
      try {
        const { title, bytes } = document
        const filePath = wx.env.USER_DATA_PATH + '/' + title + '.pdf'
        await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
          filePath, data: bytes.buffer, success: resolve, fail: reject,
        }))
        if (!this._active || this.data.pdfDocumentId !== pdfDocumentId) return
        await new Promise((resolve, reject) => wx.openDocument({
          filePath, fileType: 'pdf', showMenu: true, success: resolve, fail: reject,
        }))
      } catch {
        if (this._active) this.setData({ exportError: '暂时无法打开 PDF，请重试。' })
      } finally {
        this._exporting = false
        if (this._active) this.setData({ exporting: false })
      }
    },
  },
})
