'use strict';

// Minimal in-memory stand-in for the Firestore Admin SDK, just enough for the verification flow tests.

class Timestamp {
  constructor(ms) {
    this.ms = ms;
  }
  static now() {
    return new Timestamp(Date.now());
  }
  static fromMillis(ms) {
    return new Timestamp(ms);
  }
  toMillis() {
    return this.ms;
  }
  toDate() {
    return new Date(this.ms);
  }
}

const FieldValue = {
  serverTimestamp: () => ({ __op: 'ts' }),
  increment: (n) => ({ __op: 'inc', n }),
};

function resolveValue(prev, value) {
  if (value && value.__op === 'ts') return Timestamp.now();
  if (value && value.__op === 'inc') return (prev || 0) + value.n;
  return value;
}

function clone(v) {
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

class DocRef {
  constructor(db, col, id) {
    this.db = db;
    this.col = col;
    this.id = id;
    this.key = `${col}/${id}`;
  }
  async get() {
    const data = this.db.store.get(this.key);
    return { exists: data !== undefined, id: this.id, ref: this, data: () => clone(data) };
  }
  async set(data, opts = {}) {
    const prev = opts.merge ? this.db.store.get(this.key) || {} : {};
    const next = opts.merge ? { ...prev } : {};
    for (const [k, v] of Object.entries(data)) next[k] = resolveValue(prev[k], v);
    this.db.store.set(this.key, next);
  }
  async update(data) {
    const prev = this.db.store.get(this.key);
    if (!prev) throw new Error(`No document to update: ${this.key}`);
    const next = { ...prev };
    for (const [k, v] of Object.entries(data)) next[k] = resolveValue(prev[k], v);
    this.db.store.set(this.key, next);
  }
  async delete() {
    this.db.store.delete(this.key);
  }
}

class Query {
  constructor(db, col, filters = [], max = Infinity) {
    this.db = db;
    this.col = col;
    this.filters = filters;
    this.max = max;
  }
  where(field, op, value) {
    if (op !== '==') throw new Error('FakeFirestore supports == only');
    return new Query(this.db, this.col, [...this.filters, [field, value]], this.max);
  }
  limit(n) {
    return new Query(this.db, this.col, this.filters, n);
  }
  async get() {
    const docs = [];
    for (const [key, data] of this.db.store.entries()) {
      if (!key.startsWith(`${this.col}/`)) continue;
      if (this.filters.every(([f, v]) => data[f] === v)) {
        const id = key.slice(this.col.length + 1);
        docs.push({ id, exists: true, ref: new DocRef(this.db, this.col, id), data: () => clone(data) });
      }
    }
    const out = docs.slice(0, this.max);
    return { docs: out, empty: out.length === 0, size: out.length };
  }
}

class Collection extends Query {
  doc(id) {
    return new DocRef(this.db, this.col, id || `auto${++this.db.counter}`.padEnd(20, 'x'));
  }
  async add(data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

class FakeDb {
  constructor() {
    this.store = new Map();
    this.counter = 0;
  }
  collection(name) {
    return new Collection(this, name);
  }
  getAll(...refs) {
    return Promise.all(refs.map((r) => r.get()));
  }
  reset() {
    this.store.clear();
  }
  seed(col, id, data) {
    this.store.set(`${col}/${id}`, clone(data));
  }
  read(col, id) {
    return this.store.get(`${col}/${id}`);
  }
  patch(col, id, data) {
    this.store.set(`${col}/${id}`, { ...this.store.get(`${col}/${id}`), ...data });
  }
  list(col) {
    return [...this.store.entries()].filter(([k]) => k.startsWith(`${col}/`)).map(([, v]) => v);
  }
}

module.exports = { FakeDb, Timestamp, FieldValue };
