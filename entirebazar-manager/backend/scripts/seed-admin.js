'use strict';

/**
 * Creates (or promotes) the first super admin.
 *   npm run seed-admin -- you@example.com
 * The user must already exist in Firebase Authentication (Console -> Authentication -> Users).
 * This runs with the Admin SDK on your machine, so there is no public "become admin" endpoint.
 */
const { auth, db, FieldValue } = require('../src/config/firebase');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run seed-admin -- admin@example.com');
    process.exit(1);
  }

  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.error(
        'No Firebase Authentication user with that email. Create it first in Firebase Console -> Authentication -> Users.'
      );
      process.exit(1);
    }
    throw err;
  }

  const ref = db.collection('admins').doc(user.uid);
  const snap = await ref.get();
  const now = FieldValue.serverTimestamp();
  if (snap.exists) {
    await ref.update({ role: 'super_admin', active: true, updatedAt: now });
  } else {
    await ref.set({
      email,
      displayName: user.displayName || null,
      role: 'super_admin',
      active: true,
      createdBy: 'seed-script',
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`Super admin ready: ${email} (uid ${user.uid})`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
