const englishOutlines = require('./vendor/writing-fonts/outlines')

const DEFAULT_ENGLISH_FONT = 'print'
const ENGLISH_FONTS = [
  { key: DEFAULT_ENGLISH_FONT, name: '手写印刷体', sample: 'Lily' },
  { key: 'italic', name: '意大利斜体', sample: 'Lily' },
  { key: 'serif', name: '衬线体', sample: 'Lily' },
  { key: 'exam', name: '衡水风手写体', sample: 'Lily' },
  { key: 'school', name: '儿童书写体', sample: 'Lily' },
  { key: 'comic', name: '漫画手写体', sample: 'Lily' },
]

// Centerlines for the existing single-storey teaching alphabet, measured above the baseline.
const printStrokes = {
  A: '0.06 0 m 0.29 0.77 l 0.53 0 l 0.15 0.28 m 0.44 0.28 l',
  B: '0.11 0.77 m 0.11 0 l 0.29 0 l 0.58 0 0.58 0.41 0.29 0.41 c 0.11 0.41 l 0.29 0.41 m 0.53 0.41 0.53 0.77 0.29 0.77 c 0.11 0.77 l',
  C: '0.50 0.66 m 0.33 0.90 0.07 0.75 0.07 0.38 c 0.07 0.02 0.33 -0.12 0.50 0.10 c',
  D: '0.11 0.77 m 0.11 0 l 0.24 0 l 0.63 0 0.63 0.77 0.24 0.77 c 0.11 0.77 l',
  E: '0.50 0.77 m 0.10 0.77 l 0.10 0 l 0.50 0 l 0.10 0.40 m 0.43 0.40 l',
  F: '0.50 0.77 m 0.10 0.77 l 0.10 0 l 0.10 0.40 m 0.43 0.40 l',
  G: '0.50 0.66 m 0.33 0.90 0.07 0.75 0.07 0.38 c 0.07 0.06 0.29 -0.11 0.50 0.10 c 0.50 0.35 l 0.30 0.35 l',
  H: '0.10 0.77 m 0.10 0 l 0.49 0.77 m 0.49 0 l 0.10 0.40 m 0.49 0.40 l',
  I: '0.13 0.77 m 0.46 0.77 l 0.29 0.77 m 0.29 0 l 0.13 0 m 0.46 0 l',
  J: '0.13 0.77 m 0.47 0.77 l 0.47 0.23 l 0.47 -0.04 0.18 -0.11 0.09 0.13 c',
  K: '0.10 0.77 m 0.10 0 l 0.50 0.77 m 0.10 0.28 l 0.24 0.46 m 0.52 0 l',
  L: '0.11 0.77 m 0.11 0 l 0.50 0 l',
  M: '0.08 0 m 0.08 0.77 l 0.29 0.34 l 0.51 0.77 l 0.51 0 l',
  N: '0.10 0 m 0.10 0.77 l 0.49 0 l 0.49 0.77 l',
  O: '0.08 0.38 m 0.08 0.90 0.51 0.90 0.51 0.38 c 0.51 -0.13 0.08 -0.13 0.08 0.38 c h',
  P: '0.11 0 m 0.11 0.77 l 0.29 0.77 l 0.59 0.77 0.59 0.36 0.29 0.36 c 0.11 0.36 l',
  Q: '0.08 0.38 m 0.08 0.90 0.51 0.90 0.51 0.38 c 0.51 -0.13 0.08 -0.13 0.08 0.38 c h 0.33 0.21 m 0.53 -0.04 l',
  R: '0.11 0 m 0.11 0.77 l 0.29 0.77 l 0.59 0.77 0.59 0.39 0.29 0.39 c 0.11 0.39 l 0.27 0.39 m 0.52 0 l',
  S: '0.49 0.68 m 0.38 0.83 0.12 0.82 0.11 0.60 c 0.10 0.38 0.51 0.45 0.50 0.21 c 0.49 -0.04 0.23 -0.06 0.08 0.08 c',
  T: '0.06 0.77 m 0.53 0.77 l 0.29 0.77 m 0.29 0 l',
  U: '0.10 0.77 m 0.10 0.28 l 0.10 -0.11 0.49 -0.11 0.49 0.28 c 0.49 0.77 l',
  V: '0.06 0.77 m 0.29 0 l 0.53 0.77 l',
  W: '0.06 0.77 m 0.17 0 l 0.29 0.55 l 0.41 0 l 0.53 0.77 l',
  X: '0.09 0.77 m 0.50 0 l 0.50 0.77 m 0.09 0 l',
  Y: '0.06 0.77 m 0.29 0.39 l 0.53 0.77 l 0.29 0.39 m 0.29 0 l',
  Z: '0.09 0.77 m 0.50 0.77 l 0.09 0 l 0.50 0 l',
  a: '0.47 0.43 m 0.47 0 l 0.47 0.29 m 0.45 0.48 0.12 0.49 0.11 0.22 c 0.10 -0.04 0.40 -0.08 0.47 0.13 c',
  b: '0.12 0.71 m 0.12 0 l 0.12 0.29 m 0.15 0.48 0.48 0.49 0.49 0.22 c 0.50 -0.04 0.19 -0.08 0.12 0.13 c',
  c: '0.46 0.36 m 0.38 0.47 0.12 0.48 0.10 0.24 c 0.08 0.02 0.34 -0.06 0.47 0.07 c',
  d: '0.47 0.71 m 0.47 0 l 0.47 0.29 m 0.45 0.48 0.12 0.49 0.11 0.22 c 0.10 -0.04 0.40 -0.08 0.47 0.13 c',
  e: '0.13 0.24 m 0.48 0.24 l 0.46 0.51 0.13 0.50 0.10 0.24 c 0.08 0.02 0.33 -0.06 0.47 0.07 c',
  f: '0.23 0 m 0.23 0.51 l 0.23 0.69 0.36 0.75 0.46 0.69 c 0.10 0.43 m 0.43 0.43 l',
  g: '0.47 0.43 m 0.47 -0.04 l 0.47 -0.20 0.31 -0.27 0.15 -0.19 c 0.47 0.29 m 0.45 0.48 0.12 0.49 0.11 0.22 c 0.10 -0.04 0.40 -0.08 0.47 0.13 c',
  h: '0.12 0.71 m 0.12 0 l 0.12 0.29 m 0.18 0.47 0.46 0.50 0.46 0.25 c 0.46 0 l',
  i: '0.30 0 m 0.30 0.43 l',
  j: '0.35 0.43 m 0.35 -0.06 l 0.35 -0.18 0.27 -0.24 0.16 -0.20 c 0.35 0.58 m 0.35 0.581 l',
  k: '0.12 0.71 m 0.12 0 l 0.46 0.43 m 0.13 0.16 l 0.27 0.27 m 0.49 0 l',
  l: '0.29 0.71 m 0.29 0 l',
  m: '0.08 0.43 m 0.08 0 l 0.08 0.29 m 0.13 0.47 0.30 0.47 0.30 0.24 c 0.30 0 l 0.30 0.29 m 0.35 0.47 0.52 0.47 0.52 0.24 c 0.52 0 l',
  n: '0.12 0.43 m 0.12 0 l 0.12 0.29 m 0.18 0.47 0.46 0.50 0.46 0.25 c 0.46 0 l',
  o: '0.10 0.22 m 0.10 0.51 0.48 0.51 0.49 0.22 c 0.49 -0.07 0.10 -0.07 0.10 0.22 c h',
  p: '0.12 0.43 m 0.12 -0.22 l 0.12 0.29 m 0.15 0.48 0.48 0.49 0.49 0.22 c 0.50 -0.04 0.19 -0.08 0.12 0.13 c',
  q: '0.47 0.43 m 0.47 -0.22 l 0.47 0.29 m 0.45 0.48 0.12 0.49 0.11 0.22 c 0.10 -0.04 0.40 -0.08 0.47 0.13 c',
  r: '0.15 0.43 m 0.15 0 l 0.15 0.28 m 0.20 0.40 0.35 0.47 0.46 0.41 c',
  s: '0.45 0.37 m 0.34 0.46 0.14 0.47 0.13 0.32 c 0.12 0.20 0.47 0.25 0.46 0.11 c 0.45 -0.05 0.22 -0.04 0.11 0.05 c',
  t: '0.23 0.60 m 0.23 0.15 l 0.23 0.04 0.31 -0.01 0.43 0.03 c 0.10 0.43 m 0.44 0.43 l',
  u: '0.12 0.43 m 0.12 0.18 l 0.12 -0.05 0.39 -0.05 0.46 0.14 c 0.46 0.43 m 0.46 0 l',
  v: '0.10 0.43 m 0.29 0 l 0.48 0.43 l',
  w: '0.06 0.43 m 0.17 0 l 0.29 0.36 l 0.41 0 l 0.53 0.43 l',
  x: '0.11 0.43 m 0.48 0 l 0.47 0.43 m 0.10 0 l',
  y: '0.10 0.43 m 0.28 0.03 l 0.48 0.43 m 0.28 0.03 l 0.20 -0.15 0.14 -0.22 0.08 -0.20 c',
  z: '0.11 0.43 m 0.48 0.43 l 0.10 0 l 0.49 0 l',
  "'": '0.31 0.72 m 0.32 0.67 0.30 0.62 0.27 0.59 c',
  '-': '0.14 0.24 m 0.45 0.24 l',
}

