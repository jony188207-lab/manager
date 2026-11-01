'use strict';

const express = require('express');
const { auth, db, FieldValue } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireRole } = require('../middleware/requireAuth');
const { AppError } = require('../middleware/errorHandler');
const { docToJson } = require('../utils/serialize');
const v = require('../utils/validators');

const router = express.Router();
router.use(requireRole('super_admin'));

async function assertAnotherActiveSuperAdmin(tx, targetUid) {
  const snap = await tx.get(
    db.collection('admins').where('role', '==', 'super_admin').where('active', '==', true)
  );
  if (!snap.docs.some((d) => d.id !== targetUid)) {
    throw AppError.conflict('At least one active super admin is required');
  }
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const snap = await db.collection('admins').orderBy('createdAt', 'asc').get();
    res.json({ admins: snap.docs.map((d) => ({ uid: d.id, ...docToJson(d) })) });
  })
);

// Admins must already exist in Firebase Authentication; this grants them panel access.
router.post(
  '/',
  validate(v.adminCreate),
  asyncHandler(async (req, res) => {
    const { email, role } = req.valid.body;
    let user;
    try {
      user = await auth.getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        throw AppError.notFound(
          'No Firebase user with this email. Create the user in Firebase Authentication first.'
        );
      }
      throw err;
    }
    const ref = db.collection('admins').doc(user.uid);
    if ((await ref.get()).exists) throw AppError.conflict('This user is already an admin');
    const now = FieldValue.serverTimestamp();
    await ref.set({
      email: String(user.email).toLowerCase(),
      displayName: user.displayName || null,
      role,
      active: true,
      createdBy: req.admin.uid,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ admin: { uid: user.uid, ...docToJson(await ref.get()) } });
  })
);

router.patch(
  '/:uid',
  validate(v.uidParam, 'params'),
  validate(v.adminUpdate),
  asyncHandler(async (req, res) => {
    const { uid } = req.valid.params;
    const { role, active } = req.valid.body;
    if (uid === req.admin.uid) {
      throw AppError.badRequest("You can't change your own role or disable your own account");
    }
    const ref = db.collection('admins').doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw AppError.notFound('Admin not found');
      const cur = snap.data();
      const losesSuper =
        cur.role === 'super_admin' &&
        cur.active !== false &&
        ((role && role !== 'super_admin') || active === false);
      if (losesSuper) await assertAnotherActiveSuperAdmin(tx, uid);

      const update = { updatedAt: FieldValue.serverTimestamp() };
      if (role !== undefined) update.role = role;
      if (active !== undefined) update.active = active;
      tx.update(ref, update);
    });
    res.json({ admin: { uid, ...docToJson(await ref.get()) } });
  })
);

router.delete(
  '/:uid',
  validate(v.uidParam, 'params'),
  asyncHandler(async (req, res) => {
    const { uid } = req.valid.params;
    if (uid === req.admin.uid) throw AppError.badRequest("You can't remove your own admin access");
    const ref = db.collection('admins').doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw AppError.notFound('Admin not found');
      const cur = snap.data();
      if (cur.role === 'super_admin' && cur.active !== false) {
        await assertAnotherActiveSuperAdmin(tx, uid);
      }
      tx.delete(ref);
    });
    res.json({ ok: true });
  })
);

module.exports = router;
