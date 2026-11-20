const { STROKES } = require('./writing-strokes')
const { toPinyin } = require('./writing-pinyin')
const { WRITING_MODES } = require('./writing-tools')
const { ENGLISH_FONTS, DEFAULT_ENGLISH_FONT } = require('./writing-latin')

const WRITING_PAGE = {
  width: 595.28, height: 841.89, margin: 36, firstTop: 727, nextTop: 797, bottom: 56,
}
const POINTS_PER_MM = 72 / 25.4
const WRITING_INPUT_LIMIT = 100

const strokeIds = new Set(STROKES.map(stroke => stroke.id))
const hanzi = /^[〇\u4e00-\u9fff]$/
const ignored = /^[\s\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\u00b7\u2000-\u206f\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]$/

function inspectHanzi(text, limit = WRITING_INPUT_LIMIT) {
  let value = ''
  let count = 0
  let limited = false
  let invalid = false
  for (const char of text) {
    if (hanzi.test(char)) {
      if (count === limit) {
        limited = true
        continue
      }
      count += 1
    } else if (!ignored.test(char)) {
      invalid = true
    }
    value += char
  }
  return { value, count, limited, invalid }
}

function validateHanzi(text, limit = WRITING_INPUT_LIMIT) {
  if (typeof text !== 'string') throw new Error('请输入要练习的汉字。')
  const result = inspectHanzi(text, limit)
  if (result.invalid) throw new Error('请输入常用汉字，空格和标点会自动跳过。')
  if (result.limited) {
    throw new Error(limit === 1 ? '每个笔画只能填写 1 个例字。' : '每份字帖最多输入 ' + limit + ' 个汉字。')
  }
  return result
}

function charactersIn(text) {
  return [...text].filter(char => hanzi.test(char))
}

function textRows(text, mode) {
  const input = validateHanzi(text)
  if (!input.count) throw new Error('请至少输入 1 个汉字。')
  if (mode === 'hanzi') return charactersIn(input.value)
  const syllables = toPinyin(input.value)
  return [...input.value].flatMap((char, index) => {
    if (!hanzi.test(char)) return []
    if (!syllables[index]) throw new Error('「' + char + '」暂无拼音，请修改后再生成。')
    return [syllables[index]]
  })
}

function numberTokens(text) {
  return text.replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10))
    .split(/[\s,，、;；]+/).filter(Boolean)
}

function numberRows(text) {
  if (typeof text !== 'string') throw new Error('请输入要练习的数字。')
  const tokens = numberTokens(text)
  if (!tokens.length) throw new Error('请至少输入 1 组数字。')
  if (tokens.length > WRITING_INPUT_LIMIT) throw new Error('每份字帖最多输入 ' + WRITING_INPUT_LIMIT + ' 组数字。')
  if (tokens.some(token => !/^\d{1,6}$/.test(token))) {
    throw new Error('每组请输入 1 至 6 位数字，多组用空格、逗号或换行分隔。')
  }
  return tokens
}

