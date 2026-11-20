const { STROKES, WRITING_MODES, WRITING_PAGE } = require('./writing-worksheet')
const { layoutLatin } = require('./writing-latin')
const { findHanziOutline } = require('./writing-hanzi-outlines')

const STROKE_PATHS = new Map(STROKES.map(({ id, path }) => [id, [{ commands: path, fill: true }]]))
const INK = { dark: '#1f1f1f', highlight: '#91211a', trace: '#9e9e9e', line: '#9e9e9e', guide: '#c7c7c7' }

function drawLine(lines, x1, y1, x2, y2, guide = false) {
  lines.push({
    x1, y1, x2, y2,
    color: guide ? INK.guide : INK.line,
    width: guide ? 0.4 : 0.5,
    ...(guide ? { dash: [1.5, 1.5] } : {}),
  })
}

function drawGrid(lines, grid, x, y, width, height, columns) {
  const right = x + width * columns
  drawLine(lines, x, y, right, y)
  drawLine(lines, x, y + height, right, y + height)
  if (grid === 'pinyin') {
    for (const fraction of [1 / 3, 2 / 3]) {
      drawLine(lines, x, y + height * fraction, right, y + height * fraction, true)
    }
    return
  }
  for (let col = 0; col <= columns; col += 1) {
    const left = x + col * width
    drawLine(lines, left, y, left, y + height)
    if (col === columns || grid === 'square') continue
    drawLine(lines, left + width / 2, y, left + width / 2, y + height, true)
    drawLine(lines, left, y + height / 2, left + width, y + height / 2, true)
    if (grid === 'mi') {
      drawLine(lines, left, y, left + width, y + height, true)
      drawLine(lines, left, y + height, left + width, y, true)
    }
  }
}

function hanziGlyph(text, x, y, size, color = INK.dark) {
  const outline = findHanziOutline(text)
  if (outline) return { kind: 'paths', x, y, scale: size, paths: [{ commands: outline.commands, fill: true }], color }
  return { kind: 'hanzi', text, x, y, size, color }
}

function drawRow(scene, row, x, y, worksheet) {
  const { options, columns, cellSize: height, cellWidth: width = height } = worksheet
  drawGrid(scene.lines, options.grid, x, y, width, height, columns)
  if (row.blank) return

  const paths = STROKE_PATHS.get(row.strokeId)
  const example = Boolean(paths && row.text)
  const traceFrom = example ? 2 : 1
  const variant = options.mode === 'letters' || options.mode === 'words' ? options.englishFont : options.mode
  const latin = options.grid === 'pinyin' || options.mode === 'number'
    ? layoutLatin(row.text, { width, height, variant })
    : null

  for (let col = 0; col < traceFrom + options.traceCount; col += 1) {
    const left = x + col * width
    const color = col === 0 ? (options.highlight ? INK.highlight : INK.dark) : INK.trace
    if (example && col === 1) {
      scene.glyphs.push(hanziGlyph(row.text, left + height * 0.12, y + height * 0.775, height * 0.76))
    } else if (paths) {
      scene.glyphs.push({ kind: 'paths', x: left + height * 0.07, y: y + height * 0.07,
        scale: height * 0.86 / 100, paths, color })
    } else if (latin) {
      scene.glyphs.push({ kind: 'paths', x: left, y, scale: 1, paths: latin.paths, color })
    } else {
      scene.glyphs.push(hanziGlyph(row.text, left + height * 0.12, y + height * 0.775, height * 0.76, color))
    }
  }
}

function layoutWritingPage(worksheet, pageNumber) {
  const page = worksheet.pages[pageNumber - 1]
  if (!page) return null
  const { width, height, margin, firstTop, nextTop } = WRITING_PAGE
  const { columns, cellSize, cellWidth = cellSize, gap, options } = worksheet
  const firstHeading = pageNumber === 1 && options.includeHeading !== false
  const scene = { width, height, lines: [], glyphs: [] }
  if (firstHeading) {
    const title = WRITING_MODES.find(mode => mode.key === options.mode).title
    const dateX = width / 2 + 14
    scene.glyphs.push(
      hanziGlyph(title, margin, height - 780, 25),
      hanziGlyph('姓名', margin, height - 749, 12),
      hanziGlyph('日期', dateX, height - 749, 12),
    )
    drawLine(scene.lines, margin + 30, height - 747, dateX - 38, height - 747)
    drawLine(scene.lines, dateX + 30, height - 747, width - margin, height - 747)
  }

  const top = height - (firstHeading ? firstTop : nextTop)
  const left = (width - cellWidth * columns) / 2
  page.rows.forEach((row, index) => drawRow(scene, row, left, top + index * (cellSize + gap), worksheet))
  const pageLabel = pageNumber + ' / ' + worksheet.pages.length
  drawLine(scene.lines, margin, height - 45, width - margin, height - 45)
  scene.glyphs.push({
    kind: 'label', text: pageLabel, x: (width - pageLabel.length * 6) / 2, y: height - 29, size: 10, color: INK.dark,
  })
  return scene
}

module.exports = { layoutWritingPage }
