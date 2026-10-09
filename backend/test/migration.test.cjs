const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const expectedTables = [
  'sois', 'dormitories', 'customers', 'customer_addresses', 'merchants',
  'merchant_images', 'merchant_staffs', 'delivery_fees', 'menu_categories',
  'menu_items', 'menu_option_groups', 'menu_option_choices', 'orders', 'order_items',
  'order_item_choices', 'payments', 'payment_slips', 'payment_verifications',
  'order_messages', 'order_chat_read_states',
];

test('Schema V3 migration and data dictionary cover the same 20 tables', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../migrations/202610020001_initial_schema.cjs'),
    'utf8',
  );
  const doc = fs.readFileSync(path.resolve(__dirname, '../../DATABASE_SCHEMA.md'), 'utf8');
  const created = [...migration.matchAll(/createTable\('([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(created, expectedTables);

  const downSource = migration.slice(migration.indexOf('exports.down'));
  const dropped = [...downSource.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(dropped, [...expectedTables].reverse());

  for (const table of expectedTables) assert.ok(doc.includes(`\`${table}\``), `Missing ${table} in schema document`);
  assert.doesNotMatch(migration, /createTable\('(reviews|banners)'/);
});

test('migration contains the approved snapshot, LINE and payment integrity fields', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../migrations/202610020001_initial_schema.cjs'),
    'utf8',
  );
  for (const field of [
    'line_user_id', 'item_name', 'choice_name', 'delivery_address_label',
    'delivery_soi_name', 'delivery_dormitory_name', 'delivery_room_number',
    'delivery_contact_phone', 'delivery_note', 'transaction_reference',
    'provider_response', 'verified_at',
  ]) assert.match(migration, new RegExp(`['"]${field}['"]`));
  assert.match(migration, /payments_transaction_reference_unique/);
  assert.match(migration, /customer_addresses_one_default/);
  assert.doesNotMatch(migration, /line_uid|line_id/);
});

test('production hardening is additive and leaves the baseline migration unchanged', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../migrations/202610020002_production_hardening.cjs'), 'utf8',
  );
  for (const table of ['idempotency_keys', 'line_webhook_events', 'notification_outbox']) {
    assert.match(migration, new RegExp(`createTable\\('${table}'`));
  }
  assert.match(migration, /table\.timestamp\('delivering_at'/);
  assert.match(migration, /merchant_staffs_active_username_global/);
  assert.doesNotMatch(migration, /dropTableIfExists\('(orders|merchant_staffs)'/);
});

test('admin backoffice migration is additive and includes security/content foundations', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../migrations/202610050003_admin_backoffice.cjs'), 'utf8',
  );
  for (const table of ['platform_admins', 'platform_admin_sessions', 'audit_logs', 'banners', 'promotions', 'system_settings']) {
    assert.match(migration, new RegExp(`createTable\\('${table}'`));
  }
  assert.match(migration, /platform_admins_active_username_unique/);
  assert.match(migration, /csrf_token_hash/);
  assert.match(migration, /table\.boolean\('is_active'\).*defaultTo\(true\)/);
  assert.doesNotMatch(migration, /dropTableIfExists\('(orders|payments|customers|merchants)'/);
});

test('customer engagement migration is additive and preserves one discount source per order', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../migrations/202610070006_customer_engagement.cjs'), 'utf8',
  );
  for (const table of ['reviews', 'customer_favorite_merchants', 'coupons', 'coupon_redemptions', 'customer_notifications']) {
    assert.match(migration, new RegExp(`createTable\\('${table}'`));
  }
  assert.match(migration, /orders_discount_source_check/);
  assert.match(migration, /coupon_id/);
  assert.match(migration, /coupon_snapshot/);
  assert.match(migration, /coupons_active_code_unique/);
  assert.doesNotMatch(migration, /dropTableIfExists\('(orders|payments|customers|merchants)'/);
});
