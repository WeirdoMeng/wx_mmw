async function openWorkbook(transport, path, name, { method = 'GET', data, isCurrent = () => true } = {}) {
  const workbook = await transport('request', path, { method, data, responseType: 'arraybuffer', timeout: 60_000 })
  if (!isCurrent()) return
  const signature = workbook instanceof ArrayBuffer ? new Uint8Array(workbook, 0, Math.min(workbook.byteLength, 4)) : []
  if (signature.join(',') !== '80,75,3,4') throw new Error('未获取到有效的 Excel 文件。')
  const filePath = wx.env.USER_DATA_PATH + '/' + name + '.xlsx'
  try {
    await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
      filePath, data: workbook, success: resolve, fail: reject,
    }))
    if (!isCurrent()) return
    await new Promise((resolve, reject) => wx.openDocument({
      filePath, fileType: 'xlsx', showMenu: true, success: resolve, fail: reject,
    }))
  } catch {
    throw new Error('无法打开 Excel 文件，请重新导出。')
  }
}

module.exports = { openWorkbook }
