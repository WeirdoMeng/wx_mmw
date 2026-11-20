function canUseTools(session) {
  return Boolean(session?.organization?.id && ['parent', 'teacher'].includes(session.role) && session.toolsEnabled === true)
}

function syncTab(page, selected, role = 'guest', hidden = false) {
  if (typeof page.getTabBar !== 'function') return
  const apply = () => {
    const bar = page.getTabBar()
    if (!bar) return false
    const toolsEnabled = canUseTools(getApp().globalData.session)
    if (bar.data.selected !== selected || bar.data.role !== role || bar.data.hidden !== hidden || bar.data.toolsEnabled !== toolsEnabled) {
      bar.setData({ selected, role, hidden, toolsEnabled })
    }
    return true
  }
  if (!apply() && wx.nextTick) wx.nextTick(apply)
}

function getNavigationInsets() {
  const window = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  const topInset = window.statusBarHeight || 20
  const menu = typeof wx.getMenuButtonBoundingClientRect === 'function'
    ? wx.getMenuButtonBoundingClientRect()
    : null
  const safeMenu = menu && menu.width > 0 && menu.top >= topInset
  const navHeight = safeMenu ? menu.height + (menu.top - topInset) * 2 : 44
  const menuWidth = safeMenu ? (window.windowWidth - menu.left + 4) : 96
  return { topInset, navHeight, menuWidth }
}

function goHome() {
  wx.switchTab({ url: '/pages/home/index' })
}

function resetHome() {
  wx.reLaunch({ url: '/pages/home/index' })
}

module.exports = { canUseTools, syncTab, getNavigationInsets, goHome, resetHome }
