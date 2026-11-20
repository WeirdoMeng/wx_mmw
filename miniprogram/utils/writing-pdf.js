const { chineseAt, latinAt, createA4Pdf } = require('./pdf-document')
const { layoutWritingPage } = require('./writing-layout')
const { WRITING_MODES } = require('./writing-tools')

const pathCommands = { M: 'm', L: 'l', C: 'c', Z: 'h' }

function position(value) {
  return Number(value.toFixed(4))
}

function pdfColor(color) {
  return color.slice(1).match(/../g)
    .map(channel => position(parseInt(channel, 16) / 255))
    .join(' ')
}

function drawLine({ x1, y1, x2, y2, color, width, dash }, pageHeight) {
  const pattern = dash?.length ? `[${dash.map(position).join(' ')}] 0 d ` : ''
  return `q ${pdfColor(color)} RG ${position(width)} w ${pattern}`
    + `${position(x1)} ${position(pageHeight - y1)} m ${position(x2)} ${position(pageHeight - y2)} l S Q\n`
}

function formFor(commands, strokeWidth, resources) {
  let styles = resources.byPath.get(commands)
  if (!styles) {
    styles = new Map()
    resources.byPath.set(commands, styles)
  }
  const ready = styles.get(strokeWidth)
  if (ready) return ready

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  const path = commands.map(([command, ...points]) => {
    for (let index = 0; index < points.length; index += 2) {
      left = Math.min(left, points[index])
      top = Math.min(top, points[index + 1])
      right = Math.max(right, points[index])
      bottom = Math.max(bottom, points[index + 1])
    }
    return [...points.map(position), pathCommands[command]].join(' ')
  }).join('\n')
  const padding = (strokeWidth || 0) / 2 + 0.01
  const bounds = [left - padding, top - padding, right + padding, bottom + padding].map(position)
  const name = 'G' + (resources.forms.length + 1)
  const drawing = strokeWidth === null ? path + '\nf\n' : `${position(strokeWidth)} w\n${path}\nS\n`
  resources.forms.push({ name, bounds, drawing })
  styles.set(strokeWidth, name)
  return name
}

function drawPaths({ paths, x, y, scale, color }, pageHeight, resources) {
  const rgb = pdfColor(color)
  const drawing = paths.map(({ commands, fill, strokeWidth, source }) => {
    const form = formFor(source?.commands || commands, fill ? null : (source?.strokeWidth ?? strokeWidth), resources)
    if (!source) return `/${form} Do\n`
    const sourceScale = source.scale.toFixed(8)
    return `q ${sourceScale} 0 0 -${sourceScale} ${position(source.x)} ${position(source.baseline)} cm /${form} Do Q\n`
  }).join('')
  const scaleOperand = scale.toFixed(8)
  return `q ${rgb} rg ${rgb} RG 1 J 1 j\n`
    + `${scaleOperand} 0 0 -${scaleOperand} ${position(x)} ${position(pageHeight - y)} cm\n`
    + drawing + 'Q\n'
}

function drawGlyph(glyph, pageHeight, resources) {
  if (glyph.kind === 'paths') return drawPaths(glyph, pageHeight, resources)
  const textAt = glyph.kind === 'hanzi' ? chineseAt : latinAt
  const text = textAt(glyph.text, glyph.x, pageHeight - glyph.y, position(glyph.size))
  return `q ${pdfColor(glyph.color)} rg\n${text}Q\n`
}

function createWritingPdf(worksheet) {
  if (!worksheet || !Array.isArray(worksheet.pages) || !worksheet.pages.length) {
    throw new Error('请先生成字帖。')
  }
  const title = WRITING_MODES.find(mode => mode.key === worksheet.options.mode).title
  const resources = { byPath: new WeakMap(), forms: [] }
  const drawings = worksheet.pages.map((_, index) => {
    const { lines, glyphs, height } = layoutWritingPage(worksheet, index + 1)
    return lines.map(item => drawLine(item, height)).join('')
      + glyphs.map(glyph => drawGlyph(glyph, height, resources)).join('')
  })
  return createA4Pdf(drawings, title, resources.forms)
}

module.exports = { createWritingPdf }
