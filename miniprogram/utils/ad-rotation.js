function createAdRotation(adUnits, storageKey) {
  let last

  function choose() {
    if (last === undefined) {
      last = ''
      try { last = wx.getStorageSync(storageKey) || '' } catch {}
    }
    const candidates = adUnits.filter(id => id !== last)
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  function remember(id) {
    if (last === id) return
    last = id
    try { wx.setStorageSync(storageKey, id) } catch {}
  }

  return { choose, remember }
}

module.exports = { createAdRotation }
