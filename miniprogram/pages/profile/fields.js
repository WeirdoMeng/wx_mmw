const GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三']
const GRADE_NUMERALS = '一二三四五六七八九'
const PARENT_FIELDS = [
  { key: 'guardianName', label: '家长姓名', type: 'text', limit: 30, placeholder: '输入家长姓名' },
  { key: 'relationship', label: '与孩子关系', type: 'text', limit: 20, placeholder: '例如妈妈、爸爸、爷爷' },
  { key: 'contact1', label: '家长联系电话 1', type: 'number', limit: 24, placeholder: '输入 11 位手机号' },
  { key: 'contact2', label: '家长联系电话 2', type: 'number', limit: 24, placeholder: '输入备用手机号', optional: true }
]
const FIELDS = [
  { key: 'name', label: '孩子姓名', type: 'text', limit: 30, placeholder: '输入姓名' },
  { key: 'age', label: '年龄', type: 'number', limit: 3, placeholder: '输入年龄' },
  { key: 'school', label: '学校', type: 'text', limit: 60, placeholder: '输入学校' },
  { key: 'grade', label: '年级' },
  ...PARENT_FIELDS
]
const FIELD_KEYS = new Set(FIELDS.map((field) => field.key))
const CHILD_FIELDS = ['name', 'age', 'grade', 'school'].map(key => FIELDS.find(field => field.key === key))

function formatGrade(value) {
  const known = String(value ?? '').normalize('NFKC').trim()
  const number = known.match(/^([1-9一二三四五六七八九])(?:年级)?$/)
  const middle = /^(?:初中|初)([123一二三])(?:年级)?$/.exec(known)
  const position = number?.[1] || middle?.[1]
  if (!position) return known
  const digit = Number(position)
  const index = Number.isNaN(digit) ? GRADE_NUMERALS.indexOf(position) : digit - 1
  return GRADES[index + (middle ? 6 : 0)]
}

function toForm(student = {}) {
  const values = Object.fromEntries(FIELDS.map(({ key }) => [key, String(student[key] ?? '')]))
  values.grade = formatGrade(student.grade)
  return values
}

function validPhone(value) {
  return /^1[3-9]\d{9}$/.test(value)
}

function toStudent(form, { preserveGrade = false } = {}) {
  const values = Object.fromEntries(CHILD_FIELDS.map(({ key }) => [key, String(form[key] ?? '').trim()]))
  if (!values.name || !values.school) throw Error('请填写孩子姓名和学校')
  if (!preserveGrade && !GRADES.includes(values.grade)) throw Error('请选择孩子的年级')
  if (!/^\d{1,3}$/.test(values.age) || Number(values.age) > 120) throw Error('请输入 0 至 120 的整数年龄')
  return { ...values, age: Number(values.age) }
}

function toParent(form) {
  const parent = Object.fromEntries(PARENT_FIELDS.map(({ key }) => [key, String(form[key] ?? '').trim()]))
  if (!parent.guardianName) throw Error('请填写家长姓名')
  if (parent.guardianName.length > 30) throw Error('家长姓名最多 30 个字')
  if (!parent.relationship) throw Error('请填写与孩子关系')
  if (parent.relationship.length > 20) throw Error('与孩子关系最多 20 个字')
  if (!validPhone(parent.contact1)) throw Error('家长联系电话 1 请输入有效的 11 位手机号')
  if (parent.contact2 && !validPhone(parent.contact2)) throw Error('家长联系电话 2 请输入有效的 11 位手机号')
  return parent
}

function onFieldInput(event) {
  if (this.data.saving) return
  const { field } = event.currentTarget.dataset
  if (FIELD_KEYS.has(field)) {
    this.setData({ ['form.' + field]: event.detail.value })
  }
}

module.exports = { GRADES, FIELDS, CHILD_FIELDS, PARENT_FIELDS, formatGrade, toForm, toStudent, toParent, validPhone, onFieldInput }
