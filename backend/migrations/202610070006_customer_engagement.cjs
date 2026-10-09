exports.up = async function up(knex) {
  await knex.schema.createTable('reviews', (table) => {
    table.increments('id').primary();
    table.integer('order_id').notNullable().unique().references('id').inTable('orders').onDelete('RESTRICT');
    table.integer('customer_id').notNullable().references('id').inTable('customers').onDelete('RESTRICT');
    table.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('RESTRICT');
    table.smallint('rating').notNullable();
    table.text('comment').nullable();
    table.string('status', 20).notNullable().defaultTo('PUBLISHED');
    table.timestamps(true, true);
    table.index(['merchant_id', 'status', 'created_at']);
    table.index(['customer_id', 'created_at']);
    table.check('rating between 1 and 5', [], 'reviews_rating_check');
    table.check("status in ('PUBLISHED','HIDDEN')", [], 'reviews_status_check');
  });

  await knex.schema.createTable('customer_favorite_merchants', (table) => {
    table.increments('id').primary();
    table.integer('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    table.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('RESTRICT');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['customer_id', 'merchant_id']);
    table.index(['customer_id', 'created_at']);
  });

  await knex.schema.createTable('coupons', (table) => {
    table.increments('id').primary();
    table.string('code', 64).notNullable();
    table.string('name', 200).notNullable();
    table.text('description').nullable();
    table.integer('merchant_id').nullable().references('id').inTable('merchants').onDelete('RESTRICT');
    table.string('promotion_type', 24).notNullable();
    table.decimal('value', 12, 2).notNullable();
    table.decimal('minimum_order_amount', 12, 2).notNullable().defaultTo(0);
    table.decimal('maximum_discount_amount', 12, 2).nullable();
    table.timestamp('starts_at', { useTz: true }).notNullable();
    table.timestamp('ends_at', { useTz: true }).notNullable();
    table.integer('usage_limit').nullable();
    table.integer('per_customer_limit').nullable();
    table.integer('usage_count').notNullable().defaultTo(0);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.integer('created_by_admin_id').nullable().references('id').inTable('platform_admins').onDelete('SET NULL');
    table.timestamps(true, true);
    table.timestamp('deleted_at', { useTz: true }).nullable();
    table.index(['is_active', 'starts_at', 'ends_at']);
    table.index(['merchant_id', 'is_active']);
    table.check("promotion_type in ('PERCENTAGE','FIXED_AMOUNT','FREE_DELIVERY')", [], 'coupons_type_check');
    table.check('value >= 0', [], 'coupons_value_check');
    table.check("promotion_type <> 'PERCENTAGE' or value <= 100", [], 'coupons_percentage_check');
    table.check('minimum_order_amount >= 0', [], 'coupons_minimum_check');
    table.check('maximum_discount_amount is null or maximum_discount_amount >= 0', [], 'coupons_maximum_check');
    table.check('usage_limit is null or usage_limit > 0', [], 'coupons_usage_limit_check');
    table.check('per_customer_limit is null or per_customer_limit > 0', [], 'coupons_customer_limit_check');
    table.check('usage_count >= 0', [], 'coupons_usage_count_check');
    table.check('ends_at > starts_at', [], 'coupons_date_range_check');
  });
  await knex.raw('CREATE UNIQUE INDEX coupons_active_code_unique ON coupons (lower(code)) WHERE deleted_at IS NULL');

  await knex.schema.alterTable('orders', (table) => {
    table.integer('coupon_id').nullable().references('id').inTable('coupons').onDelete('RESTRICT');
    table.jsonb('coupon_snapshot').nullable();
    table.index(['coupon_id']);
  });
  await knex.raw('ALTER TABLE orders DROP CONSTRAINT orders_promotion_snapshot_check');
  await knex.raw(`ALTER TABLE orders ADD CONSTRAINT orders_discount_source_check CHECK (
    (promotion_id IS NULL AND promotion_snapshot IS NULL AND coupon_id IS NULL AND coupon_snapshot IS NULL AND discount_amount = 0)
    OR (promotion_id IS NOT NULL AND promotion_snapshot IS NOT NULL AND jsonb_typeof(promotion_snapshot) = 'object' AND coupon_id IS NULL AND coupon_snapshot IS NULL)
    OR (coupon_id IS NOT NULL AND coupon_snapshot IS NOT NULL AND jsonb_typeof(coupon_snapshot) = 'object' AND promotion_id IS NULL AND promotion_snapshot IS NULL)
  )`);

  await knex.schema.createTable('coupon_redemptions', (table) => {
    table.increments('id').primary();
    table.integer('coupon_id').notNullable().references('id').inTable('coupons').onDelete('RESTRICT');
    table.integer('customer_id').notNullable().references('id').inTable('customers').onDelete('RESTRICT');
    table.integer('order_id').notNullable().unique().references('id').inTable('orders').onDelete('RESTRICT');
    table.decimal('discount_amount', 12, 2).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['coupon_id', 'created_at']);
    table.index(['customer_id', 'created_at']);
    table.index(['coupon_id', 'customer_id']);
    table.check('discount_amount >= 0', [], 'coupon_redemptions_discount_check');
  });

  await knex.schema.createTable('customer_notifications', (table) => {
    table.bigIncrements('id').primary();
    table.integer('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    table.string('type', 40).notNullable();
    table.string('title', 200).notNullable();
    table.text('message').notNullable();
    table.integer('order_id').nullable().references('id').inTable('orders').onDelete('CASCADE');
    table.string('event_key', 220).notNullable().unique();
    table.boolean('is_read').notNullable().defaultTo(false);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['customer_id', 'is_read', 'created_at']);
    table.check("type in ('PAYMENT_VERIFIED','ORDER_ACCEPTED','PREPARING','READY','DELIVERING','COMPLETED','REJECTED','PROMOTION')", [], 'customer_notifications_type_check');
  });
};

exports.down = async function down(knex) {
  for (const table of ['reviews', 'customer_favorite_merchants', 'coupon_redemptions', 'customer_notifications']) {
    if (await knex(table).first()) throw new Error(`Cannot roll back non-empty ${table}`);
  }
  if (await knex('orders').whereNotNull('coupon_id').first()) throw new Error('Cannot roll back used coupon snapshots');
  await knex.schema.dropTableIfExists('customer_notifications');
  await knex.schema.dropTableIfExists('coupon_redemptions');
  await knex.raw('ALTER TABLE orders DROP CONSTRAINT orders_discount_source_check');
  await knex.raw(`ALTER TABLE orders ADD CONSTRAINT orders_promotion_snapshot_check CHECK (
    (promotion_id IS NULL AND promotion_snapshot IS NULL AND discount_amount = 0) OR
    (promotion_id IS NOT NULL AND promotion_snapshot IS NOT NULL AND jsonb_typeof(promotion_snapshot) = 'object'))`);
  await knex.schema.alterTable('orders', (table) => {
    table.dropColumn('coupon_id');
    table.dropColumn('coupon_snapshot');
  });
  await knex.raw('DROP INDEX IF EXISTS coupons_active_code_unique');
  await knex.schema.dropTableIfExists('coupons');
  await knex.schema.dropTableIfExists('customer_favorite_merchants');
  await knex.schema.dropTableIfExists('reviews');
};
