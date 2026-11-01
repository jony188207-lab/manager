'use strict';

const { db } = require('../config/firebase');
const { DEFAULT_GENERAL } = require('../utils/defaults');

async function getGeneral() {
  const snap = await db.collection('settings').doc('general').get();
  return { ...DEFAULT_GENERAL, ...(snap.exists ? snap.data() : {}) };
}

module.exports = { getGeneral };
