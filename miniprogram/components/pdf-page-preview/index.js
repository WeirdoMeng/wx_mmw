const { renderToolPdfPage } = require('../../utils/api')
const { getPdfPreviewDocument } = require('../../utils/pdf-preview-document')

const PAGE_CACHE_LIMIT = 3

function removeImage(filePath) {
  wx.getFileSystemManager().unlink({ filePath, fail() {} })
}

function saveImage(filePath, imageBase64) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
    filePath, data: imageBase64, encoding: 'base64', success: resolve, fail: reject,
  }))
}

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    documentId: { type: String, value: '', observer: 'openDocument' },
  },
  data: {
    page: 1,
    pageCount: 0,
    imagePath: '',
    loading: false,
    error: '',
  },
  lifetimes: {
    attached() {
      this._active = true
      this.openDocument(this.data.documentId)
    },
    detached() {
      this._active = false
      this.clearImages()
    },
  },
  methods: {
    clearImages() {
      this._request = null
      for (const path of this._files?.values() || []) removeImage(path)
      this._files = new Map()
    },

    openDocument(id) {
      if (!this._active || id === this._documentId) return
      this.clearImages()
      this._documentId = id
      this.setData({ page: 1, pageCount: 0, imagePath: '', error: '', loading: Boolean(id) })
      if (id) void this.loadPage(1)
    },

    async loadPage(page) {
      const id = this._documentId
      const document = getPdfPreviewDocument(id)
      if (!document) {
        this.setData({ loading: false, error: 'PDF 已失效，请重新生成。' })
        return
      }
      this._requestedPage = page
      const cached = this._files.get(page)
      if (cached) {
        this._files.delete(page)
        this._files.set(page, cached)
        this.setData({ page, imagePath: cached, loading: false, error: '' })
        return
      }

      const request = {}
      this._request = request
      const isCurrent = () => this._active && this._documentId === id && this._request === request
      this.setData({ loading: true, error: '' })
      const path = wx.env.USER_DATA_PATH + '/' + id + '-' + page + '.png'
      try {
        const result = await renderToolPdfPage(document, page)
        if (!isCurrent()) return
        if (result?.page !== page || !Number.isInteger(result.pageCount) || result.pageCount < page
          || typeof result.imageBase64 !== 'string' || !result.imageBase64) {
          throw new Error('PDF 页面数据有误，请重试。')
        }
        await saveImage(path, result.imageBase64)
        if (!isCurrent()) {
          removeImage(path)
          return
        }
        this._files.set(page, path)
        this.setData({ page, pageCount: result.pageCount, imagePath: path, loading: false })
        if (this._files.size > PAGE_CACHE_LIMIT) {
          const oldest = this._files.keys().next().value
          removeImage(this._files.get(oldest))
          this._files.delete(oldest)
        }
      } catch (error) {
        if (isCurrent()) {
          this.setData({ loading: false, error: error.message || '暂时无法读取 PDF 页面，请重试。' })
        }
      }
    },

    movePage(event) {
      const { page, pageCount, loading } = this.data
      const step = Number(event.currentTarget.dataset.step)
      const next = page + step
      if (!loading && (step === -1 || step === 1) && next >= 1 && next <= pageCount) void this.loadPage(next)
    },

    retryPage() {
      if (!this.data.loading) void this.loadPage(this._requestedPage || 1)
    },

    imageError(event) {
      const { path } = event.currentTarget.dataset
      if (path !== this.data.imagePath) return
      const { page } = this.data
      this._files.delete(page)
      removeImage(path)
      if (this.data.loading) this.setData({ imagePath: '' })
      else {
        this._requestedPage = page
        this.setData({ imagePath: '', error: '当前 PDF 页面无法显示，请重试。' })
      }
    },
  },
})
