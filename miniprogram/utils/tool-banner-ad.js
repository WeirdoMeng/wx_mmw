const { createAdRotation } = require('./ad-rotation')

const BANNER_UNITS = [
  'adunit-e5c929f73e56645f',
  'adunit-26a8f15f38fe4cd4',
  'adunit-3afb85724190de86',
  'adunit-7644b10bf61b398c',
  'adunit-3f12d145608d4389',
  'adunit-356670c7b0c5208a',
]
const bannerRotation = createAdRotation(BANNER_UNITS, 'mmw.tools.lastBannerAd')

// Returning from a detail page or a native overlay keeps the current tab visit.
const visits = new Map()
function enterBannerTab(placement) { visits.set(placement, currentBannerVisit(placement) + 1) }
function currentBannerVisit(placement) { return visits.get(placement) || 0 }

module.exports = { bannerRotation, enterBannerTab, currentBannerVisit }
