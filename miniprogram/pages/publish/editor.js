const { request, uploadImages } = require('../../utils/api')
const { MAX_PHOTOS, choosePhotos } = require('../../utils/photo-picker')

const PUBLISH_TYPES = ['餐食', '日常']
const POST_CHANGED = 'postChanged'

function today() {
  const date = new Date()
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function defaultMealTitle(date) {
  return '今日餐食 ' + date
}

function newPublishForm(type) {
  const date = today()
  const typeIndex = type === 'daily' ? 1 : 0
  return {
    requestId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
    typeIndex,
    title: typeIndex === 0 ? defaultMealTitle(date) : '',
    date,
    note: '',
    photos: []
  }
}

function editPublishForm(post) {
  return {
    ...newPublishForm(post.type),
    postId: post.id,
    revision: post.revision,
    title: post.title,
    date: post.date,
    note: post.note || '',
    photos: post.images.map((photo) => ({ ...photo, key: photo.id, path: photo.url, saved: true }))
  }
}

const publishEditor = {
  onPublishField(event) {
    if (this.data.publishing) return
    const { field } = event.currentTarget.dataset
    if (field === 'title' || field === 'note') {
      this.setData({ ['publishForm.' + field]: event.detail.value })
    }
  },

  onPublishType(event) {
    this.selectPublishType(Number(event.detail.value))
  },

  onPublishTypeTab(event) {
    this.selectPublishType(Number(event.currentTarget.dataset.index))
  },

  selectPublishType(typeIndex) {
    const form = this.data.publishForm
    if (this.data.publishing || !form || (typeIndex !== 0 && typeIndex !== 1) || typeIndex === form.typeIndex) return
    const patch = { 'publishForm.typeIndex': typeIndex }
    if (!form.postId) {
      if (typeIndex === 0 && !form.title.trim()) patch['publishForm.title'] = defaultMealTitle(form.date)
      if (typeIndex === 1 && form.title === defaultMealTitle(form.date)) patch['publishForm.title'] = ''
    }
    this.setData(patch)
  },

  onPublishDate(event) {
    const form = this.data.publishForm
    if (this.data.publishing || !form) return
    const date = event.detail.value
    const patch = { 'publishForm.date': date }
    if (!form.postId && form.typeIndex === 0 && form.title === defaultMealTitle(form.date)) {
      patch['publishForm.title'] = defaultMealTitle(date)
    }
    this.setData(patch)
  },

  async onAddPublishPhotos() {
    if (this.data.publishing || this._choosingPublishPhotos) return
    const form = this.data.publishForm
    if (!form || form.photos.length >= MAX_PHOTOS) return
    this._choosingPublishPhotos = true
    const draft = this._publishDraft
    try {
      const paths = await choosePhotos(MAX_PHOTOS - form.photos.length)
      if (!paths.length || !this.data.publishForm || draft !== this._publishDraft) return
      const photos = this.data.publishForm.photos
      const incoming = paths.map((path, index) => ({ key: Date.now() + '-' + photos.length + '-' + index, path }))
      this.setData({ 'publishForm.photos': photos.concat(incoming).slice(0, MAX_PHOTOS) })
    } catch (error) {
      if (this.data.publishForm && draft === this._publishDraft) {
        wx.showToast({ title: error?.message || '无法打开照片', icon: 'none' })
      }
    } finally {
      this._choosingPublishPhotos = false
    }
  },

  onRemovePublishPhoto(event) {
    if (this.data.publishing || this._choosingPublishPhotos || !this.data.publishForm) return
    const { key } = event.detail
    this.setData({ 'publishForm.photos': this.data.publishForm.photos.filter((item) => item.key !== key) })
  },

  async onPreviewPublishPhoto(event) {
    const form = this.data.publishForm
    const draft = this._publishDraft
    if (!form || this.data.publishing || this._previewingPublishPhoto) return
    const { key } = event.detail
    const currentDraft = () => this._publishDraft === draft && this.data.publishForm?.requestId === form.requestId
    const selected = form.photos.find((item) => item.key === key)
    if (!selected) return
    this._previewingPublishPhoto = true
    try {
      if (selected.saved) {
        const { post } = await request('getPost', { id: form.postId })
        if (!currentDraft()) return
        const recent = new Map(post.images.map((photo) => [photo.id, photo]))
        this.setData({ 'publishForm.photos': this.data.publishForm.photos.map((photo) => {
          if (!photo.saved) return photo
          const image = recent.get(photo.id)
          return { ...photo, path: image?.url || '', url: image?.url || '', failed: !image?.url }
        }) })
      }
      const photos = this.data.publishForm.photos
      const current = photos.find((item) => item.key === key)
      if (!current?.path) throw new Error('照片暂不可用，请重试')
      wx.previewImage({
        current: current.path,
        urls: photos.map((item) => item.path).filter(Boolean),
        fail: () => {
          if (currentDraft()) wx.showToast({ title: '照片预览失败，请重试', icon: 'none' })
        },
      })
    } catch (error) {
      if (currentDraft()) wx.showToast({ title: error.message, icon: 'none' })
    } finally {
      this._previewingPublishPhoto = false
    }
  },

  async onSubmitPost() {
    if (this.data.publishing || this._choosingPublishPhotos || !this.data.publishForm) return
    const form = this.data.publishForm
    const current = () => this.data.publishForm?.requestId === form.requestId
      && this._publishDraft?.organizationId === getApp().globalData.session?.organization?.id
    const title = form.title.trim()
    if (!title) {
      this.setData({ publishError: '请输入动态标题' })
      return
    }
    this.setData({ publishing: true, publishError: '' })
    try {
      const assetIds = []
      for (let index = 0; index < form.photos.length; index += 1) {
        if (!current()) return
        const photo = form.photos[index]
        if (photo.id) {
          assetIds.push(photo.id)
        } else {
          const [uploaded] = await uploadImages([photo.path])
          if (!current()) return
          if (!uploaded?.id) throw new Error('照片尚未完整上传，请重试。')
          assetIds.push(uploaded.id)
          this.setData({ ['publishForm.photos[' + index + '].id']: uploaded.id })
        }
      }
      if (!current()) return
      const type = form.typeIndex === 1 ? 'daily' : 'meal'
      const payload = {
        type,
        title,
        date: form.date,
        note: form.note.trim(),
        assetIds,
        requestId: form.requestId
      }
      if (form.postId) {
        const fingerprint = JSON.stringify(payload)
        if (this._editAttempt?.fingerprint !== fingerprint) {
          this._editAttempt = { fingerprint, requestId: newPublishForm(type).requestId }
        }
        Object.assign(payload, { id: form.postId, revision: form.revision, requestId: this._editAttempt.requestId })
      }
      await request(form.postId ? 'updatePost' : 'publishPost', payload)
      if (!current()) return
      this.setData({ publishing: false })
      this.onPostPublished(type)
    } catch (error) {
      if (current()) {
        this.setData({ publishing: false, publishError: error.message })
      }
    }
  }
}

module.exports = { PUBLISH_TYPES, POST_CHANGED, newPublishForm, editPublishForm, publishEditor }
