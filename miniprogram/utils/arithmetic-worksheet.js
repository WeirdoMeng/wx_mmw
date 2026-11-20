const OPERATIONS = {
  add: { symbol: '+', calculate: (a, b) => a + b },
  sub: { symbol: '−', calculate: (a, b) => a - b },
  mul: { symbol: '×', calculate: (a, b) => a * b },
  div: { symbol: '÷', calculate: (a, b) => Math.floor(a / b) },
}

function normalizeOptions(options) {
  const {
    operations = ['add', 'sub'], limit = 20, count = 30, format = 'horizontal',
    regroup = 'any', division = 'exact', unique = true, includeKey = true,
  } = options
  if (!Array.isArray(operations) || !operations.length ||
      operations.some(operation => !Object.keys(OPERATIONS).includes(operation))) {
    throw new Error('请至少选择一种运算。')
  }
  if (!Number.isInteger(limit) || limit < 5 || limit > 1000) {
    throw new Error('数值范围须在 5 到 1000 之间。')
  }
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error('题数须在 1 到 100 之间。')
  }
  if (!['horizontal', 'blank', 'vertical'].includes(format) ||
      !['any', 'required', 'never'].includes(regroup) ||
      !['exact', 'remainder'].includes(division) ||
      typeof unique !== 'boolean' || typeof includeKey !== 'boolean') {
    throw new Error('出题选项无效，请重新选择。')
  }
  return { operations: [...new Set(operations)], limit, count, format, regroup, division, unique, includeKey }
}

function randomIndex(size, random) {
  return Math.floor(random() * size)
}

function candidateRows(operation, limit, division) {
  const rows = []
  let size = 0

  function addRow(first, length) {
    rows.push({ first, start: size })
    size += length
  }

  switch (operation) {
    case 'add':
      // Start with a <= b so a sum and its reversed form share one candidate.
      for (let a = 0; a * 2 <= limit; a++) addRow(a, limit - 2 * a + 1)
      break
    case 'sub':
      for (let a = 0; a <= limit; a++) addRow(a, a + 1)
      break
    case 'mul':
      for (let a = 1; a * a <= limit; a++) addRow(a, Math.floor(limit / a) - a + 1)
      break
    case 'div':
      if (division === 'exact') {
        for (let b = 1; b <= limit; b++) addRow(b, Math.floor(limit / b))
      } else {
        for (let b = 2; b < limit; b++) addRow(b, limit - b - Math.floor(limit / b) + 1)
      }
      break
  }

  function at(index) {
    let low = 0
    let high = rows.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (rows[mid].start <= index) low = mid
      else high = mid - 1
    }
    const { first, start } = rows[low]
    const offset = index - start
    if (operation === 'sub') return [first, offset]
    if (operation !== 'div') return [first, first + offset]
    if (division === 'exact') return [first * (offset + 1), first]
    const quotient = Math.floor(offset / (first - 1)) + 1
    const remainder = offset % (first - 1) + 1
    return [first * quotient + remainder, first]
  }

  return { size, at }
}

function needsRegrouping(a, b, operation) {
  while (a || b) {
    const left = a % 10
    const right = b % 10
    if (operation === 'add' ? left + right >= 10 : left < right) return true
    a = Math.floor(a / 10)
    b = Math.floor(b / 10)
  }
  return false
}

function exercisePool(operation, options, random) {
  const { size, at } = candidateRows(operation, options.limit, options.division)
  const checkRegrouping = options.regroup !== 'any' && (operation === 'add' || operation === 'sub')
  const allowed = ([a, b]) => !checkRegrouping ||
    needsRegrouping(a, b, operation) === (options.regroup === 'required')
  let remaining = size
  let fallback
  const moved = new Map()

  function takeUnique() {
    // Sample the candidate indexes without allocating a table of all operand pairs.
    while (remaining > 0) {
      const position = randomIndex(remaining, random)
      const index = moved.get(position) ?? position
      remaining -= 1
      if (position !== remaining) moved.set(position, moved.get(remaining) ?? remaining)
      moved.delete(remaining)
      const pair = at(index)
      if (allowed(pair)) return pair
    }
    return null
  }

  function takeRepeatable() {
    for (let attempt = 0; attempt < 16; attempt++) {
      const pair = at(randomIndex(size, random))
      if (allowed(pair)) return pair
    }
    if (!fallback) {
      for (let index = 0; index < size; index++) {
        const pair = at(index)
        if (allowed(pair)) {
          fallback = pair
          break
        }
      }
    }
    return fallback || null
  }

  return { operation, take: options.unique ? takeUnique : takeRepeatable }
}

function questionFor(id, operation, pair, format, random) {
  let [a, b] = pair
  if ((operation === 'add' || operation === 'mul') && random() < 0.5) [a, b] = [b, a]
  const { symbol, calculate } = OPERATIONS[operation]
  const result = calculate(a, b)
  const remainder = operation === 'div' ? a % b : 0
  const blank = format === 'blank' && !remainder ? (random() < 0.5 ? 'a' : 'b') : 'result'
  const visible = (field, value) => blank === field ? '____' : value
  const prompt = `${visible('a', a)} ${symbol} ${visible('b', b)} = ${visible('result', result)}${remainder ? ' 余 ____' : ''}`
  const answer = remainder ? `${result} 余 ${remainder}` : String({ a, b, result }[blank])
  const equation = `${a} ${symbol} ${b} = ${result}${remainder ? ' 余 ' + remainder : ''}`
  return { id, a, b, operation, symbol, result, remainder, blank, prompt, answer, equation }
}

function generateWorksheet(options = {}, random = Math.random) {
  const normalized = normalizeOptions(options)
  const pools = normalized.operations.map(operation => exercisePool(operation, normalized, random))
  const questions = []
  while (pools.length && questions.length < normalized.count) {
    const round = [...pools]
    while (round.length && questions.length < normalized.count) {
      const [pool] = round.splice(randomIndex(round.length, random), 1)
      const pair = pool.take()
      if (!pair) {
        pools.splice(pools.indexOf(pool), 1)
        continue
      }
      questions.push(questionFor(questions.length + 1, pool.operation, pair, normalized.format, random))
    }
  }
  return {
    options: normalized,
    questions,
    requestedCount: normalized.count,
    actualCount: questions.length,
    shortfall: normalized.count - questions.length,
  }
}

module.exports = { generateWorksheet }
