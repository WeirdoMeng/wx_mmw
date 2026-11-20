'use strict';

const { documentId, fail } = require('./validation');
const { collections, newId, getDocument, setDocument, updateDocument } = require('./database');

const accepted = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']);
const uploadWindow = 15 * 60 * 1000;
const maxBytes = 8 * 1024 * 1024;
const maxAge = 300;

function imageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  const head = buffer.toString('ascii', 0, 12);
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif';
  if (head.startsWith('RIFF') && head.endsWith('WEBP')) return 'webp';
  if (head.slice(4, 8) === 'ftyp') {
    const brand = head.slice(8, 12);
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'heic';
    if (brand === 'mif1' || brand === 'msf1') return 'heif';
  }
  return null;
}

function matchesFile(fileId, environment, expectedPath) {
  if (typeof fileId !== 'string' || !environment) return false;
  const parts = /^cloud:\/\/([a-zA-Z0-9._-]{1,180})\/([^?#]+)$/.exec(fileId);
  return Boolean(parts && (parts[1] === environment || parts[1].startsWith(environment + '.')) &&
    parts[2] === expectedPath);
}

function createMedia({ cloud, db, now, storageEnvId = '' }) {
  async function prepare(actor, input) {
    const extension = input.extension === undefined ? 'jpg' :
      typeof input.extension === 'string' ? input.extension.toLowerCase() : '';
    if (!accepted.has(extension)) fail('INVALID_UPLOAD', '请选择支持的图片格式');
    const uploadId = newId();
    const cloudPath = 'mmw/staging/' + uploadId + '.' + extension;
    const createdAt = now();
    await setDocument(db, collections.uploads, uploadId, {
      ownerOpenid: actor.openid,
      cloudPath,
      state: 'pending',
      createdAt,
      expiresAt: createdAt + uploadWindow,
    });
    return { uploadId, cloudPath };
  }

  function checkUpload(row, actor, fileId, environment) {
    if (!row || row.ownerOpenid !== actor.openid) {
      fail('INVALID_UPLOAD', '图片上传凭证无效');
    }
    if (!matchesFile(fileId, environment, row.cloudPath)) {
      fail('INVALID_UPLOAD', '图片文件与上传凭证不一致');
    }
    if (row.state === 'ready' && row.sourceFileId === fileId) return;
    if (row.state !== 'pending' || row.expiresAt <= now()) {
      fail('INVALID_UPLOAD', '图片上传凭证已失效，请重新选择照片');
    }
  }

  async function deleteFile(fileId) {
    try {
      await cloud.deleteFile({ fileList: [fileId] });
    } catch {
      // A private unreferenced copy is safe to clear by the storage lifecycle.
    }
  }

  async function sign(files) {
    const urls = new Map();
    for (let offset = 0; offset < files.length; offset += 50) {
      // WeChat Cloud.getTempFileURL supports at most 50 IDs per request.
      const response = await cloud.getTempFileURL({
        fileList: files.slice(offset, offset + 50).map((fileID) => ({ fileID, maxAge })),
      });
      for (const item of response.fileList || []) {
        if (Number(item.status || 0) === 0 && /^https:\/\//.test(item.tempFileURL || '')) {
          urls.set(item.fileID, item.tempFileURL);
        }
      }
    }
    return urls;
  }

  async function finish(actor, input, context) {
    const id = documentId(input.uploadId);
    const sourceFileId = input.fileId;
    // ENV is set by the runtime and is "local" in IDE cloud-function debugging.
    const environment = context.ENV === 'local' ? storageEnvId : context.ENV;
    let row = await getDocument(db, collections.uploads, id);
    checkUpload(row, actor, sourceFileId, environment);
    let finalId = row.fileId;
    if (row.state === 'pending') {
      let source;
      try {
        source = await cloud.downloadFile({ fileID: sourceFileId });
      } catch {
        // Another request may have already finalized and removed the same staging object.
        row = await getDocument(db, collections.uploads, id);
        checkUpload(row, actor, sourceFileId, environment);
        if (row.state !== 'ready') fail('UPLOAD_INCOMPLETE', '未找到上传的图片，请重新上传');
        finalId = row.fileId;
      }
      if (source) {
        const bytes = source.fileContent;
        const format = imageFormat(bytes);
        if (!format || bytes.length > maxBytes) {
          await deleteFile(sourceFileId);
          fail('INVALID_UPLOAD', '图片格式无效或单张超过 8 MB');
        }
        // Only the cloud function can write the final prefix. Use a distinct
        // copy for each attempt so a concurrent retry cannot replace a saved photo.
        const cloudPath = 'mmw/media/' + id + '-' + newId() + '.' + format;
        const finalUpload = await cloud.uploadFile({ cloudPath, fileContent: bytes });
        const candidate = finalUpload.fileID;
        if (!matchesFile(candidate, environment, cloudPath)) {
          fail('UPLOAD_INCOMPLETE', '图片保存失败，请重试');
        }
        try {
          finalId = await db.runTransaction(async (tx) => {
            const current = await getDocument(tx, collections.uploads, id);
            checkUpload(current, actor, sourceFileId, environment);
            if (current.state === 'ready') return current.fileId;
            await updateDocument(tx, collections.uploads, id, {
              state: 'ready', fileId: candidate, sourceFileId, finishedAt: now(),
            });
            return candidate;
          });
        } catch (error) {
          // A network failure after commit must not delete the committed photo.
          const latest = await getDocument(db, collections.uploads, id).catch(() => undefined);
          if (latest && latest.fileId === candidate) finalId = candidate;
          else {
            if (latest !== undefined) await deleteFile(candidate);
            throw error;
          }
        }
        if (candidate !== finalId) await deleteFile(candidate);
        await deleteFile(sourceFileId);
      }
    }
    const urls = await sign([finalId]);
    return { id, url: urls.get(finalId) || '' };
  }

  async function claim(tx, actor, ids, linkType, linkId) {
    const uploads = [];
    for (const id of ids) uploads.push(await getDocument(tx, collections.uploads, id));
    for (const upload of uploads) {
      if (!upload || upload.state !== 'ready' || !upload.fileId) {
        fail('INVALID_UPLOAD', '有照片尚未上传成功，请重新选择');
      }
      const sameRecord = upload.linkType === linkType && upload.linkId === linkId;
      if (!sameRecord && (upload.linkId || upload.ownerOpenid !== actor.openid)) {
        fail('FORBIDDEN', '没有使用这张照片的权限');
      }
    }
    for (let index = 0; index < uploads.length; index++) {
      if (!uploads[index].linkId) {
        await updateDocument(tx, collections.uploads, ids[index], { linkType, linkId });
      }
    }
  }

  async function read(records) {
    // Each caller first authorizes the underlying business record. The link
    // check additionally prevents any unrelated private file from being signed.
    const uniqueIds = [...new Set(records.flatMap((record) => record.ids || []))];
    if (!uniqueIds.length) return records.map(() => []);
    const uploads = new Map();
    for (let offset = 0; offset < uniqueIds.length; offset += 20) {
      const batch = uniqueIds.slice(offset, offset + 20);
      await Promise.all(batch.map(async (id) => {
        const row = await getDocument(db, collections.uploads, id);
        if (row && row.state === 'ready' && row.fileId) uploads.set(id, row);
      }));
    }
    const allowed = records.map((record) => (record.ids || []).filter((id) => {
      const row = uploads.get(id);
      return row && row.linkId === record.id && row.linkType === record.type;
    }));
    const files = [...new Set(allowed.flatMap((ids) => ids.map((id) => uploads.get(id).fileId)))];
    const urls = await sign(files);
    return allowed.map((ids) => ids.map((id) => ({ id, url: urls.get(uploads.get(id).fileId) || '' })));
  }

  return { prepare, finish, claim, read };
}

module.exports = { createMedia, imageFormat };
