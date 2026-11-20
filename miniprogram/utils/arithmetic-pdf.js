const { A4_WIDTH: WIDTH, chineseAt, latinAt, line, createA4Pdf } = require('./pdf-document')
const MARGIN = 44
const BODY_WIDTH = WIDTH - MARGIN * 2
const FORMATS = {
  horizontal: '横式口算',
  blank: '算式填空',
  vertical: '竖式计算',
}

function mixedAt(text, x, y, size = 13) {
  const latin = /^[\x00-\xff−]+$/
  const parts = String(text).match(/[\x00-\xff−]+|[^\x00-\xff−]+/g) || []
  let commands = ''
  for (const part of parts) {
    const usesLatin = latin.test(part)
    commands += usesLatin ? latinAt(part, x, y, size) : chineseAt(part, x, y, size)
    x += part.length * size * (usesLatin ? 0.6 : 1)
  }
  return commands
}

function pageHeader({ format, totalQuestions }) {
  let content = chineseAt('算术练习', MARGIN, 775, 24)
  content += mixedAt(`${FORMATS[format]}  ·  共 ${totalQuestions} 题`, MARGIN, 749, 12)
  for (const [label, offset, width] of [['姓名', 0, 119], ['班级', 171, 119], ['日期', 342, 129]]) {
    content += chineseAt(label, MARGIN + offset, 714, 12)
    content += line(MARGIN + offset + 30, 712, MARGIN + offset + 30 + width, 712)
  }
  return content + line(MARGIN, 695, WIDTH - MARGIN, 695)
}

function pageFooter({ answers, number, pageCount }) {
  let content = line(MARGIN, 59, WIDTH - MARGIN, 59)
  if (answers) content += chineseAt('答案', MARGIN, 41, 10)
  const footer = `${number} / ${pageCount}`
  content += latinAt(footer, (WIDTH - footer.length * 6) / 2, 41, 10)
  return content
}

function drawVertical(question, x, y, width) {
  const size = 16
  const glyphWidth = size * 0.6
  const a = String(question.a)
  const b = String(question.b)
  let commands = latinAt(`${question.id}.`, x, y, 10)
  if (question.operation === 'div') {
    const barX = x + Math.max(38, width / 2 - (a.length * glyphWidth) / 2)
    const roof = y - 1
    commands += latinAt(b, barX - 7 - b.length * glyphWidth, y - 20, size)
    commands += latinAt(a, barX + 5, y - 20, size)
    commands += line(barX, roof, barX + a.length * glyphWidth + 18, roof, 0, 0.85)
    commands += `q 0 G 0.85 w ${barX.toFixed(2)} ${roof} m ${barX.toFixed(2)} ${roof - 11} ${(barX - 3).toFixed(2)} ${roof - 19} ${(barX - 7).toFixed(2)} ${roof - 25} c S Q\n`
    return commands
  }
  const right = x + width * 0.73
  const operationX = right - (Math.max(a.length, b.length) + 1.3) * glyphWidth
  commands += latinAt(a, right - a.length * glyphWidth, y, size)
  commands += latinAt(b, right - b.length * glyphWidth, y - 19, size)
  commands += latinAt(question.symbol, operationX, y - 19, size)
  commands += line(operationX - 3, y - 24, right + 4, y - 24, 0, 0.85)
  return commands
}

function drawQuestions(page, heading) {
  const { answers, format, columns, number } = heading
  const vertical = !answers && format === 'vertical'
  const columnWidth = BODY_WIDTH / columns
  const rowHeight = vertical ? 120 : answers ? 23 : 29
  const firstPage = number === 1
  const startY = firstPage ? 666 : 790
  let commands = firstPage ? pageHeader(heading) : ''
  page.forEach((question, index) => {
    const column = index % columns
    const x = MARGIN + column * columnWidth
    const y = startY - Math.floor(index / columns) * rowHeight
    if (vertical) {
      commands += drawVertical(question, x, y, columnWidth)
    } else {
      commands += latinAt(`${question.id}.`, x, y, 10)
      // Leave enough room for a wide remainder expression and a three-digit item number.
      const value = answers ? question.answer : question.prompt
      const questionWidth = String(value).length * 0.6 + (String(value).match(/[^\x00-\xff−]/g)?.length || 0) * 0.4
      const size = Math.min(13, Math.floor((columnWidth - 39) / Math.max(1, questionWidth)))
      commands += mixedAt(value, x + 29, y, size)
    }
  })
  return commands + pageFooter(heading)
}

function paginate(list, pageSize) {
  const pages = []
  for (let offset = 0; offset < list.length; offset += pageSize) pages.push(list.slice(offset, offset + pageSize))
  return pages
}

function createArithmeticPdf(questions, { format = 'horizontal', includeKey = true } = {}) {
  if (!Array.isArray(questions) || !questions.length || typeof FORMATS[format] !== 'string') {
    throw new Error('请先生成算术题。')
  }

  const columns = format !== 'vertical' && questions.some(item => item.remainder > 0) ? 2 : 3
  const practicePages = format === 'vertical'
    ? [questions.slice(0, columns * 5), ...paginate(questions.slice(columns * 5), columns * 6)]
    : paginate(questions, columns * 20)
  const pages = practicePages.map(items => ({ items, answers: false, columns }))
  if (includeKey) {
    for (const items of paginate(questions, 100)) pages.push({ items, answers: true, columns: 4 })
  }

  const drawings = pages.map(({ items, answers, columns }, index) => drawQuestions(items, {
    answers, format, columns, totalQuestions: questions.length, number: index + 1, pageCount: pages.length,
  }))
  return createA4Pdf(drawings, '算术练习')
}

module.exports = { createArithmeticPdf }
