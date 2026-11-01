'use strict';

const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const { serialize } = require('../utils/serialize');
const v = require('../utils/validators');
const { DEFAULT_VERIFICATION_SETTINGS } = require('../utils/defaults');

const router = express.Router();

// Summary per group, used by the Group Management table.
router.get(
  '/',
  validate(v.botQuery, 'query'),
  asyncHandler(async (req, res) => {
    const snap = await db
      .collection('verificationSettings')
      .where('botId', '==', req.valid.query.botId)
      .get();
    res.json({
      settings: snap.docs.map((d) => ({
        groupId: d.id,
        enabled: d.data().enabled === true,
        requiredChannelIds: d.data().requiredChannelIds || [],
      })),
    });
  })
);

router.get(
  '/:groupId',
  validate(v.groupIdParam, 'params'),
  asyncHandler(async (req, res) => {
    const { groupId } = req.valid.params;
    const groupSnap = await db.collection('groups').doc(groupId).get();
    if (!groupSnap.exists) throw AppError.notFound('Group not found');
    const snap = await db.collection('verificationSettings').doc(groupId).get();
    res.json({
      group: serialize({ id: groupSnap.id, ...groupSnap.data() }),
      settings: serialize({
        ...DEFAULT_VERIFICATION_SETTINGS,
        ...(snap.exists ? snap.data() : {}),
      }),
    });
  })
);

router.put(
  '/:groupId',
  validate(v.groupIdParam, 'params'),
  validate(v.verificationUpdate),
  asyncHandler(async (req, res) => {
    const { groupId } = req.valid.params;
    const body = req.valid.body;

    const groupSnap = await db.collection('groups').doc(groupId).get();
    if (!groupSnap.exists) throw AppError.notFound('Group not found');
    const botId = groupSnap.data().botId;

    // Relationship check: every required channel must exist and belong to the same bot.
    if (body.requiredChannelIds.length) {
      const snaps = await db.getAll(...body.requiredChannelIds.map((i) => db.collection('channels').doc(i)));
      const bad = snaps.find((s) => !s.exists || s.data().botId !== botId);
      if (bad) throw AppError.badRequest('A selected channel does not exist or belongs to another bot');
    }

    const ref = db.collection('verificationSettings').doc(groupId);
    const existing = await ref.get();
    const now = FieldValue.serverTimestamp();
    await ref.set(
      {
        ...body,
        botId,
        groupId,
        updatedAt: now,
        ...(existing.exists ? {} : { createdAt: now }),
      },
      { merge: true }
    );
    res.json({ settings: serialize({ ...(await ref.get()).data() }) });
  })
);

module.exports = router;
