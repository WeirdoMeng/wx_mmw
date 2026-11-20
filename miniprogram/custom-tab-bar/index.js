const { canUseTools } = require('../utils/navigation')
const { enterBannerTab } = require('../utils/tool-banner-ad')

// IDs stay stable when the optional tools tab appears between the feed and profile.
const tabs = [
  { id: 0, path: '/pages/home/index', label: '我的孩子', icon: 'child' },
  { id: 1, path: '/pages/dynamics/index', label: '托管动态', icon: 'feed' },
  { id: 3, path: '/pages/tools/index', label: '实用工具', icon: 'toolbox', requiresTools: true, bannerPlacement: 'tools' },
  { id: 2, path: '/pages/profile/index', label: '我的', icon: 'profile', bannerPlacement: 'profile' },
]
let switching = false

Component({
  data: {
    tabs,
    selected: 0,
    role: 'guest',
    hidden: false,
    toolsEnabled: false,
  },

  methods: {
    select(event) {
      const id = Number(event.currentTarget.dataset.id)
      const tab = tabs.find(item => item.id === id)
      if (switching || id === this.data.selected || !tab) return
      if (tab.requiresTools && (!this.data.toolsEnabled || !canUseTools(getApp().globalData.session))) return
      if (tab.bannerPlacement) enterBannerTab(tab.bannerPlacement)
      switching = true
      wx.switchTab({
        url: tab.path,
        complete: () => { switching = false },
      })
    },
  },
})
