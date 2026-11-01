'use strict';

/** Converts Firestore Timestamps (anywhere in the value) to ISO strings for JSON responses. */
function serialize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

function docToJson(doc) {
  return doc && doc.exists ? serialize({ id: doc.id, ...doc.data() }) : null;
}

module.exports = { serialize, docToJson };
