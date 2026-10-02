// Deletes one explicitly named local test order and its private slip objects.
const fs = require('node:fs/promises');
const path = require('node:path');
require('../backend/src/env.cjs');
const { createDatabase } = require('../backend/src/database.cjs');

async function main() {
  const orderCode = process.argv[2];
  if (!orderCode) throw new Error('Usage: node scripts/cleanup-local-test-order.cjs <order-code>');
  if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST) || process.env.DB_NAME !== 'select_topic_2_local') {
    throw new Error('Cleanup is restricted to select_topic_2_local on loopback');
  }
  const db = createDatabase(process.env, { required: true });
  const storageRoot = path.resolve(process.env.SLIP_STORAGE_DIR || path.resolve(__dirname, '../backend/storage'));
  try {
    const order = await db('orders').where({ order_code: orderCode }).first('id', 'merchant_id');
    if (!order) return console.log(`No local test order found for ${orderCode}`);
    const paymentIds = (await db('payments').where({ order_id: order.id }).select('id')).map((row) => row.id);
    const keys = paymentIds.length ? await db('payment_slips').whereIn('payment_id', paymentIds).pluck('object_key') : [];
    await db.transaction(async (trx) => {
      if (paymentIds.length) {
        await trx('payment_verifications').whereIn('payment_id', paymentIds).delete();
        await trx('payment_slips').whereIn('payment_id', paymentIds).delete();
        await trx('payments').whereIn('id', paymentIds).delete();
      }
      const itemIds = (await trx('order_items').where({ order_id: order.id }).select('id')).map((row) => row.id);
      if (itemIds.length) await trx('order_item_choices').whereIn('order_item_id', itemIds).delete();
      await trx('order_items').where({ order_id: order.id }).delete();
      await trx('orders').where({ id: order.id }).delete();
      const remaining = await trx('orders').where({ merchant_id: order.merchant_id })
        .max('merchant_order_number as value').first();
      await trx('merchants').where({ id: order.merchant_id }).update({ last_order_number: Number(remaining.value || 0) });
    });
    for (const key of keys) {
      const target = path.resolve(storageRoot, ...String(key).split('/'));
      if (!target.startsWith(`${storageRoot}${path.sep}`)) throw new Error('Unsafe slip cleanup path');
      await fs.rm(target, { force: true });
    }
    console.log(`Cleaned ${orderCode}: ${paymentIds.length} payment(s), ${keys.length} slip object(s)`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
