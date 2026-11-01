'use strict';

const admin = require('firebase-admin');
const env = require('./env');

function buildCredential() {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    let json;
    try {
      json = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (_) {
      // Do not include the raw value in the error message.
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
    return admin.credential.cert(json);
  }
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS or the hosting platform identity.
  return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: buildCredential(),
    projectId: env.FIREBASE_PROJECT_ID,
  });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const auth = admin.auth();
const { FieldValue, Timestamp } = admin.firestore;

module.exports = { admin, db, auth, FieldValue, Timestamp };
