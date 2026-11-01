'use strict';

const express = require('express');
const { db, Timestamp } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireRole } = require('../middleware/requireAuth');
const { docToJson } = require('../utils/serialize');
const v = require('../utils/validators');
const { getGeneral } = require('../services/settingsService');

const router = express.Router();

router.get(
  '/',
  validate(v.logsQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { botId, event, userId, limit, cursor } = req.valid.query;
    const col = db.collection('verificationLogs');

    let q = col;
    if (botId) q = q.where('botId', '==', botId);
    if (event) q = q.where('event', '==', event);
    if (userId) q = q.where('userId', '==', userId);
    q = q.orderBy('createdAt', 'desc');
    if (cursor) {
      const cursorSnap = await col.doc(cursor).get();
      if (cursorSnap.exists) q = q.startAfter(cursorSnap);
    }

    const snap = await q.limit(limit + 1).get();
    const docs = snap.docs.slice(0, limit);
    res.json({
      logs: docs.map(docToJson),
      nextCursor: snap.docs.length > limit ? docs[docs.length - 1].id : null,
    });
  })
);

// Deletes logs older than the configured retention (General Settings). Super admins only.
router.post(
  '/purge',
  requireRole('super_admin'),
  asyncHandler(async (_req, res) => {
    const { logRetentionDays } = await getGeneral();
    const cutoff = Timestamp.fromMillis(Date.now() - logRetentionDays * 24 * 60 * 60 * 1000);
    let deleted = 0;
    for (let i = 0; i < 25; i += 1) {
      const snap = await db
        .collection('verificationLogs')
        .where('createdAt', '<', cutoff)
        .orderBy('createdAt')
        .limit(400)
        .get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
    }
    res.json({ deleted, retentionDays: logRetentionDays });
  })
);

module.exports = router;