const toneStrokes = {
  '\u0300': '0.20 0.09 m 0.40 0 l', // Grave tone
  '\u0301': '0.20 0 m 0.40 0.09 l', // Acute tone
  '\u0302': '0.19 0 m 0.30 0.10 l 0.41 0 l', // Circumflex on ê
  '\u0304': '0.18 0.05 m 0.42 0.05 l', // Level tone
  '\u030c': '0.19 0.10 m 0.30 0 l 0.41 0.10 l', // Falling-rising tone
  '\u0308': '0.21 0.035 m 0.21 0.036 l 0.39 0.035 m 0.39 0.036 l', // Umlaut on ü
}
const iDot = '0.30 0.58 m 0.30 0.581 l'

// Upright writing forms with a centered baseline in each number square.
const digitStrokes = {
  0: '0.09 0.38 m 0.09 0.90 0.51 0.90 0.51 0.38 c 0.51 -0.13 0.09 -0.13 0.09 0.38 c h',
  1: '0.17 0.61 m 0.33 0.76 l 0.33 0 l 0.15 0 m 0.50 0 l',
  2: '0.10 0.62 m 0.18 0.85 0.49 0.84 0.50 0.63 c 0.52 0.48 0.41 0.36 0.30 0.24 c 0.10 0 l 0.52 0 l',
  3: '0.11 0.68 m 0.26 0.84 0.48 0.79 0.48 0.60 c 0.48 0.46 0.35 0.40 0.25 0.40 c 0.50 0.40 0.55 0.24 0.50 0.13 c 0.45 -0.01 0.24 -0.06 0.10 0.06 c',
  4: '0.43 0.77 m 0.10 0.27 l 0.53 0.27 l 0.43 0.77 m 0.43 0 l',
  5: '0.48 0.76 m 0.15 0.76 l 0.13 0.43 l 0.27 0.51 0.49 0.46 0.51 0.27 c 0.54 0.03 0.28 -0.07 0.10 0.07 c',
  6: '0.46 0.69 m 0.25 0.88 0.10 0.66 0.10 0.31 c 0.10 -0.10 0.51 -0.09 0.51 0.22 c 0.51 0.48 0.23 0.50 0.10 0.31 c',
  7: '0.10 0.76 m 0.52 0.76 l 0.20 0 l',
  8: '0.31 0.40 m 0.06 0.48 0.08 0.77 0.30 0.77 c 0.52 0.77 0.55 0.48 0.31 0.40 c 0.03 0.31 0.03 0 0.30 0 c 0.57 0 0.59 0.31 0.31 0.40 c h',
  9: '0.13 0.07 m 0.35 -0.10 0.51 0.13 0.51 0.46 c 0.51 0.87 0.10 0.85 0.10 0.55 c 0.10 0.29 0.37 0.28 0.51 0.46 c',
}

