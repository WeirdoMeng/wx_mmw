const { sharePhotoSource, isLocalSharePath } = require('../../utils/share-preview')

const WIDTH = 600
const CHAT_HEIGHT = 480
const TIMELINE_HEIGHT = 600
const PHOTO_BUDGET = 6500
const DOWNLOAD_TIMEOUT = 5000
const CANVAS_TIMEOUT = 800

function callbackResult(start, timeout) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout)
    const finish = (value) => {
      clearTimeout(timer)
      resolve(value)
    }
    try {
      start(finish)
    } catch {
      finish(null)
    }
  })
}

function selectCanvas(component) {
  return callbackResult((finish) => {
    component.createSelectorQuery().select('#share-cover-canvas').fields({ node: true })
      .exec((results) => finish(results?.[0]?.node || null))
  }, CANVAS_TIMEOUT)
}

function localPath(path, timeout) {
  if (isLocalSharePath(path)) return Promise.resolve(path)
  if (!/^https:\/\//.test(path) || timeout <= 0) return Promise.resolve(null)
  return callbackResult((finish) => {
    wx.downloadFile({
      url: path,
      timeout,
      success: (result) => finish(result.statusCode === 200 ? result.tempFilePath : null),
      fail: () => finish(null),
    })
  }, timeout + 80)
}

function decodePhoto(canvas, path, timeout) {
  return callbackResult((finish) => {
    const image = canvas.createImage()
    image.onload = () => finish(image.width > 0 && image.height > 0 ? image : null)
    image.onerror = () => finish(null)
    image.src = path
  }, timeout)
}

async function findPhoto(canvas, images, isCurrent) {
  const expiresAt = Date.now() + PHOTO_BUDGET
  for (const photo of Array.isArray(images) ? images : []) {
    const remaining = expiresAt - Date.now()
    if (!isCurrent() || remaining <= 0) break
    const path = await localPath(sharePhotoSource(photo), Math.min(DOWNLOAD_TIMEOUT, remaining))
    const decodeTime = Math.min(CANVAS_TIMEOUT, expiresAt - Date.now())
    if (!path || decodeTime <= 0) continue
    if (!isCurrent()) return null
    const image = await decodePhoto(canvas, path, decodeTime)
    if (image) return { image, path }
  }
  return null
}

function fitLines(context, value, maxWidth, maxLines) {
  const chars = Array.from(typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
  const lines = []
  let line = ''
  for (const char of chars) {
    if (line && context.measureText(line + char).width > maxWidth) {
      if (lines.length + 1 === maxLines) {
        const fit = Array.from(line.trimEnd())
        while (fit.length && context.measureText(fit.join('') + '…').width > maxWidth) fit.pop()
        return [...lines, fit.join('') + '…']
      }
      lines.push(line.trimEnd())
      line = ''
    }
    if (line || char !== ' ') line += char
  }
  if (line) lines.push(line)
  return lines
}

function drawCrop(context, image, height) {
  const ratio = Math.min(image.width / WIDTH, image.height / height)
  const sourceWidth = WIDTH * ratio
  const sourceHeight = height * ratio
  context.drawImage(image, (image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2,
    sourceWidth, sourceHeight, 0, 0, WIDTH, height)
}

function drawCover(canvas, record, image, height) {
  canvas.width = WIDTH
  canvas.height = height
  const context = canvas.getContext('2d')
  context.fillStyle = '#fffdf8'
  context.fillRect(0, 0, WIDTH, height)
  context.textBaseline = 'top'
  const photoHeight = height === TIMELINE_HEIGHT ? 408 : 308
  if (image) drawCrop(context, image, photoHeight)
  const accentTop = image ? photoHeight : 0
  context.fillStyle = '#205a40'
  context.fillRect(0, accentTop, WIDTH, image ? 5 : 12)

  const inset = image ? 32 : 44
  const titleFont = image ? 'bold 35px sans-serif' : 'bold 49px sans-serif'
  const noteFont = image ? '26px sans-serif' : '30px sans-serif'
  const titleStep = image ? 44 : 60
  const noteStep = image ? 34 : 41
  const textWidth = WIDTH - inset * 2
  context.font = titleFont
  const title = fitLines(context, record.title, textWidth, image ? 1 : 3)
  context.font = noteFont
  const summary = fitLines(context, record.summary, textWidth, image ? 2 : 3)
  const gap = title.length && summary.length ? 8 : 0
  const contentHeight = title.length * titleStep + summary.length * noteStep + gap
  const top = image ? photoHeight + Math.floor((height - photoHeight - contentHeight) / 2) : Math.floor((height - contentHeight) / 2)
  context.fillStyle = '#123d30'
  context.font = titleFont
  title.forEach((line, index) => context.fillText(line, inset, top + index * titleStep))
  context.fillStyle = '#4d6255'
  context.font = noteFont
  const noteTop = top + title.length * titleStep + gap
  summary.forEach((line, index) => context.fillText(line, inset, noteTop + index * noteStep))
}

function encodeCover(canvas, record, image, height) {
  return callbackResult((finish) => {
    drawCover(canvas, record, image, height)
    wx.canvasToTempFilePath({
      canvas,
      width: WIDTH,
      height,
      destWidth: WIDTH,
      destHeight: height,
      fileType: 'jpg',
      quality: 0.9,
      success: (result) => finish(result.tempFilePath || null),
      fail: () => finish(null),
    })
  }, CANVAS_TIMEOUT)
}

Component({
  properties: { record: { type: Object, value: null } },

  observers: {
    record(value) {
      if (this._coverMounted) this.prepareCover(value)
    },
  },

  lifetimes: {
    ready() {
      this._coverMounted = true
      this.prepareCover(this.data.record)
    },
    detached() {
      this._coverMounted = false
    },
  },

  methods: {
    prepareCover(record) {
      const revision = (this._coverRevision || 0) + 1
      this._coverRevision = revision
      if (!record?.key) return

      const isCurrent = () => this._coverMounted && this._coverRevision === revision
      this._coverQueue = (this._coverQueue || Promise.resolve()).then(async () => {
        if (!isCurrent()) return
        const result = { key: record.key, chat: '', timeline: '', photo: '' }
        try {
          const canvas = await selectCanvas(this)
          if (canvas && isCurrent()) {
            const photo = await findPhoto(canvas, record.images, isCurrent)
            if (!isCurrent()) return
            result.photo = photo?.path || ''
            result.chat = await encodeCover(canvas, record, photo?.image, CHAT_HEIGHT) || ''
            if (record.aspect === 'both' && isCurrent()) {
              result.timeline = await encodeCover(canvas, record, photo?.image, TIMELINE_HEIGHT) || ''
            }
          }
        } finally {
          if (isCurrent()) this.triggerEvent('ready', result)
        }
      }).catch(() => {})
    },
  },
})
