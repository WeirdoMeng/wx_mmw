const documents = new Map()
let sequence = 0

function createPdfPreviewDocument(title, bytes, toolKey, categoryId) {
  const id = 'tool-pdf-' + Date.now() + '-' + ++sequence
  documents.set(id, { title, bytes, toolKey, categoryId })
  return id
}

function getPdfPreviewDocument(id) {
  return documents.get(id)
}

function releasePdfPreviewDocument(id) {
  documents.delete(id)
}

module.exports = { createPdfPreviewDocument, getPdfPreviewDocument, releasePdfPreviewDocument }
