const { request } = require('./api')
const { canUseTools } = require('./navigation')
const { shouldPlayToolAd, startToolAd } = require('./tool-rewarded-ad')

function currentPage() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  return pages[pages.length - 1]
}

async function runToolActionWithAd(component, { toolKey, run, onConfigError, isActionCurrent = () => true }) {
  const { categoryId } = component.data
  const app = getApp()
  const session = app.globalData.session
  if (!categoryId || !toolKey || !canUseTools(session)) {
    onConfigError('这个工具当前不可用。')
    return
  }

  const scope = app.getRequestScope()
  const page = currentPage()
  const visibility = component._visibilityVersion
  const isCurrent = () => {
    const latest = app.globalData.session
    const activeScope = app.getRequestScope()
    return component._active && currentPage() === page && component.data.categoryId === categoryId
      && canUseTools(latest) && latest.role === session.role && activeScope.id === scope.id
      && activeScope.revision === scope.revision && isActionCurrent()
  }
  const canStart = () => isCurrent() && component._visibilityVersion === visibility
  let adShown = false
  try {
    const { enabled, categories } = await request('listTools')
    if (!canStart()) return
    if (enabled === true && (!Array.isArray(categories) || categories.some(item => !Array.isArray(item?.tools)))) {
      throw new Error('Invalid tools response')
    }
    const tool = enabled === true && categories.find(item => item.id === categoryId)
      ?.tools.find(item => item.key === toolKey)
    if (!tool) {
      onConfigError('这个工具当前不可用。')
      return
    }
    if (typeof wx.createRewardedVideoAd === 'function' && shouldPlayToolAd(tool, session.role)) {
      const ad = startToolAd(canStart)
      component._cancelActionAd = ad.cancel
      adShown = await ad.done
    }
  } catch {
    if (isCurrent()) onConfigError('暂时无法读取工具配置，请重试。')
    return
  } finally {
    component._cancelActionAd = null
  }

  // A native ad may hide the page. Resume only on the same page and organization.
  const canProceed = () => canStart() || (adShown && isCurrent())
  if (canProceed()) await run(canProceed)
}

module.exports = { runToolActionWithAd }
