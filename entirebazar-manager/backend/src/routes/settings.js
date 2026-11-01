'use strict';

const express = require('express');
const env = require('../config/env');
const { db, FieldValue } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireRole } = require('../middleware/requireAuth');
const { serialize } = require('../utils/serialize');
const v = require('../utils/validators');
const { getGeneral } = require('../services/settingsService');

const router = express.Router();

router.get(
  '/general',
  asyncHandler(async (_req, res) => {
    res.json({
      settings: serialize(await getGeneral()),
      serverInfo: { publicBaseUrl: env.PUBLIC_BASE_URL },
    });
  })
);

router.put(
  '/general',
  requireRole('super_admin'),
  validate(v.generalUpdate),
  asyncHandler(async (req, res) => {
    await db
      .collection('settings')
      .doc('general')
      .set({ ...req.valid.body, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ settings: serialize(await getGeneral()) });
  })
);

module.exports = router;
