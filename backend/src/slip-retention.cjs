function createSlipRetention({ db, storage, logger = console, now = Date.now }) {
  async function purgeBatch(limit = 100) {
    const rows = await db('payment_slips').select('id', 'object_key')
      .whereNull('deleted_at').where('purge_after', '<=', new Date(now())).orderBy('id').limit(limit);
    let purged = 0;
    for (const row of rows) {
      try {
        await storage.remove(row.object_key);
        await db('payment_slips').where({ id: row.id }).whereNull('deleted_at').update({ deleted_at: db.fn.now() });
        purged += 1;
      } catch (error) {
        logger.error('Slip retention cleanup failed', { slip_id: row.id, code: error.code || 'storage_error' });
      }
    }
    await db('payment_verifications').whereNotNull('response_purge_after')
      .where('response_purge_after', '<=', new Date(now())).update({ provider_response: JSON.stringify({ purged: true }) });
    return purged;
  }
  return { purgeBatch };
}

function startSlipRetentionWorker(retention, { intervalMs = 60 * 60 * 1000 } = {}) {
  const run = () => retention.purgeBatch().catch(() => {});
  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();
  return { stop: () => clearInterval(timer), run };
}

module.exports = { createSlipRetention, startSlipRetentionWorker };
