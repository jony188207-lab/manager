'use strict';

const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const { serialize } = require('../utils/serialize');
const v = require('../utils/validators');
const { DEFAULT_WELCOME } = require('../utils/defaults');

const router = express.Router();

function merged(data) {
  return {
    groupWelcome: { ...DEFAULT_WELCOME.groupWelcome, ...((data && data.groupWelcome) || {}) },
    privateWelcome: { ...DEFAULT_WELCOME.privateWelcome, ...((data && data.privateWelcome) || {}) },
  };
}

async function requireBot(botId) {
  if (!(await db.collection('bots').doc(botId).get()).exists) throw AppError.notFound('Bot not found');
}

router.get(
  '/:botId',
  validate(v.botIdParam, 'params'),
  asyncHandler(async (req, res) => {
    const { botId } = req.valid.params;
    await requireBot(botId);
    const snap = await db.collection('welcomeMessages').doc(botId).get();
    res.json({ welcome: serialize(merged(snap.exists ? snap.data() : null)) });
  })
);

router.put(
  '/:botId',
  validate(v.botIdParam, 'params'),
  validate(v.welcomeUpdate),
  asyncHandler(async (req, res) => {
    const { botId } = req.valid.params;
    await requireBot(botId);
    const ref = db.collection('welcomeMessages').doc(botId);
    const existing = await ref.get();
    const now = FieldValue.serverTimestamp();
    await ref.set(
      { ...req.valid.body, botId, updatedAt: now, ...(existing.exists ? {} : { createdAt: now }) },
      { merge: true }
    );
    res.json({ welcome: serialize(merged((await ref.get()).data())) });
  })
);

module.exports = router;
