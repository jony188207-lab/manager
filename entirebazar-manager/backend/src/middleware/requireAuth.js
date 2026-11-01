'use strict';

const { auth, db } = require('../config/firebase');
const { AppError } = require('./errorHandler');
const asyncHandler = require('../utils/asyncHandler');

/**
 * 1. Verifies the Firebase ID token from the Authorization header.
 * 2. Loads the caller from the Firestore `admins` collection.
 * The role always comes from Firestore, never from the request body or token claims
 * supplied by the client.
 */
const authenticate = asyncHandler(async (req, _res, next) => {
  const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!match) throw AppError.unauthorized();

  let decoded;
  try {
    decoded = await auth.verifyIdToken(match[1]);
  } catch (_) {
    throw AppError.unauthorized('Invalid or expired token');
  }

  const snap = await db.collection('admins').doc(decoded.uid).get();
  if (!snap.exists || snap.data().active !== true) {
    throw AppError.forbidden('Your account is not an active admin');
  }
  const data = snap.data();
  req.admin = { uid: decoded.uid, email: data.email || decoded.email || null, role: data.role };
  next();
});

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return next(AppError.forbidden('Insufficient permissions'));
    }
    return next();
  };
}

module.exports = { authenticate, requireRole };