function englishRows(text, mode, letterCase) {
  if (typeof text !== 'string') throw new Error('请输入要练习的英文。')
  const normalized = text.replace(/[’‘]/g, "'")
  const tokens = mode === 'letters'
    ? [...normalized.replace(/[\s,，、;；]+/g, '')]
    : normalized.split(/[\s,，、;；]+/).filter(Boolean)
  if (!tokens.length) throw new Error(mode === 'letters' ? '请至少输入一个英文字母。' : '请至少输入一个英文单词。')
  if (tokens.length > WRITING_INPUT_LIMIT) throw new Error('每份字帖最多输入 ' + WRITING_INPUT_LIMIT + (mode === 'letters' ? ' 个字母。' : ' 个单词。'))
  if (mode === 'words') {
    if (tokens.some(word => word.length > 24 || !/^[a-z]+(?:['-][a-z]+)*$/i.test(word))) {
      throw new Error('请输入英文单词，每个最多 24 个字符，支持连字符和撇号。')
    }
    return tokens
  }
  if (tokens.some(letter => !/^[a-z]$/i.test(letter))) throw new Error('请输入 A–Z 英文字母。')
  return tokens.map(letter => {
    if (letterCase === 'upper') return letter.toUpperCase()
    if (letterCase === 'lower') return letter.toLowerCase()
    return letter.toUpperCase() + letter.toLowerCase()
  })
}

function strokeRows(selected, examples) {
  if (!Array.isArray(selected) || !selected.length || selected.some(id => !strokeIds.has(id))) {
    throw new Error('请从笔画列表中至少选择一个笔画。')
  }
  if (!examples || typeof examples !== 'object' || Array.isArray(examples)) {
    throw new Error('请重新填写笔画例字。')
  }
  return [...new Set(selected)].map(strokeId => ({
    text: charactersIn(validateHanzi(examples[strokeId] ?? '', 1).value).join(''), strokeId, blank: false,
  }))
}

function paginate(practiceRows, cellSize, gap, blankRow, includeHeading) {
  const pages = []
  let rows = []
  const rowsPerPractice = blankRow ? 2 : 1
  const capacity = top => Math.floor((top - WRITING_PAGE.bottom + gap) / (cellSize + gap))
  let maxRows = capacity(includeHeading ? WRITING_PAGE.firstTop : WRITING_PAGE.nextTop)
  for (const practice of practiceRows) {
    if (rows.length + rowsPerPractice > maxRows) {
      pages.push({ rows })
      rows = []
      maxRows = capacity(WRITING_PAGE.nextTop)
    }
    rows.push(practice)
    if (blankRow) rows.push({ text: '', strokeId: '', blank: true })
  }
  pages.push({ rows })
  return pages
}

function makeWritingWorksheet(input = {}) {
  const {
    mode = 'strokes', text = '', strokeIds: selected = ['heng', 'shu', 'pie', 'dian', 'na'], examples = {},
    grid = 'tian', cellMm = 10, gapMm = 2, traceCount = 5, highlight = true, blankRow = false,
    letterCase = 'paired', englishFont = DEFAULT_ENGLISH_FONT, includeHeading = true,
  } = input
  if (!WRITING_MODES.some(item => item.key === mode) || !['tian', 'mi', 'square', 'pinyin'].includes(grid) ||
      ![10, 12, 15, 18].includes(cellMm) || ![0, 2, 4].includes(gapMm) ||
      !Number.isInteger(traceCount) || traceCount < 0 || traceCount > 8 ||
      typeof highlight !== 'boolean' || typeof blankRow !== 'boolean' || typeof includeHeading !== 'boolean' ||
      !['paired', 'upper', 'lower'].includes(letterCase) || !ENGLISH_FONTS.some(font => font.key === englishFont)) {
    throw new Error('字帖设置有误，请重新选择。')
  }

  let practiceRows
  if (mode === 'strokes') {
    practiceRows = strokeRows(selected, examples)
  } else {
    let tokens
    if (mode === 'number') tokens = numberRows(text)
    else if (mode === 'letters' || mode === 'words') tokens = englishRows(text, mode, letterCase)
    else tokens = textRows(text, mode)
    practiceRows = tokens.map(token => ({ text: token, strokeId: '', blank: false }))
  }
  const cellSize = cellMm * POINTS_PER_MM
  const gap = gapMm * POINTS_PER_MM
  const contentWidth = WRITING_PAGE.width - 2 * WRITING_PAGE.margin
  const ruled = mode === 'pinyin' || mode === 'letters' || mode === 'words'
  let cellWidth = ruled ? cellSize * 2 : cellSize
  if (mode === 'words') {
    const longest = Math.max(...practiceRows.map(row => row.text.length))
    cellWidth = Math.min(contentWidth / 3, cellSize * Math.max(2.35, longest * 0.39))
  }
  const columns = Math.floor(contentWidth / cellWidth)
  const usedExamples = Object.fromEntries(practiceRows.filter(row => row.strokeId && row.text)
    .map(row => [row.strokeId, row.text]))
  const reservedColumns = Object.keys(usedExamples).length ? 3 : 2
  const options = {
    mode, text: mode === 'hanzi' ? practiceRows.map(row => row.text).join('') : '',
    strokeIds: mode === 'strokes' ? practiceRows.map(row => row.strokeId) : [],
    examples: usedExamples,
    grid: ruled ? 'pinyin' : mode === 'number' || grid === 'pinyin' ? 'square' : grid,
    cellMm, gapMm, traceCount: Math.min(traceCount, columns - reservedColumns), highlight, blankRow, englishFont, includeHeading,
  }
  const pages = paginate(practiceRows, cellSize, gap, blankRow, includeHeading)
  return { options, columns, cellSize, cellWidth, gap, pages }
}

module.exports = { STROKES, WRITING_PAGE, WRITING_MODES, WRITING_INPUT_LIMIT, inspectHanzi, makeWritingWorksheet }