const commands = { m: 'M', l: 'L', c: 'C', h: 'Z' }
function decodeStrokes(source) {
  const result = []
  let points = []
  for (const token of source.split(' ')) {
    const command = commands[token]
    if (command) {
      result.push([command, ...points])
      points = []
    } else {
      points.push(Number(token))
    }
  }
  return result
}

function decodeGlyphs(strokes) {
  return Object.fromEntries(Object.entries(strokes).map(([key, value]) => [key, decodeStrokes(value)]))
}

const outlineAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const outlineCommands = [['M', 2], ['L', 2], ['C', 6], ['Z', 0]]

function decodeOutline(encoded) {
  const result = []
  const position = [0, 0]
  let cursor = 0

  // Each coordinate is a signed delta, stored in 5-bit chunks with a continuation bit.
  function nextDelta() {
    let value = 0
    let shift = 0
    let chunk
    do {
      chunk = outlineAlphabet.indexOf(encoded[cursor++])
      value |= (chunk & 31) << shift
      shift += 5
    } while (chunk & 32)
    return value & 1 ? -(value + 1) / 2 : value / 2
  }

  while (cursor < encoded.length) {
    const [verb, arity] = outlineCommands[outlineAlphabet.indexOf(encoded[cursor++])]
    const points = []
    for (let index = 0; index < arity; index += 1) {
      const axis = index % 2
      position[axis] += nextDelta()
      points.push(position[axis])
    }
    result.push([verb, ...points])
  }
  return result
}

