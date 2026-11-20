'use strict';

const { createHash, randomBytes } = require('node:crypto');

const collections = {
  config: 'mmw_config',
  accounts: 'mmw_accounts',
  students: 'mmw_students',
  days: 'mmw_days',
  assignments: 'mmw_assignments',
  posts: 'mmw_posts',
  invites: 'mmw_invites',
  uploads: 'mmw_uploads',
};

function newId() {
  return randomBytes(16).toString('hex');
}

function recordId(...values) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32);
}

async function getDocument(reader, collection, id) {
  const result = await reader.collection(collection).doc(id).get();
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function setDocument(writer, collection, id, data) {
  return writer.collection(collection).doc(id).set({ data });
}

function updateDocument(writer, collection, id, data) {
  return writer.collection(collection).doc(id).update({ data });
}

async function collectRecords(query) {
  const records = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const result = await query.skip(offset).limit(pageSize).get();
    records.push(...result.data);
    if (result.data.length < pageSize) return records;
  }
}

module.exports = { collections, newId, recordId, getDocument, setDocument, updateDocument, collectRecords };
