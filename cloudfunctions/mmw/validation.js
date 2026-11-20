'use strict';

class BusinessError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new BusinessError(code, message);
}

function text(value, field, maximum, required = false) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    fail('INVALID_INPUT', field + '格式不正确');
  }
  const result = (value || '').trim();
  if (required && !result) fail('INVALID_INPUT', '请填写' + field);
  if (result.length > maximum) fail('INVALID_INPUT', field + '内容过长');
  return result;
}

function phone(value, field, required) {
  const result = text(value, field, 32, required);
  if (result && (!/^[0-9+()\s-]+$/.test(result) || !/^\d{6,20}$/.test(result.replace(/\D/g, '')))) {
    fail('INVALID_INPUT', field + '格式不正确');
  }
  return result;
}

function studentFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_INPUT', '请填写孩子资料');
  }
  if ((typeof value.age !== 'number' && typeof value.age !== 'string') ||
      !/^\d{1,3}$/.test(String(value.age)) || Number(value.age) > 120) {
    fail('INVALID_INPUT', '请填写正确的年龄');
  }
  return {
    name: text(value.name, '孩子姓名', 30, true),
    age: Number(value.age),
    school: text(value.school, '学校', 60, true),
    grade: text(value.grade, '年级', 20, true),
    contact1: phone(value.contact1, '家长联系电话 1', true),
    contact2: phone(value.contact2, '家长联系电话 2', false),
    guardian: text(value.guardian, '家长称呼', 30),
  };
}

function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail('INVALID_DATE', '请选择有效日期');
  }
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    fail('INVALID_DATE', '请选择有效日期');
  }
  return value;
}

function documentId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) {
    fail('INVALID_INPUT', '记录标识不正确');
  }
  return value;
}

function assetIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 9) {
    fail('INVALID_INPUT', '每条记录最多添加 9 张照片');
  }
  const ids = value.map(documentId);
  if (new Set(ids).size !== ids.length) fail('INVALID_INPUT', '照片重复');
  return ids;
}

function requestId(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) {
    fail('INVALID_INPUT', '请求标识不正确');
  }
  return value;
}

function postType(value) {
  if (value !== 'meal' && value !== 'daily') fail('INVALID_INPUT', '请选择餐食或日常');
  return value;
}

function inviteType(value) {
  if (value !== 'teacher' && value !== 'parent') fail('INVALID_INPUT', '邀请类型不正确');
  return value;
}

function invalidInvite() {
  fail('INVITE_INVALID', '此二维码已失效，请联系邀请人重新发送');
}

function inviteToken(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{22}$/.test(value)) invalidInvite();
  return value;
}

module.exports = {
  BusinessError, fail, text, studentFields, day, documentId, assetIds, requestId,
  postType, inviteType, invalidInvite, inviteToken,
};
