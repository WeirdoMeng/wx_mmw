'use strict';

const { randomBytes } = require('node:crypto');
const {
  BusinessError, fail, text, studentFields, day, documentId, assetIds, requestId,
  postType, inviteType, invalidInvite, inviteToken,
} = require('./validation');
const {
  collections, newId, recordId, getDocument, setDocument, updateDocument, collectRecords,
} = require('./database');
const { createMedia, imageFormat } = require('./media');

const inviteLifetime = 24 * 60 * 60 * 1000;

function publicStudent(record) {
  if (!record) return null;
  return {
    id: record._id,
    name: record.name,
    age: record.age,
    school: record.school,
    grade: record.grade,
    contact1: record.contact1,
    contact2: record.contact2 || '',
    guardian: record.guardian || '',
  };
}

function staff(actor) {
  if (actor.role !== 'owner' && actor.role !== 'teacher') {
    fail('FORBIDDEN', '此操作仅向老师开放');
  }
}

function member(actor) {
  if (actor.role === 'guest') fail('NOT_BOUND', '请先扫描二维码完成绑定');
}

function cursorFor(record) {
  return Buffer.from(JSON.stringify([record.type, record.date, record.createdAt, record._id])).toString('base64url');
}

function parseCursor(cursor, type) {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  try {
    if (typeof cursor !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(cursor)) throw new Error();
    const values = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(values) || values.length !== 4 || values[0] !== type ||
        !Number.isSafeInteger(values[2]) || values[2] < 0) throw new Error();
    return { date: day(values[1]), createdAt: values[2], id: documentId(values[3]) };
  } catch {
    fail('INVALID_CURSOR', '列表已更新，请刷新后重试');
  }
}

