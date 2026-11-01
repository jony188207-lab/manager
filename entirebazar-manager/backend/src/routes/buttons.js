'use strict';

const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const { docToJson } = require('../utils/serialize');
const v = require('../utils/validators');
const { buildInlineKeyboard } = require('../utils/keyboard');
const { MAX_BUTTONS_PER_ROW, MAX_BUTTONS_PER_PLACEMENT } = require('../utils/constants');

const router = express.Router();

const sortButtons = (list) =>
  list.sort((a, b) => a.row - b.row || a.position - b.position || a.id.localeCompare(b.id));

async function loadButtons(botId, placement) {
  let q = db.collection('buttons').where('botId', '==', botId);
  if (placement) q = q.where('placement', '==', placement);
  const snap = await q.get();
  return sortButtons(snap.docs.map(docToJson));
}

async function requireBot(botId) {
  if (!(await db.collection('bots').doc(botId).get()).exists) throw AppError.notFound('Bot not found');
}

router.get(
  '/',
  validate(v.buttonsQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { botId, placement } = req.valid.query;
    res.json({ buttons: await loadButtons(botId, placement) });
  })
);

// Exactly what Telegram will receive (enabled buttons only), for the preview panel.
router.get(
  '/preview',
  validate(v.buttonsQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { botId, placement } = req.valid.query;
    const buttons = await loadButtons(botId, placement);
    res.json({ inline_keyboard: buildInlineKeyboard({ buttons }).inline_keyboard });
  })
);

router.put(
  '/layout',
  validate(v.buttonLayout),
  asyncHandler(async (req, res) => {
    const { botId, placement, items } = req.valid.body;

    const perRow = {};
    for (const it of items) perRow[it.row] = (perRow[it.row] || 0) + 1;
    if (Object.values(perRow).some((n) => n > MAX_BUTTONS_PER_ROW)) {
      throw AppError.badRequest(`A row can hold at most ${MAX_BUTTONS_PER_ROW} buttons`);
    }

    const snaps = await db.getAll(...items.map((i) => db.collection('buttons').doc(i.id)));
    const bad = snaps.find(
      (s) => !s.exists || s.data().botId !== botId || s.data().placement !== placement
    );
    if (bad) throw AppError.badRequest('Layout contains a button that does not belong to this bot/placement');

    const batch = db.batch();
    items.forEach((it) =>
      batch.update(db.collection('buttons').doc(it.id), {
        row: it.row,
        position: it.position,
        updatedAt: FieldValue.serverTimestamp(),
      })
    );
    await batch.commit();
    res.json({ buttons: await loadButtons(botId, placement) });
  })
);

router.post(
  '/',
  validate(v.buttonCreate),
  asyncHandler(async (req, res) => {
    const { botId, placement, label, url, enabled } = req.valid.body;
    await requireBot(botId);

    const existing = await loadButtons(botId, placement);
    if (existing.length >= MAX_BUTTONS_PER_PLACEMENT) {
      throw AppError.badRequest(`At most ${MAX_BUTTONS_PER_PLACEMENT} buttons per message`);
    }

    let row = req.valid.body.row;
    if (row === undefined) {
      row = existing.length ? Math.max(...existing.map((b) => b.row)) : 0;
      if (existing.filter((b) => b.row === row).length >= MAX_BUTTONS_PER_ROW) row += 1;
    }
    const inRow = existing.filter((b) => b.row === row);
    if (inRow.length >= MAX_BUTTONS_PER_ROW) {
      throw AppError.badRequest(`Row ${row + 1} is full (max ${MAX_BUTTONS_PER_ROW})`);
    }
    const position = inRow.length ? Math.max(...inRow.map((b) => b.position)) + 1 : 0;

    const now = FieldValue.serverTimestamp();
    const ref = db.collection('buttons').doc();
    await ref.set({
      botId,
      placement,
      label,
      url,
      row,
      position,
      enabled,
      createdBy: req.admin.uid,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ button: docToJson(await ref.get()) });
  })
);

router.patch(
  '/:id',
  validate(v.idParam, 'params'),
  validate(v.buttonUpdate),
  asyncHandler(async (req, res) => {
    const ref = db.collection('buttons').doc(req.valid.params.id);
    if (!(await ref.get()).exists) throw AppError.notFound('Button not found');
    const update = { updatedAt: FieldValue.serverTimestamp() };
    for (const key of ['label', 'url', 'enabled']) {
      if (req.valid.body[key] !== undefined) update[key] = req.valid.body[key];
    }
    await ref.update(update);
    res.json({ button: docToJson(await ref.get()) });
  })
);

router.delete(
  '/:id',
  validate(v.idParam, 'params'),
  asyncHandler(async (req, res) => {
    const ref = db.collection('buttons').doc(req.valid.params.id);
    if (!(await ref.get()).exists) throw AppError.notFound('Button not found');
    await ref.delete();
    res.json({ ok: true });
  })
);

module.exports = router;