const printedGlyphs = decodeGlyphs(printStrokes)
const digitGlyphs = decodeGlyphs(digitStrokes)
const accentGlyphs = decodeGlyphs(toneStrokes)
const iWithDot = [...printedGlyphs.i, ...decodeStrokes(iDot)]
const decodedOutlines = new WeakMap()

// Compact left-to-right spacing and a consistent slant for the exam practice style.
function examShape(shape) {
  return shape.map(([verb, ...points]) => [
    verb,
    ...points.map((coordinate, index) => index % 2 === 0
      ? coordinate * 0.81 + points[index + 1] * 0.22
      : coordinate),
  ])
}

const examGlyphs = Object.fromEntries(Object.entries({ ...printedGlyphs, i: iWithDot })
  .map(([letter, shape]) => [letter, examShape(shape)]))

// The Mini Program runtime can return the original string for NFD. Build the
// letter and its marks explicitly for both precomposed and decomposed input.
const pinyinAccents = {}
const toneMarks = ['\u0304', '\u0301', '\u030c', '\u0300']
const diaeresis = '\u0308'
const circumflex = '\u0302'
for (const [base, forms, extra] of [
  ['a', 'āáǎà'], ['e', 'ēéěè'], ['i', 'īíǐì'], ['o', 'ōóǒò'], ['u', 'ūúǔù'],
  ['u', 'ǖǘǚǜ', diaeresis],
]) {
  Array.from(forms).forEach((form, index) => {
    pinyinAccents[form] = [base, ...(extra ? [extra] : []), toneMarks[index]]
  })
}
Object.assign(pinyinAccents, {
  ü: ['u', diaeresis],
  ê: ['e', circumflex],
  ế: ['e', circumflex, '\u0301'],
  ề: ['e', circumflex, '\u0300'],
  ḿ: ['m', '\u0301'],
  ń: ['n', '\u0301'],
  ň: ['n', '\u030c'],
  ǹ: ['n', '\u0300'],
})

