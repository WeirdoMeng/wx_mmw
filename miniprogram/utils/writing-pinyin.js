// pinyin-pro 3.29.5 and @pinyin-pro/data 1.3.1 traditional mapping.
// The upstream CommonJS builds and their licenses are in vendor/writing-pinyin.
let convert

function getConverter() {
  if (!convert) {
    const { pinyin, addDict, addTraditionalDict } = require('./vendor/writing-pinyin/pinyin-pro')
    addTraditionalDict(require('./vendor/writing-pinyin/traditional'))
    // These traditional phrases need their own readings since the same
    // character has a different reading in words such as 乾坤 and 瞭望.
    addDict({ 乾燥: 'gān zào', 乾杯: 'gān bēi', 瞭解: 'liǎo jiě' })
    convert = pinyin
  }
  return convert
}

function toPinyin(text) {
  if (!text) return []
  // Non-Hanzi remain in the result as placeholders to preserve alignment
  // with the input code points and keep punctuation as a word boundary.
  return getConverter()(text, {
    type: 'all',
    nonZh: 'spaced',
    toneType: 'symbol',
    toneSandhi: false,
    traditional: true,
  }).map(entry => entry.isZh ? entry.pinyin : '')
}

module.exports = { toPinyin }
