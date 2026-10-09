exports.up = async (knex) => {
  await knex.schema.alterTable('orders', (table) => {
    table.integer('promotion_id').nullable().references('id').inTable('promotions').onDelete('RESTRICT');
    table.jsonb('promotion_snapshot').nullable();
    table.decimal('discount_amount', 12, 2).notNullable().defaultTo(0);
    table.index(['promotion_id']);
  });
  await knex.raw('ALTER TABLE orders DROP CONSTRAINT orders_amounts_check');
  await knex.raw(`ALTER TABLE orders ADD CONSTRAINT orders_amounts_check CHECK (
    subtotal_amount >= 0 AND delivery_fee >= 0 AND discount_amount >= 0 AND
    discount_amount <= subtotal_amount + delivery_fee AND total_amount >= 0 AND
    total_amount = subtotal_amount + delivery_fee - discount_amount)`);
  await knex.raw(`ALTER TABLE orders ADD CONSTRAINT orders_promotion_snapshot_check CHECK (
    (promotion_id IS NULL AND promotion_snapshot IS NULL AND discount_amount = 0) OR
    (promotion_id IS NOT NULL AND promotion_snapshot IS NOT NULL AND jsonb_typeof(promotion_snapshot) = 'object'))`);
  await knex.schema.createTable('promotion_redemptions', (table) => {
    table.increments('id').primary();
    table.integer('promotion_id').notNullable().references('id').inTable('promotions').onDelete('RESTRICT');
    table.integer('order_id').notNullable().unique().references('id').inTable('orders').onDelete('RESTRICT');
    table.integer('customer_id').notNullable().references('id').inTable('customers').onDelete('RESTRICT');
    table.decimal('discount_amount', 12, 2).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.check('discount_amount >= 0', [], 'promotion_redemptions_discount_check');
    table.index(['promotion_id', 'created_at']);
    table.index(['customer_id', 'created_at']);
  });
};

exports.down = async (knex) => {
  // Never silently erase a used promotion ledger or change paid order amounts.
  if (await knex('orders').whereNotNull('promotion_id').first()) throw new Error('Cannot roll back used promotion snapshots');
  await knex.schema.dropTable('promotion_redemptions');
  await knex.raw('ALTER TABLE orders DROP CONSTRAINT orders_promotion_snapshot_check');
  await knex.raw('ALTER TABLE orders DROP CONSTRAINT orders_amounts_check');
  await knex.raw(`ALTER TABLE orders ADD CONSTRAINT orders_amounts_check CHECK (
    subtotal_amount >= 0 AND delivery_fee >= 0 AND total_amount >= 0 AND total_amount = subtotal_amount + delivery_fee)`);
  await knex.schema.alterTable('orders', (table) => {
    table.dropColumn('promotion_id');
    table.dropColumn('promotion_snapshot');
    table.dropColumn('discount_amount');
  });
};
