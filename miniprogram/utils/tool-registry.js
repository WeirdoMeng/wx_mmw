const { WRITING_MODES } = require('./writing-tools')

const BUILTIN_TOOLS = new Map([
  ['focus-timer', { name: '专注计时', icon: 'timer', tint: 'mint' }],
  ['unit-converter', { name: '单位换算', icon: 'ruler', tint: 'sand' }],
  ['date-calculator', { name: '日期计算', icon: 'calendar', tint: 'lime' }],
  ['image-compressor', { name: '图片压缩', icon: 'gallery', tint: 'blue' }],
  ['sst-make', { name: '算术题生成', icon: 'homework', tint: 'lime' }],
  ...WRITING_MODES.map(({ key, name }) => ['zitie-' + key, {
    name, writingMode: key, icon: 'edit', localIcon: '/images/writing-tools/' + key + '.png', tint: 'sand',
  }]),
])
const TOOL_ICONS = new Set([
  'toolbox', 'timer', 'ruler', 'calendar', 'gallery', 'school',
  'homework', 'document', 'qr', 'meal', 'message', 'search',
])

function isToolKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(key)
}

function toolPresentation({ key, name, icon, iconUrl }) {
  const builtin = BUILTIN_TOOLS.get(key)
  const label = typeof name === 'string' ? name.trim() : ''
  return {
    key,
    name: label || builtin?.name || '',
    icon: TOOL_ICONS.has(icon) ? icon : (builtin?.icon || 'toolbox'),
    ...(typeof iconUrl === 'string' && iconUrl ? { iconUrl } : {}),
    ...(builtin?.writingMode ? { writingMode: builtin.writingMode, localIcon: builtin.localIcon } : {}),
    tint: builtin?.tint || 'mint',
    connected: Boolean(builtin),
  }
}

module.exports = { isToolKey, toolPresentation }
