const { request } = require('../../utils/api')
const { canUseTools, getNavigationInsets, goHome, syncTab } = require('../../utils/navigation')
const { isToolKey, toolPresentation } = require('../../utils/tool-registry')
const { shouldPlayToolAd, startToolAd } = require('../../utils/tool-rewarded-ad')

const TOOLS_TAB_ID = 3

function catalogView(categories) {
  return categories.map(category => ({
    id: category.id,
    name: category.name,
    tools: category.tools.filter(tool => isToolKey(tool?.key)).map(toolPresentation).filter(tool => tool.name),
  })).filter(category => category.tools.length)
}

Page({
  data: {
    topInset: 20,
    menuHeight: 44,
    menuWidth: 96,
    organizationId: '',
    organizationName: '',
    role: 'guest',
    categories: [],
    loading: true,
    error: '',
  },

  onLoad() {
    const { topInset, navHeight, menuWidth } = getNavigationInsets()
    this.setData({ topInset, menuHeight: navHeight, menuWidth })
  },

  onShow() {
    this._hidden = false
    return this.loadCatalog()
  },

  onHide() {
    this._hidden = true
    this._visibilityVersion = (this._visibilityVersion || 0) + 1
    this._loadId = 0
    if (!this._cancelToolAd) this._openingTool = null
  },

  onUnload() {
    this.onHide()
    this._openingTool = null
    this._cancelToolAd?.()
  },

  async onPullDownRefresh() {
    try {
      await this.loadCatalog()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadCatalog() {
    const app = getApp()
    const current = app.globalData.session
    const loadId = {}
    this._loadId = loadId
    const keep = canUseTools(current) && current.organization.id === this.data.organizationId
      && current.role === this.data.role
    syncTab(this, TOOLS_TAB_ID, current?.organization ? current.role : 'guest')
    this.setData({
      error: '',
      ...(keep ? {} : { loading: true, organizationId: '', organizationName: '', role: 'guest', categories: [] }),
    })

    try {
      const session = await app.ensureSession({ refresh: true })
      if (this._loadId !== loadId) return
      if (!canUseTools(session)) {
        this.leaveCatalog(session)
        return
      }

      const { id: organizationId, name: organizationName } = session.organization
      const { role } = session
      const scope = app.getRequestScope()
      const changed = organizationId !== this.data.organizationId || role !== this.data.role
      this.setData({
        organizationId,
        organizationName,
        role,
        ...(changed ? { categories: [], loading: true } : {}),
      })
      syncTab(this, TOOLS_TAB_ID, role)

      const { enabled, categories } = await request('listTools', {}, { toolIconPreviews: {} })
      if (this._loadId !== loadId) return
      const latest = app.globalData.session
      const nextScope = app.getRequestScope()
      if (organizationId !== nextScope.id || scope.revision !== nextScope.revision || role !== latest?.role) {
        this.leaveCatalog(latest)
        return
      }
      if (enabled !== true || !canUseTools(latest)) {
        const disabled = enabled === true ? latest : app.setSession({ ...latest, toolsEnabled: false })
        this.leaveCatalog(disabled)
        return
      }
      if (!Array.isArray(categories) || categories.some(category => !Array.isArray(category?.tools))) {
        throw new Error('工具目录暂时无法读取，请重试。')
      }
      this.setData({ categories: catalogView(categories), loading: false })
    } catch (error) {
      if (this._loadId !== loadId) return
      if (['NOT_BOUND', 'FORBIDDEN', 'ORG_CHANGED'].includes(error.code)) {
        this.leaveCatalog(app.globalData.session)
        return
      }
      this.setData({ loading: false, error: error.message || '暂时无法加载实用工具。' })
    }
  },

  leaveCatalog(session) {
    this._loadId = 0
    this.setData({ categories: [], organizationId: '', organizationName: '', role: 'guest', loading: true, error: '' })
    syncTab(this, TOOLS_TAB_ID, session?.organization ? session.role : 'guest', true)
    if (session?.organization && ['parent', 'teacher'].includes(session.role)) goHome()
    else wx.reLaunch({ url: '/pages/index/index' })
  },

  onIconError(event) {
    const { categoryIndex, toolIndex, iconUrl } = event.currentTarget.dataset
    if (iconUrl && this.data.categories[categoryIndex]?.tools[toolIndex]?.iconUrl === iconUrl) {
      this.setData({ [`categories[${categoryIndex}].tools[${toolIndex}].iconUrl`]: '' })
    }
  },

  async onOpenTool(event) {
    const { key, categoryId } = event.currentTarget.dataset
    const app = getApp()
    const session = app.globalData.session
    if (this._openingTool || !canUseTools(session) || session.organization.id !== this.data.organizationId
      || session.role !== this.data.role
      || !this.data.categories.some(category => category.id === categoryId && category.tools.some(tool => tool.key === key))) return

    const tap = {}
    this._openingTool = tap
    const scope = app.getRequestScope()
    const visibility = this._visibilityVersion
    const sameScope = () => {
      const latest = app.globalData.session
      const nextScope = app.getRequestScope()
      return this._openingTool === tap && canUseTools(latest) && latest.role === session.role
        && scope.id === nextScope.id && scope.revision === nextScope.revision
    }
    const canStart = () => !this._hidden && visibility === this._visibilityVersion && sameScope()

    try {
      const { enabled, categories } = await request('listTools')
      if (!canStart()) return
      if (enabled !== true) {
        this.leaveCatalog(app.setSession({ ...app.globalData.session, toolsEnabled: false }))
        return
      }
      if (!Array.isArray(categories) || categories.some(category => !Array.isArray(category?.tools))) {
        throw new Error('工具目录暂时无法读取，请重试。')
      }
      const tool = categories.find(category => category.id === categoryId)?.tools.find(item => item.key === key)
      if (!tool) {
        this.setData({ categories: catalogView(categories) })
        wx.showToast({ title: '这个工具当前不可用', icon: 'none' })
        return
      }

      let adShown = false
      if (typeof wx.createRewardedVideoAd === 'function' && shouldPlayToolAd(tool, session.role)) {
        const ad = startToolAd(canStart)
        this._cancelToolAd = ad.cancel
        adShown = await ad.done
      }
      // 微信原生广告覆盖时可能触发页面隐藏。关闭后只继续当前页面的操作。
      const pages = adShown && typeof getCurrentPages === 'function' ? getCurrentPages() : []
      if (!(canStart() || (sameScope() && pages[pages.length - 1] === this))) return

      const url = '/pages/tool/index?key=' + encodeURIComponent(key) + '&org=' + encodeURIComponent(scope.id)
        + '&categoryId=' + encodeURIComponent(categoryId)
      await new Promise(complete => wx.navigateTo({ url, complete }))
    } catch (error) {
      if (!canStart()) return
      if (['NOT_BOUND', 'FORBIDDEN', 'ORG_CHANGED'].includes(error.code)) {
        this.leaveCatalog(app.globalData.session)
        return
      }
      wx.showToast({ title: error.message || '暂时无法打开工具', icon: 'none' })
    } finally {
      if (this._openingTool === tap) {
        this._openingTool = null
        this._cancelToolAd = null
      }
    }
  },
})