function splitPinyin(text) {
  const glyphs = []
  for (const char of text.toLowerCase()) {
    if (pinyinAccents[char]) {
      glyphs.push([...pinyinAccents[char]])
    } else if (accentGlyphs[char] && glyphs.length) {
      glyphs[glyphs.length - 1].push(char)
    } else if (/^[a-z]$/.test(char)) {
      glyphs.push([char])
    } else {
      throw new Error('无法绘制拼音字符：' + char)
    }
  }
  return glyphs
}

function placePath(commands, x, baseline, scale, strokeWidth = 0) {
  return {
    commands: commands.map(([command, ...coordinates]) => [
      command,
      ...coordinates.map((point, index) => index % 2 === 0 ? x + point * scale : baseline - point * scale),
    ]),
    fill: strokeWidth === 0,
    strokeWidth: strokeWidth * scale,
    source: { commands, x, baseline, scale, strokeWidth },
  }
}

function layoutCenterlines(text, width, height, variant) {
  const digits = variant === 'number'
  const exam = variant === 'exam'
  const glyphs = variant === 'pinyin' ? splitPinyin(text) : Array.from(text, char => [char])
  if (!glyphs.length) return []
  const advance = digits ? 0.6 : exam ? 0.46 : 0.58
  const runWidth = glyphs.length * advance + (exam ? 0.12 : 0)
  const size = Math.min(height * (digits ? 0.86 : 0.77), width * 0.9 / runWidth)
  const left = (width - runWidth * size) / 2
  const baseline = digits ? (height + size * 0.77) / 2 : height * 2 / 3
  const paths = []
  glyphs.forEach(([letter, ...marks], index) => {
    const x = left + index * advance * size
    let shape = printedGlyphs[letter]
    if (digits) shape = digitGlyphs[letter]
    else if (exam) shape = examGlyphs[letter]
    else if (letter === 'i' && !marks.length) shape = iWithDot
    if (!shape) throw new Error('无法绘制字符：' + letter)
    paths.push(placePath(shape, x, baseline, size, 0.055))

    const hasRootMark = marks.includes(diaeresis) || marks.includes(circumflex)
    for (const mark of marks) {
      const isRootMark = mark === diaeresis || mark === circumflex
      const lift = hasRootMark && !isRootMark ? 0.64 : 0.52
      paths.push(placePath(accentGlyphs[mark], x, baseline - size * lift, size, mark === diaeresis ? 0.065 : 0.048))
    }
  })
  return paths
}

function layoutOutlined(text, width, height, font) {
  let cursor = 0
  let left = 0
  let right = 0
  let low = 0
  let high = 0
  let previous = ''
  const glyphRuns = []
  for (const letter of text) {
    const glyph = font.glyphs[letter]
    if (!glyph) throw new Error('无法绘制英文字体字符：' + letter)
    const [advance, minX, minY, maxX, maxY, encoded] = glyph
    if (!decodedOutlines.has(glyph)) decodedOutlines.set(glyph, decodeOutline(encoded))
    cursor += font.kern[previous + letter] || 0
    glyphRuns.push({ offset: cursor, commands: decodedOutlines.get(glyph) })
    left = Math.min(left, cursor + minX)
    right = Math.max(right, cursor + maxX)
    low = Math.min(low, minY)
    high = Math.max(high, maxY)
    cursor += advance
    previous = letter
  }
  if (!glyphRuns.length) return []

  const baseline = height * 2 / 3
  const scale = Math.min(
    height * 0.31 / font.xHeight,
    baseline * 0.97 / Math.max(1, high),
    (height - baseline) * 0.92 / Math.max(1, -low),
    width * 0.9 / Math.max(1, right - left),
  )
  const center = (width - (right + left) * scale) / 2
  return glyphRuns.map(({ offset, commands }) => placePath(commands, center + offset * scale, baseline, scale))
}

function layoutLatin(text, { width, height, variant = DEFAULT_ENGLISH_FONT }) {
  const outline = englishOutlines[variant]
  const paths = outline ? layoutOutlined(text, width, height, outline) : layoutCenterlines(text, width, height, variant)
  return { paths }
}

module.exports = { ENGLISH_FONTS, DEFAULT_ENGLISH_FONT, layoutLatin }