function createBackend({ db, cloud, ownerOpenid = '', qrEnvVersion = '', storageEnvId = '', now = Date.now }) {
  const media = createMedia({ cloud, db, now, storageEnvId });

  async function actorFor(reader, openid) {
    const config = ownerOpenid ? null : await getDocument(reader, collections.config, 'owner');
    const configuredOwner = ownerOpenid || (config && config.openid);
    const actor = { openid, role: 'guest', student: null, setupRequired: !configuredOwner };
    if (configuredOwner === openid) {
      actor.role = 'owner';
      return actor;
    }
    const account = await getDocument(reader, collections.accounts, openid);
    if (!account || account.active === false) return actor;
    if (account.role === 'teacher') {
      actor.role = 'teacher';
    } else if (account.role === 'parent' && account.studentId) {
      const student = await getDocument(reader, collections.students, account.studentId);
      if (student && student.active && student.parentOpenid === openid) {
        actor.role = 'parent';
        actor.student = student;
      }
    }
    return actor;
  }

  function session(actor) {
    const result = { role: actor.role, student: publicStudent(actor.student) };
    if (actor.setupRequired) {
      result.setupRequired = true;
      // Only return the caller's own identifier until a real owner is configured.
      result.openid = actor.openid;
    }
    return result;
  }

  async function scopedStudent(reader, actor, id, includeInactive = false) {
    if (actor.role === 'parent') {
      if (id && id !== actor.student._id) fail('FORBIDDEN', '只能查看已绑定孩子的资料');
      return actor.student;
    }
    staff(actor);
    const student = await getDocument(reader, collections.students, documentId(id));
    if (!student || (!student.active && !includeInactive) ||
        (actor.role === 'teacher' && student.teacherOpenid !== actor.openid)) {
      fail('FORBIDDEN', '学生不存在或没有操作权限');
    }
    return student;
  }

  function checkInvite(invite) {
    if (!invite || invite.expiresAt <= now() || invite.consumedBy) invalidInvite();
  }

  function issuerAllowed(actor, type) {
    return actor.role === 'owner' || (type === 'parent' && actor.role === 'teacher');
  }

  async function availableInviteReader(reader, token) {
    const invite = await getDocument(reader, collections.invites, token);
    checkInvite(invite);
    const issuer = await actorFor(reader, invite.issuerOpenid);
    if (!issuerAllowed(issuer, invite.type)) invalidInvite();
    return invite;
  }

  async function qrCode(token, appEnvVersion) {
    const envVersion = qrEnvVersion || appEnvVersion || 'release';
    if (!['release', 'trial', 'develop'].includes(envVersion)) {
      fail('CONFIG_REQUIRED', '小程序码版本配置无效');
    }
    let buffer;
    try {
      // WeChat getUnlimited cloud call uses camelCase checkPath and envVersion.
      const response = await cloud.openapi.wxacode.getUnlimited({
        page: 'pages/index/index',
        scene: token,
        checkPath: envVersion === 'release',
        envVersion,
      });
      buffer = response.buffer;
    } catch (error) {
      const code = String((error && (error.errCode || error.code)) || '');
      const message = String((error && (error.errMsg || error.message)) || '');
      if (code === '85412' || /\b85412\b/.test(message)) {
        fail('QR_AUTH_REQUIRED', '微信要求完成小程序认证后才能生成绑定二维码');
      }
      fail('QR_GENERATION_FAILED', '生成二维码失败，请确认小程序版本与云调用配置');
    }
    const format = imageFormat(buffer);
    if (format !== 'jpg' && format !== 'png') fail('QR_GENERATION_FAILED', '未能生成有效的二维码');
    return { imageBase64: buffer.toString('base64'), imageMime: format === 'jpg' ? 'image/jpeg' : 'image/png' };
  }

  function readImages(type, record) {
    return { type, id: record._id, ids: record.assetIds };
  }

  function publicPost(record, images) {
    return {
      id: record._id,
      type: record.type,
      title: record.title,
      date: record.date,
      note: record.note,
      images,
      createdAt: record.createdAt,
    };
  }

  const handlers = {
    getSession: async (actor) => session(actor),

    listStudents: async (actor) => {
      staff(actor);
      const criteria = { active: true };
      if (actor.role === 'teacher') criteria.teacherOpenid = actor.openid;
      const students = await collectRecords(db.collection(collections.students).where(criteria).orderBy('_id', 'asc'));
      students.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN') || left._id.localeCompare(right._id));
      return { items: students.map(publicStudent) };
    },

    getStudent: async (actor, input) => {
      member(actor);
      return { student: publicStudent(await scopedStudent(db, actor, input.studentId)) };
    },

    updateStudent: async (actor, input) => {
      staff(actor);
      const fields = studentFields(input.student);
      return db.runTransaction(async (tx) => {
        const current = await actorFor(tx, actor.openid);
        staff(current);
        const student = await scopedStudent(tx, current, input.studentId);
        await updateDocument(tx, collections.students, student._id, { ...fields, updatedAt: now() });
        return { student: publicStudent({ ...student, ...fields }) };
      });
    },

    deleteStudent: async (actor, input) => {
      staff(actor);
      return db.runTransaction(async (tx) => {
        const current = await actorFor(tx, actor.openid);
        staff(current);
        const student = await scopedStudent(tx, current, input.studentId, true);
        if (student.active) {
          const updatedAt = now();
          await updateDocument(tx, collections.students, student._id, { active: false, removedAt: updatedAt, updatedAt });
        }
        return { deleted: true };
      });
    },

    saveProfile: async (actor, input) => {
      if (actor.role !== 'parent') fail('FORBIDDEN', '仅绑定家长可以编辑孩子资料');
      const fields = studentFields(input.student);
      return db.runTransaction(async (tx) => {
        const current = await actorFor(tx, actor.openid);
        if (current.role !== 'parent' || current.student._id !== actor.student._id) {
          fail('NOT_BOUND', '家长绑定已变更，请重新打开小程序');
        }
        await updateDocument(tx, collections.students, current.student._id, { ...fields, updatedAt: now() });
        return { student: publicStudent({ ...current.student, ...fields }) };
      });
    },

    inviteCreate: async (actor, input) => {
      const type = inviteType(input.type);
      if (!issuerAllowed(actor, type)) fail('FORBIDDEN', '没有创建此二维码的权限');
      const token = randomBytes(16).toString('base64url');
      const image = await qrCode(token, input.envVersion);
      const createdAt = now();
      const expiresAt = createdAt + inviteLifetime;
      await setDocument(db, collections.invites, token, {
        type, issuerOpenid: actor.openid, createdAt, expiresAt,
      });
      return { token, ...image, expiresAt };
    },

    inviteInspect: async (actor, input) => {
      const token = inviteToken(input.token);
      const invite = await availableInviteReader(db, token);
      return { type: invite.type };
    },

    inviteAccept: async (actor, input) => {
      const token = inviteToken(input.token);
      const studentId = newId();
      return db.runTransaction(async (tx) => {
        const invite = await getDocument(tx, collections.invites, token);
        const current = await actorFor(tx, actor.openid);
        if (invite && invite.consumedBy === actor.openid && current.role === invite.type &&
            (current.role !== 'parent' || current.student._id === invite.studentId)) {
          return session(current);
        }
        checkInvite(invite);
        const issuer = await actorFor(tx, invite.issuerOpenid);
        if (!issuerAllowed(issuer, invite.type)) invalidInvite();
        if (current.role !== 'guest') fail('ALREADY_BOUND', '当前微信号已经绑定账号');
        const createdAt = now();
        const account = { role: invite.type, active: true, createdAt };
        let student = null;
        if (invite.type === 'parent') {
          if (input.guardianConsent !== true) {
            fail('CONSENT_REQUIRED', '请先阅读并同意孩子资料使用说明');
          }
          student = {
            ...studentFields(input.student),
            teacherOpenid: invite.issuerOpenid,
            parentOpenid: current.openid,
            active: true,
            createdAt,
            updatedAt: createdAt,
            guardianConsentAt: createdAt,
          };
          await setDocument(tx, collections.students, studentId, student);
          account.studentId = studentId;
        }
        await setDocument(tx, collections.accounts, current.openid, account);
        await updateDocument(tx, collections.invites, token, {
          consumedBy: current.openid,
          consumedAt: createdAt,
          ...(student ? { studentId } : {}),
        });
        return session({ ...current, role: invite.type, student: student ? { _id: studentId, ...student } : null });
      });
    },

    getDay: async (actor, input) => {
      member(actor);
      const date = day(input.date);
      const student = await scopedStudent(db, actor, input.studentId);
      const assignments = await collectRecords(db.collection(collections.assignments)
        .where({ studentId: student._id, date }).orderBy('createdAt', 'asc').orderBy('_id', 'asc'));
      const completion = await getDocument(db, collections.days, recordId('day', student._id, date));
      const references = assignments.map((item) => readImages('assignment', item));
      if (completion) references.push(readImages('feedback', completion));
      const images = await media.read(references);
      return {
        date,
        student: publicStudent(student),
        assignments: assignments.map((item, index) => ({
          id: item._id, note: item.note, images: images[index], createdAt: item.createdAt,
        })),
        feedback: completion ? {
          status: completion.status,
          note: completion.note,
          images: images[assignments.length],
          updatedAt: completion.updatedAt,
        } : null,
      };
    },

    addAssignment: async (actor, input) => {
      if (actor.role !== 'parent') fail('FORBIDDEN', '仅绑定家长可以上传作业');
      const date = day(input.date);
      const note = text(input.note, '作业说明', 2000);
      const ids = assetIds(input.assetIds);
      const retry = requestId(input.requestId);
      if (!note && !ids.length) fail('INVALID_INPUT', '请填写作业说明或添加照片');
      const id = retry ? recordId('assignment', actor.openid, actor.student._id, date, retry) : newId();
      return db.runTransaction(async (tx) => {
        const current = await actorFor(tx, actor.openid);
        if (current.role !== 'parent' || current.student._id !== actor.student._id) {
          fail('NOT_BOUND', '家长绑定已变更，请重新打开小程序');
        }
        const existing = retry && await getDocument(tx, collections.assignments, id);
        if (existing) return { id };
        await media.claim(tx, current, ids, 'assignment', id);
        await setDocument(tx, collections.assignments, id, {
          studentId: current.student._id, date, note, assetIds: ids,
          authorOpenid: current.openid, createdAt: now(),
        });
        return { id };
      });
    },

    saveFeedback: async (actor, input) => {
      staff(actor);
      const date = day(input.date);
      if (input.status !== 'done' && input.status !== 'pending') {
        fail('INVALID_INPUT', '请选择整体完成情况');
      }
      const note = text(input.note, '老师反馈', 2000);
      const ids = assetIds(input.assetIds);
      return db.runTransaction(async (tx) => {
        const current = await actorFor(tx, actor.openid);
        staff(current);
        const student = await scopedStudent(tx, current, input.studentId);
        const id = recordId('day', student._id, date);
        const previous = await getDocument(tx, collections.days, id);
        await media.claim(tx, current, ids, 'feedback', id);
        const updatedAt = now();
        await setDocument(tx, collections.days, id, {
          studentId: student._id, date, status: input.status, note, assetIds: ids,
          authorOpenid: current.openid, createdAt: previous ? previous.createdAt : updatedAt, updatedAt,
        });
        return { id };
      });
    },

    listPosts: async (actor, input) => {
      member(actor);
      const type = postType(input.type);
      const cursor = parseCursor(input.cursor, type);
      const requested = Number(input.limit);
      const limit = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 20) : 10;
      const command = db.command;
      const criteria = cursor ? command.and([{ type }, command.or([
        { date: command.lt(cursor.date) },
        { date: cursor.date, createdAt: command.lt(cursor.createdAt) },
        { date: cursor.date, createdAt: cursor.createdAt, _id: command.lt(cursor.id) },
      ])]) : { type };
      const response = await db.collection(collections.posts).where(criteria)
        .orderBy('date', 'desc').orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(limit + 1).get();
      const records = response.data.slice(0, limit);
      const allImages = await media.read(records.map((item) => readImages('post', item)));
      return {
        items: records.map((item, index) => publicPost(item, allImages[index])),
        nextCursor: response.data.length > limit ? cursorFor(records[records.length - 1]) : null,
      };
    },

    getPost: async (actor, input) => {
      member(actor);
      const item = await getDocument(db, collections.posts, documentId(input.id));
      if (!item) fail('NOT_FOUND', '这条动态不存在');
      const [images] = await media.read([readImages('post', item)]);
      return { post: publicPost(item, images) };
    },

    publishPost: async (actor, input) => {
      staff(actor);
      const type = postType(input.type);
      const date = day(input.date);
      const title = text(input.title, '动态标题', 60, true);
      const note = text(input.note, '动态描述', 2000);
      const ids = assetIds(input.assetIds);
      const retry = requestId(input.requestId);
      const id = retry ? recordId('post', actor.openid, retry) : newId();
      const item = await db.runTransaction(async (tx) => {
        const current = await actorFor(tx, actor.openid);
        staff(current);
        const existing = retry && await getDocument(tx, collections.posts, id);
        if (existing) return existing;
        await media.claim(tx, current, ids, 'post', id);
        const data = { type, date, title, note, assetIds: ids, authorOpenid: current.openid, createdAt: now() };
        await setDocument(tx, collections.posts, id, data);
        return { _id: id, ...data };
      });
      const [images] = await media.read([readImages('post', item)]);
      return { post: publicPost(item, images) };
    },

    prepareUpload: async (actor, input) => {
      member(actor);
      return media.prepare(actor, input);
    },

    finishUpload: async (actor, input, context) => {
      member(actor);
      return media.finish(actor, input, context);
    },
  };

  return async (event, context = {}) => {
    let action;
    try {
      action = event && event.action;
      if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, action)) {
        fail('UNKNOWN_ACTION', '暂不支持此操作');
      }
      if (!context.OPENID || (context.FROM_APPID && context.FROM_APPID !== context.APPID)) {
        fail('UNAUTHENTICATED', '请从微信小程序打开后重试');
      }
      const actor = await actorFor(db, context.OPENID);
      return { ok: true, data: await handlers[action](actor, event, context) };
    } catch (error) {
      if (error instanceof BusinessError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      const code = String(error && (error.code || error.errCode) || '');
      if (code === '-502005' || code === 'DATABASE_COLLECTION_NOT_EXIST') {
        return { ok: false, error: { code: 'CONFIG_REQUIRED', message: '请先创建妙妙屋所需的云数据库集合' } };
      }
      // Do not print student data, request bodies, OpenIDs or signed file URLs.
      console.error('mmw cloud error', action, /^[\w-]{1,64}$/.test(code) ? code : 'unknown');
      return { ok: false, error: { code: 'INTERNAL', message: '服务暂不可用，请稍后重试' } };
    }
  };
}

module.exports = { createBackend };
