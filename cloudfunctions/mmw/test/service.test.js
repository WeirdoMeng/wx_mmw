'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBackend } = require('../service');
const { collections } = require('../database');

function meets(row, criterion) {
  if (criterion.$and) return criterion.$and.every((item) => meets(row, item));
  if (criterion.$or) return criterion.$or.some((item) => meets(row, item));
  return Object.entries(criterion).every(([key, value]) =>
    typeof value === 'object' && value !== null && '$lt' in value
      ? row[key] < value.$lt : row[key] === value);
}

function reader(tables) {
  return {
    collection(name) {
      const table = tables.get(name);
      assert.ok(table, 'missing collection ' + name);
      return {
        doc(id) {
          return {
            get: async () => ({ data: structuredClone(table.get(id) || null) }),
            set: async ({ data }) => { table.set(id, structuredClone({ ...data, _id: id })); },
            update: async ({ data }) => {
              assert.ok(table.has(id), 'cannot update missing document');
              table.set(id, structuredClone({ ...table.get(id), ...data, _id: id }));
            },
          };
        },
        where(criterion) {
          const sorting = [];
          let offset = 0;
          let maximum = Infinity;
          const query = {
            orderBy(field, direction) { sorting.push([field, direction]); return query; },
            skip(value) { offset = value; return query; },
            limit(value) { maximum = value; return query; },
            get: async () => {
              const rows = [...table.values()].filter((row) => meets(row, criterion));
              rows.sort((left, right) => {
                for (const [field, direction] of sorting) {
                  if (left[field] === right[field]) continue;
                  return (left[field] > right[field] ? 1 : -1) * (direction === 'desc' ? -1 : 1);
                }
                return 0;
              });
              return { data: structuredClone(rows.slice(offset, offset + maximum)) };
            },
          };
          return query;
        },
      };
    },
  };
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwAB/4JNP2UAAAAASUVORK5CYII=', 'base64');
const student = { name: '测试孩子', age: 8, school: '测试小学', grade: '二年级', contact1: '010-5555-1234', contact2: '' };
const future = '2030-05-11';
const ctx = (openid) => ({ OPENID: openid, ENV: 'mmw-test', APPID: 'test-app' });

function fixture({ owner = 'owner', ...options } = {}) {
  const tables = new Map(Object.values(collections).map((name) => [name, new Map()]));
  if (owner) tables.get(collections.config).set('owner', { _id: 'owner', openid: owner });
  let lastTransaction = Promise.resolve();
  const db = {
    ...reader(tables),
    command: {
      and: (value) => ({ $and: value }),
      or: (value) => ({ $or: value }),
      lt: (value) => ({ $lt: value }),
    },
    runTransaction(operation) {
      const promise = lastTransaction.then(async () => {
        const snapshot = structuredClone(tables);
        const result = await operation(reader(snapshot));
        for (const [key, value] of snapshot) tables.set(key, value);
        return result;
      });
      lastTransaction = promise.catch(() => {});
      return promise;
    },
  };
  const files = new Map();
  const qrRequests = [];
  const signRequests = [];
  const cloud = {
    openapi: { wxacode: { getUnlimited: async (request) => {
      qrRequests.push(request);
      return { buffer: png };
    } } },
    uploadFile: async ({ cloudPath, fileContent }) => {
      const fileID = 'cloud://mmw-test.bucket/' + cloudPath;
      files.set(fileID, fileContent);
      return { fileID };
    },
    downloadFile: async ({ fileID }) => {
      if (!files.has(fileID)) throw new Error('missing test file');
      return { fileContent: files.get(fileID) };
    },
    deleteFile: async ({ fileList }) => fileList.forEach((id) => files.delete(id)),
    getTempFileURL: async ({ fileList }) => {
      signRequests.push(...fileList);
      return {
        fileList: fileList.map(({ fileID }) => ({
          fileID, status: files.has(fileID) ? 0 : -1,
          tempFileURL: 'https://example.test/signed/' + encodeURIComponent(fileID),
        })),
      };
    },
  };
  let timestamp = Date.UTC(2026, 4, 11, 18);
  const execute = createBackend({ db, cloud, now: () => timestamp, ...options });
  const call = (openid, action, data = {}) => execute({ action, ...data }, ctx(openid));
  const good = async (openid, action, data) => {
    const result = await call(openid, action, data);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data;
  };
  const bad = async (openid, action, data, code) => {
    const result = await call(openid, action, data);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
  };
  const invite = async (who, type) => (await good(who, 'inviteCreate', { type })).token;
  const addTeacher = async (openid) => good(openid, 'inviteAccept', { token: await invite('owner', 'teacher') });
  const addParent = async (openid, teacher) => good(openid, 'inviteAccept', {
    token: await invite(teacher, 'parent'),
    student, guardianConsent: true,
  });
  const addPicture = async (openid) => {
    const upload = await good(openid, 'prepareUpload', { extension: 'png' });
    const { fileID } = await cloud.uploadFile({ cloudPath: upload.cloudPath, fileContent: png });
    return { upload, fileID, photo: await good(openid, 'finishUpload', { uploadId: upload.uploadId, fileId: fileID }) };
  };
  return { execute, good, bad, invite, addTeacher, addParent, addPicture, db, cloud, files, qrRequests, signRequests,
    advance: (milliseconds) => { timestamp += milliseconds; } };
}

test('trusted WeChat identity and first-owner configuration', async () => {
  const f = fixture({ owner: null });
  const guest = await f.good('caller', 'getSession', { openid: 'owner', role: 'owner' });
  assert.deepEqual(guest, { role: 'guest', student: null, setupRequired: true, openid: 'caller' });
  await f.bad('caller', 'inviteCreate', { type: 'teacher', role: 'owner' }, 'FORBIDDEN');
  assert.equal((await f.execute({ action: 'getSession', OPENID: 'caller' })).error.code, 'UNAUTHENTICATED');
  assert.equal((await f.execute({ action: 'getSession' }, { ...ctx('caller'), FROM_APPID: 'different-app' })).error.code, 'UNAUTHENTICATED');
  await f.db.collection(collections.config).doc('owner').set({ data: { openid: 'caller' } });
  assert.deepEqual(await f.good('caller', 'getSession'), { role: 'owner', student: null });
});

test('invites expire, redeem once, require guardian consent, and enforce owner-only teacher QR', async () => {
  const f = fixture({ qrEnvVersion: 'trial' });
  const teacherCode = await f.invite('owner', 'teacher');
  assert.match(teacherCode, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(f.qrRequests[0], { page: 'pages/index/index', scene: teacherCode, checkPath: false, envVersion: 'trial' });
  const competing = await Promise.all([
    f.execute({ action: 'inviteAccept', token: teacherCode }, ctx('teacher-a')),
    f.execute({ action: 'inviteAccept', token: teacherCode }, ctx('teacher-b')),
  ]);
  assert.equal(competing.filter((outcome) => outcome.ok).length, 1);
  const winner = competing[0].ok ? 'teacher-a' : 'teacher-b';
  const loser = winner === 'teacher-a' ? 'teacher-b' : 'teacher-a';
  assert.equal((await f.good(winner, 'inviteAccept', { token: teacherCode })).role, 'teacher');
  await f.bad(loser, 'inviteInspect', { token: teacherCode }, 'INVITE_INVALID');
  await f.bad(winner, 'inviteCreate', { type: 'teacher' }, 'FORBIDDEN');
  const parentCode = await f.invite(winner, 'parent');
  await f.bad('parent-a', 'inviteAccept', { token: parentCode, student }, 'CONSENT_REQUIRED');
  const { student: bound } = await f.good('parent-a', 'inviteAccept', { token: parentCode, student, guardianConsent: true });
  assert.equal(bound.name, student.name);
  const data = (await f.db.collection(collections.students).doc(bound.id).get()).data;
  assert.equal(data.teacherOpenid, winner);
  assert.ok(data.guardianConsentAt);
  const another = await f.invite(winner, 'parent');
  await f.bad('parent-a', 'inviteAccept', { token: another, student, guardianConsent: true }, 'ALREADY_BOUND');
  f.advance(24 * 60 * 60 * 1000);
  await f.bad('parent-b', 'inviteInspect', { token: another }, 'INVITE_INVALID');
});

test('future homework, idempotent retries, date-specific feedback and scoped student access', async () => {
  const f = fixture();
  await f.addTeacher('teacher-a');
  await f.addTeacher('teacher-b');
  const first = (await f.addParent('parent-a', 'teacher-a')).student;
  const second = (await f.addParent('parent-b', 'teacher-b')).student;
  const input = { date: future, note: '周末作业', requestId: 'retry-same' };
  assert.deepEqual(await f.good('parent-a', 'addAssignment', input), await f.good('parent-a', 'addAssignment', input));
  await f.bad('parent-a', 'addAssignment', { ...input, date: '2030-02-30' }, 'INVALID_DATE');
  await f.bad('parent-b', 'getDay', { date: future, studentId: first.id }, 'FORBIDDEN');
  await f.bad('teacher-b', 'getDay', { date: future, studentId: first.id }, 'FORBIDDEN');
  assert.equal((await f.good('teacher-a', 'listStudents')).items.length, 1);
  assert.equal((await f.good('owner', 'listStudents')).items.length, 2);
  assert.equal((await f.good('teacher-a', 'getDay', { date: future, studentId: first.id })).assignments.length, 1);
  assert.equal((await f.good('parent-a', 'getDay', { date: '2030-05-12' })).assignments.length, 0);
  assert.equal((await f.good('teacher-b', 'getDay', { date: future, studentId: second.id })).assignments.length, 0);
  const item = { studentId: first.id, date: future, status: 'pending', note: '已辅导' };
  await f.good('teacher-a', 'saveFeedback', item);
  await f.good('teacher-a', 'saveFeedback', { ...item, status: 'done', note: '已全部完成' });
  assert.equal((await f.good('parent-a', 'getDay', { date: future })).feedback.note, '已全部完成');
  await f.good('teacher-a', 'deleteStudent', { studentId: first.id });
  await f.good('teacher-a', 'deleteStudent', { studentId: first.id });
  assert.equal((await f.good('parent-a', 'getSession')).role, 'guest');
  await f.bad('parent-a', 'getDay', { date: future }, 'NOT_BOUND');
});

test('uploads validate environment and owner, copy to a private immutable path and sign only linked images', async () => {
  const f = fixture();
  await f.addTeacher('teacher');
  const child = (await f.addParent('parent', 'teacher')).student;
  const teacherImage = await f.addPicture('teacher');
  const assetIds = [teacherImage.photo.id];
  assert.equal(f.files.has(teacherImage.fileID), false);
  assert.equal(f.files.size, 1);
  assert.ok([...f.files.keys()][0].includes('/mmw/media/'));
  assert.equal(f.signRequests[0].maxAge, 300);
  const repeated = await f.good('teacher', 'finishUpload', { uploadId: teacherImage.upload.uploadId, fileId: teacherImage.fileID });
  assert.deepEqual(repeated, teacherImage.photo);
  await f.bad('parent', 'addAssignment', { date: future, assetIds }, 'FORBIDDEN');
  await f.bad('teacher', 'finishUpload', {
    uploadId: teacherImage.upload.uploadId,
    fileId: teacherImage.fileID.replace('mmw-test', 'other-app'),
  }, 'INVALID_UPLOAD');
  await f.good('teacher', 'saveFeedback', { studentId: child.id, date: future, status: 'done', assetIds });
  await f.good('owner', 'saveFeedback', { studentId: child.id, date: future, status: 'done', note: '补记', assetIds });
  const result = await f.good('parent', 'getDay', { date: future });
  assert.deepEqual(result.feedback.images, [teacherImage.photo]);
  await f.bad('teacher', 'publishPost', { type: 'daily', date: future, title: '错误关联', assetIds }, 'FORBIDDEN');
  const originalUrlCount = f.signRequests.length;
  await f.bad('stranger', 'getDay', { date: future, studentId: child.id }, 'NOT_BOUND');
  assert.equal(f.signRequests.length, originalUrlCount);
});

test('shared meal and daily cards paginate by chosen date without duplicate ties', async () => {
  const f = fixture();
  await f.addTeacher('teacher');
  await f.addParent('parent', 'teacher');
  const publish = (type, date, title) => f.good('teacher', 'publishPost', { type, date, title });
  await publish('meal', '2030-05-10', '较早');
  await publish('meal', '2030-05-11', '同一天 A');
  await publish('meal', '2030-05-11', '同一天 B');
  const latest = (await publish('meal', '2030-05-12', '未来')).post;
  await publish('daily', '2030-05-15', '日常');
  const received = [];
  let cursor = null;
  do {
    const result = await f.good('parent', 'listPosts', { type: 'meal', limit: 1, cursor });
    received.push(...result.items);
    cursor = result.nextCursor;
  } while (cursor);
  assert.equal(received.length, 4);
  assert.equal(new Set(received.map((post) => post.id)).size, 4);
  assert.equal(received[0].id, latest.id);
  assert.equal((await f.good('parent', 'getPost', { id: latest.id })).post.title, '未来');
  assert.equal((await f.good('parent', 'listPosts', { type: 'daily' })).items.length, 1);
  await f.bad('stranger', 'getPost', { id: latest.id }, 'NOT_BOUND');
});
