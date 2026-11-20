const { createAdRotation } = require('./ad-rotation')

const AD_UNITS = [
  'adunit-1cc44158d2d8e345',
  'adunit-3de020e4f0c3c6e3',
  'adunit-37e6bc57ba73f268',
  'adunit-647f8879fedd04a9',
  'adunit-b7be724ba1e9fe3e',
  'adunit-16590c6119fef076',
  'adunit-c6526f1668488767',
  'adunit-b6a25811a4142be3',
  'adunit-bbd009658582d988',
  'adunit-c84aabd32c4728e1',
  'adunit-b99bcc48ec5705d6',
]
const rotation = createAdRotation(AD_UNITS, 'mmw.tools.lastRewardedAd')
const OPEN_TIMEOUT = 8000

function shouldPlayToolAd({ adEnabled, adProbability, teacherAdExempt }, role) {
  return adEnabled === true && !(role === 'teacher' && teacherAdExempt === true)
    && Number.isInteger(adProbability) && adProbability > 0
    && adProbability <= 100 && (adProbability === 100 || Math.random() * 100 < adProbability)
}

function startToolAd(canStart) {
  const adUnitId = rotation.choose()
  let ad
  let timer
  let resolve
  let finished = false
  let opening = false
  let shown = false
  const done = new Promise(complete => { resolve = complete })

  function markShown() {
    if (shown) return
    shown = true
    rotation.remember(adUnitId)
  }

  function finish() {
    if (finished) return
    finished = true
    clearTimeout(timer)
    try {
      ad?.offClose?.(onClose)
      ad?.offError?.(finish)
      ad?.destroy?.()
    } catch {}
    resolve(shown)
  }

  function onClose() {
    if (finished || !opening) return
    markShown()
    finish()
  }

  async function show() {
    try {
      ad = wx.createRewardedVideoAd({ adUnitId, multiton: true })
      ad.onClose(onClose)
      ad.onError(finish)
      timer = setTimeout(finish, OPEN_TIMEOUT)
      await ad.load()
      if (finished || !canStart()) return finish()
      opening = true
      await ad.show()
      if (finished) return
      clearTimeout(timer)
      markShown()
    } catch {
      finish()
    }
  }

  show()
  return { done, cancel: finish }
}

module.exports = { shouldPlayToolAd, startToolAd }
