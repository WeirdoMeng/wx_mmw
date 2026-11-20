const DEFAULT_IMAGE = '/images/brand/after-school.png'

function shareText(value, limit) {
  const characters = Array.from(String(value || '').trim().replace(/\s+/g, ' '))
  return characters.length <= limit ? characters.join('') : characters.slice(0, limit - 1).join('') + '…'
}

function sharePhotoSource(photo) {
  if (typeof photo === 'string') return photo
  return [photo?.localPath, photo?.path, photo?.url].find((path) => typeof path === 'string' && path) || ''
}

function isLocalSharePath(path) {
  return typeof path === 'string' && /^(?:wxfile:\/\/|http:\/\/(?:tmp|usr)\/|\/(?!\/))/i.test(path)
}

function shareCardFields(record, cover, downloadedPhoto) {
  const title = shareText(record.title, 60)
  if (cover) return { title, imageUrl: cover }

  const summary = shareText(record.summary, 40)
  const photo = (record.images || []).map(sharePhotoSource).find(isLocalSharePath)
  const fallbackTitle = summary ? shareText(title + ' · ' + summary, 90) : title
  return { title: fallbackTitle, imageUrl: downloadedPhoto || photo || DEFAULT_IMAGE }
}

module.exports = { shareCardFields, sharePhotoSource, isLocalSharePath, shareText }
