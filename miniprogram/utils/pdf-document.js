const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89

function unicodeHex(text) {
  return text.split('').map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')
}

function latinHex(text) {
  return text.replace(/−/g, '-').split('').map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

function textAt(text, x, y, size, font, hex) {
  return `BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${hex(text)}> Tj ET\n`
}

function latinAt(text, x, y, size = 13) {
  return textAt(String(text), x, y, size, 'F1', latinHex)
}

function chineseAt(text, x, y, size) {
  return textAt(text, x, y, size, 'F2', unicodeHex)
}

function line(x1, y1, x2, y2, gray = 0.62, thickness = 0.6) {
  return `q ${gray} G ${thickness} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q\n`
}

function createA4Pdf(drawings, title, forms = []) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '', // Page tree, filled after the page objects are numbered.
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 /FontDescriptor 6 0 R >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>',
    `<< /Title <FEFF${unicodeHex(title)}> >>`,
  ]
  const formRefs = forms.map(({ name, bounds, drawing }) => {
    const id = objects.length + 1
    const box = bounds.join(' ')
    objects.push(`<< /Type /XObject /Subtype /Form /BBox [${box}] /Resources << >> /Length ${drawing.length} >>\nstream\n${drawing}endstream`)
    return `/${name} ${id} 0 R`
  })
  const formResources = formRefs.length ? ` /XObject << ${formRefs.join(' ')} >>` : ''
  const pageRefs = []
  for (const drawing of drawings) {
    const pageId = objects.length + 1
    pageRefs.push(`${pageId} 0 R`)
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${formResources} >> /Contents ${pageId + 1} 0 R >>`)
    objects.push(`<< /Length ${drawing.length} >>\nstream\n${drawing}endstream`)
  }
  objects[1] = `<< /Type /Pages /Count ${drawings.length} /Kids [${pageRefs.join(' ')}] >>`

  // Every content stream is ASCII because glyph codes are written as hex strings.
  let file = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((object, index) => {
    offsets.push(file.length)
    file += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = file.length
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  const bytes = new Uint8Array(file.length)
  for (let index = 0; index < file.length; index += 1) bytes[index] = file.charCodeAt(index)
  return bytes
}

module.exports = { A4_WIDTH, A4_HEIGHT, chineseAt, latinAt, line, createA4Pdf }
