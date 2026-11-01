'use strict';

const { db } = require('../config/firebase');

/** Deletes every document in `collection` where `field == value`, in batches. Returns the count. */
async function deleteWhere(collection, field, value) {
  let total = 0;
  for (;;) {
    const snap = await db.collection(collection).where(field, '==', value).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
  }
  return total;
}

module.exports = { deleteWhere };
