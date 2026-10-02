require('../src/env.cjs');
const { createDatabase } = require('../src/database.cjs');

const expectedTables = [
  'sois', 'dormitories', 'customers', 'customer_addresses', 'merchants',
  'merchant_images', 'merchant_staffs', 'delivery_fees', 'menu_categories',
  'menu_items', 'menu_option_groups', 'menu_option_choices', 'orders', 'order_items',
  'order_item_choices', 'payments', 'payment_slips', 'payment_verifications',
  'order_messages', 'order_chat_read_states',
  'idempotency_keys', 'line_webhook_events', 'notification_outbox',
];

async function main() {
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!localHosts.has(process.env.DB_HOST) || process.env.DB_NAME !== 'select_topic_2_local') {
    throw new Error('Local verification is restricted to select_topic_2_local on loopback.');
  }
  const db = createDatabase(process.env, { required: true });
  try {
    const rows = await db('pg_catalog.pg_tables')
      .select('tablename')
      .where({ schemaname: 'public' })
      .whereNotIn('tablename', ['knex_migrations', 'knex_migrations_lock'])
      .orderBy('tablename');
    const actualTables = rows.map(({ tablename }) => tablename);
    const expectedSorted = [...expectedTables].sort();
    if (JSON.stringify(actualTables) !== JSON.stringify(expectedSorted)) {
      throw new Error(`Schema mismatch. Expected ${expectedSorted.length} application tables, found ${actualTables.length}.`);
    }
    const migration = await db('knex_migrations').select('name', 'batch').orderBy('id', 'desc').first();
    const seed = {
      sois: Number((await db('sois').count('* as count').first()).count),
      dormitories: Number((await db('dormitories').count('* as count').first()).count),
      customers: Number((await db('customers').count('* as count').first()).count),
      customer_addresses: Number((await db('customer_addresses').count('* as count').first()).count),
      merchants: Number((await db('merchants').count('* as count').first()).count),
      merchant_images: Number((await db('merchant_images').count('* as count').first()).count),
      merchant_staffs: Number((await db('merchant_staffs').count('* as count').first()).count),
      delivery_fees: Number((await db('delivery_fees').count('* as count').first()).count),
      menu_categories: Number((await db('menu_categories').count('* as count').first()).count),
      menu_items: Number((await db('menu_items').count('* as count').first()).count),
      menu_option_groups: Number((await db('menu_option_groups').count('* as count').first()).count),
      menu_option_choices: Number((await db('menu_option_choices').count('* as count').first()).count),
    };
    if (Object.values(seed).some((count) => count < 1)) throw new Error('Local seed data is incomplete.');
    console.log(JSON.stringify({
      database: 'ok',
      migration,
      applicationTableCount: actualTables.length,
      tables: actualTables,
      seed,
    }, null, 2));
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
