'use strict';

const express = require('express');
const { db, Timestamp } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const { docToJson } = require('../utils/serialize');

const router = express.Router();
const count = async (query) => (await query.count().get()).data().count;

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
    const logsSince = (event) =>
      count(db.collection('verificationLogs').where('event', '==', event).where('createdAt', '>=', since));

    const [bots, botsEnabled, groups, channels, pending, joinRequests, approved, failed, recent] =
      await Promise.all([
        count(db.collection('bots')),
        count(db.collection('bots').where('enabled', '==', true)),
        count(db.collection('groups')),
        count(db.collection('channels')),
        count(db.collection('pendingRequests').where('status', '==', 'pending')),
        logsSince('join_request'),
        logsSince('approved'),
        logsSince('verify_failed'),
        db.collection('verificationLogs').orderBy('createdAt', 'desc').limit(10).get(),
      ]);

    res.json({
      counts: { bots, botsEnabled, groups, channels, pending },
      last24h: { joinRequests, approved, failed },
      recentLogs: recent.docs.map(docToJson),
    });
  })
);

module.exports = router;
