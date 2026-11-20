'use strict';

const cloud = require('wx-server-sdk');
const { createBackend } = require('./service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const execute = createBackend({
  cloud,
  // The transaction guide documents throwOnNotFound for document reads.
  db: cloud.database({ throwOnNotFound: false }),
  ownerOpenid: process.env.MMW_OWNER_OPENID,
  qrEnvVersion: process.env.MMW_QR_ENV_VERSION,
  storageEnvId: process.env.MMW_STORAGE_ENV_ID,
});

exports.main = async (event) => execute(event, cloud.getWXContext());
