const crypto = require('node:crypto');
const { HttpError } = require('./http.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

function createIdempotencyStore({ ttlMs = 10 * 60 * 1000, maxEntries = 1000, now = Date.now } = {}) {
  const entries = new Map();

  function prune() {
    const cutoff = now() - ttlMs;
    for (const [key, entry] of entries) {
      if (entry.createdAt < cutoff) entries.delete(key);
    }
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
  }

  async function execute({ scope, key, payload, operation }) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must contain 8-128 safe characters');
    }
    prune();
    const scopedKey = `${scope}:${key}`;
    const hash = payloadHash(payload);
    const existing = entries.get(scopedKey);
    if (existing) {
      if (existing.hash !== hash) {
        throw new HttpError(409, 'idempotency_conflict', 'This idempotency key was already used with different data');
      }
      return { value: await existing.promise, replayed: true };
    }
    const promise = Promise.resolve().then(operation);
    entries.set(scopedKey, { hash, promise, createdAt: now() });
    try {
      return { value: await promise, replayed: false };
    } catch (error) {
      entries.delete(scopedKey);
      throw error;
    }
  }

  return { execute };
}

function createPersistentIdempotencyStore({ db, ttlMs = 24 * 60 * 60 * 1000, now = Date.now }) {
  if (!db) throw new Error('Persistent idempotency requires a database');
  async function execute({ scope, key, payload, operation, responseStatus = 201 }) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must contain 8-128 safe characters');
    }
    const hash = payloadHash(payload);
    return db.transaction(async (trx) => {
      const lockKey = `${scope}:${key}`;
      await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [lockKey]);
      let existing = await trx('idempotency_keys').where({ scope, idempotency_key: key }).first();
      if (existing && new Date(existing.expires_at).getTime() <= now()) {
        await trx('idempotency_keys').where({ id: existing.id }).delete();
        existing = null;
      }
      if (existing) {
        if (existing.request_fingerprint !== hash) {
          throw new HttpError(409, 'idempotency_conflict', 'This idempotency key was already used with different data');
        }
        if (existing.status !== 'COMPLETED') throw new HttpError(409, 'idempotency_in_progress');
        return { value: existing.response_body, status: existing.response_status, replayed: true };
      }
      const [record] = await trx('idempotency_keys').insert({
        scope, idempotency_key: key, request_fingerprint: hash, status: 'PROCESSING',
        expires_at: new Date(now() + ttlMs),
      }).returning('id');
      const value = await operation(trx);
      await trx('idempotency_keys').where({ id: record.id }).update({
        status: 'COMPLETED', response_status: responseStatus, response_body: JSON.stringify(value),
        completed_at: trx.fn.now(), updated_at: trx.fn.now(),
      });
      return { value, status: responseStatus, replayed: false };
    });
  }
  async function pruneExpired() {
    return db('idempotency_keys').where('expires_at', '<=', new Date(now())).delete();
  }
  return { execute, pruneExpired };
}

module.exports = { createIdempotencyStore, createPersistentIdempotencyStore, payloadHash };
