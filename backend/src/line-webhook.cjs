const crypto = require('node:crypto');
const { HttpError } = require('./http.cjs');

function signatureFor(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
}

function validSignature(secret, rawBody, supplied) {
  if (!secret || typeof supplied !== 'string') return false;
  const expected = Buffer.from(signatureFor(secret, rawBody));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createLineWebhook({ secret, db, onEvent = async () => {}, maxRemembered = 5000, retentionDays = 7 }) {
  const seen = new Set();
  async function processDurably(event, eventId) {
    const eventHash = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
    let duplicate = false;
    let processingError;
    await db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`line-webhook:${eventId}`]);
      const existing = await trx('line_webhook_events').where({ webhook_event_id: eventId }).forUpdate().first();
      if (existing?.event_hash !== undefined && existing.event_hash !== eventHash) {
        throw new HttpError(409, 'line_webhook_event_conflict');
      }
      if (existing?.status === 'PROCESSED' || existing?.status === 'PROCESSING') {
        duplicate = true;
        return;
      }
      if (!existing) {
        await trx('line_webhook_events').insert({
          webhook_event_id: eventId, event_type: String(event.type || 'unknown').slice(0, 40),
          event_hash: eventHash, status: 'PROCESSING',
        });
      } else {
        await trx('line_webhook_events').where({ id: existing.id }).update({
          status: 'PROCESSING', last_error_code: null, updated_at: trx.fn.now(),
        });
      }
      try {
        if (['follow', 'unfollow', 'postback'].includes(event.type)) await onEvent(event, trx);
        await trx('line_webhook_events').where({ webhook_event_id: eventId }).update({
          status: 'PROCESSED', processed_at: trx.fn.now(), updated_at: trx.fn.now(),
        });
      } catch (error) {
        processingError = error;
        await trx('line_webhook_events').where({ webhook_event_id: eventId }).update({
          status: 'FAILED', last_error_code: String(error.code || 'event_processing_failed').slice(0, 120),
          updated_at: trx.fn.now(),
        });
      }
    });
    if (processingError) throw new HttpError(500, 'line_webhook_event_processing_failed');
    return duplicate;
  }
  async function handle(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody) || !validSignature(secret, rawBody, signature)) {
      throw new HttpError(401, 'invalid_line_signature');
    }
    let payload;
    try { payload = JSON.parse(rawBody.toString('utf8')); }
    catch { throw new HttpError(400, 'invalid_line_webhook_json'); }
    if (!Array.isArray(payload.events)) throw new HttpError(400, 'invalid_line_webhook_payload');
    let processed = 0;
    let duplicates = 0;
    for (const [index, event] of payload.events.entries()) {
      const eventId = event.webhookEventId || crypto.createHash('sha256').update(rawBody).update(String(index)).digest('hex');
      if (db) {
        if (await processDurably(event, eventId)) { duplicates += 1; continue; }
      } else {
        if (seen.has(eventId)) { duplicates += 1; continue; }
        seen.add(eventId);
        if (seen.size > maxRemembered) seen.delete(seen.values().next().value);
        if (['follow', 'unfollow', 'postback'].includes(event.type)) await onEvent(event);
      }
      processed += 1;
    }
    return { accepted: true, processed, duplicates };
  }
  async function pruneExpired() {
    if (!db) return 0;
    return db('line_webhook_events').where('created_at', '<', new Date(Date.now() - retentionDays * 86400000)).delete();
  }
  return { handle, pruneExpired };
}

module.exports = { createLineWebhook, signatureFor, validSignature };
