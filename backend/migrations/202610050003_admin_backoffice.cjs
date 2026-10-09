exports.up = async (knex) => {
  await knex.schema.createTable('platform_admins', (table) => {
    table.increments('id').primary();
    table.string('username', 80).notNullable();
    table.string('password_hash', 255).notNullable();
    table.string('full_name', 160).notNullable();
    table.string('email', 254).nullable();
    table.string('role', 24).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('last_login_at', { useTz: true }).nullable();
    table.timestamps(true, true);
    table.timestamp('deleted_at', { useTz: true }).nullable();
    table.check("role in ('SUPER_ADMIN','ADMIN','SUPPORT','FINANCE')", [], 'platform_admins_role_check');
    table.index(['role', 'is_active']);
  });
  await knex.raw('CREATE UNIQUE INDEX platform_admins_active_username_unique ON platform_admins (lower(username)) WHERE deleted_at IS NULL');

  await knex.schema.createTable('platform_admin_sessions', (table) => {
    table.increments('id').primary();
    table.integer('admin_id').notNullable().references('id').inTable('platform_admins').onDelete('CASCADE');
    table.string('token_hash', 64).notNullable().unique();
    table.string('csrf_token_hash', 64).notNullable();
    table.string('ip_address', 64).nullable();
    table.string('user_agent', 512).nullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('revoked_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['admin_id', 'revoked_at']);
    table.index(['expires_at']);
  });

  await knex.schema.createTable('audit_logs', (table) => {
    table.bigIncrements('id').primary();
    table.string('actor_type', 24).notNullable();
    table.integer('actor_id').nullable();
    table.string('action', 100).notNullable();
    table.string('entity_type', 80).notNullable();
    table.string('entity_id', 100).nullable();
    table.string('request_id', 100).nullable();
    table.string('ip_address', 64).nullable();
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.check("actor_type in ('ADMIN','MERCHANT_STAFF','SYSTEM')", [], 'audit_logs_actor_type_check');
    table.index(['created_at']);
    table.index(['actor_type', 'actor_id', 'created_at']);
    table.index(['action', 'created_at']);
    table.index(['entity_type', 'entity_id']);
  });

  await knex.schema.createTable('banners', (table) => {
    table.increments('id').primary();
    table.string('title', 200).notNullable();
    table.string('image_object_key', 500).notNullable();
    table.string('scope', 20).notNullable().defaultTo('GLOBAL');
    table.integer('merchant_id').nullable().references('id').inTable('merchants').onDelete('RESTRICT');
    table.string('target_type', 20).notNullable().defaultTo('NONE');
    table.string('target_value', 500).nullable();
    table.string('status', 20).notNullable().defaultTo('DRAFT');
    table.timestamp('starts_at', { useTz: true }).nullable();
    table.timestamp('ends_at', { useTz: true }).nullable();
    table.integer('sort_order').notNullable().defaultTo(0);
    table.integer('created_by_admin_id').nullable().references('id').inTable('platform_admins').onDelete('SET NULL');
    table.timestamps(true, true);
    table.timestamp('deleted_at', { useTz: true }).nullable();
    table.check("scope in ('GLOBAL','MERCHANT')", [], 'banners_scope_check');
    table.check("target_type in ('NONE','STORE','MENU','URL','PROMOTION')", [], 'banners_target_type_check');
    table.check("status in ('DRAFT','SCHEDULED','PUBLISHED','ARCHIVED')", [], 'banners_status_check');
    table.check('sort_order >= 0', [], 'banners_sort_order_check');
    table.check("ends_at is null or starts_at is null or ends_at > starts_at", [], 'banners_date_range_check');
    table.check("(scope = 'GLOBAL' and merchant_id is null) or (scope = 'MERCHANT' and merchant_id is not null)", [], 'banners_scope_merchant_check');
    table.index(['status', 'starts_at', 'ends_at', 'sort_order']);
    table.index(['merchant_id', 'status']);
  });

  await knex.schema.createTable('promotions', (table) => {
    table.increments('id').primary();
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
    table.integer('usage_count').notNullable().defaultTo(0);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.integer('created_by_admin_id').nullable().references('id').inTable('platform_admins').onDelete('SET NULL');
    table.timestamps(true, true);
    table.timestamp('deleted_at', { useTz: true }).nullable();
    table.check("promotion_type in ('PERCENTAGE','FIXED_AMOUNT','FREE_DELIVERY')", [], 'promotions_type_check');
    table.check('value >= 0', [], 'promotions_value_check');
    table.check("promotion_type <> 'PERCENTAGE' or value <= 100", [], 'promotions_percentage_check');
    table.check('minimum_order_amount >= 0', [], 'promotions_minimum_check');
    table.check('maximum_discount_amount is null or maximum_discount_amount >= 0', [], 'promotions_maximum_check');
    table.check('usage_limit is null or usage_limit > 0', [], 'promotions_usage_limit_check');
    table.check('usage_count >= 0', [], 'promotions_usage_count_check');
    table.check('ends_at > starts_at', [], 'promotions_date_range_check');
    table.index(['is_active', 'starts_at', 'ends_at']);
    table.index(['merchant_id', 'is_active']);
  });

  await knex.schema.createTable('system_settings', (table) => {
    table.increments('id').primary();
    table.string('setting_key', 100).notNullable().unique();
    table.jsonb('setting_value').notNullable();
    table.boolean('is_public').notNullable().defaultTo(false);
    table.integer('updated_by_admin_id').nullable().references('id').inTable('platform_admins').onDelete('SET NULL');
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('merchants', (table) => {
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('suspended_at', { useTz: true }).nullable();
    table.string('suspension_reason', 500).nullable();
    table.integer('suspended_by_admin_id').nullable().references('id').inTable('platform_admins').onDelete('SET NULL');
    table.index(['is_active', 'is_open']);
  });

  await knex.schema.alterTable('orders', (table) => {
    table.index(['created_at'], 'orders_created_at_index');
    table.index(['status', 'created_at'], 'orders_status_created_at_index');
    table.index(['payment_status', 'created_at'], 'orders_payment_status_created_at_index');
  });
  await knex.schema.alterTable('payments', (table) => {
    table.index(['status', 'created_at'], 'payments_status_created_at_index');
    table.index(['verification_status', 'created_at'], 'payments_verification_created_at_index');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('payments', (table) => {
    table.dropIndex(['verification_status', 'created_at'], 'payments_verification_created_at_index');
    table.dropIndex(['status', 'created_at'], 'payments_status_created_at_index');
  });
  await knex.schema.alterTable('orders', (table) => {
    table.dropIndex(['payment_status', 'created_at'], 'orders_payment_status_created_at_index');
    table.dropIndex(['status', 'created_at'], 'orders_status_created_at_index');
    table.dropIndex(['created_at'], 'orders_created_at_index');
  });
  await knex.schema.alterTable('merchants', (table) => {
    table.dropIndex(['is_active', 'is_open']);
    table.dropColumn('suspended_by_admin_id');
    table.dropColumn('suspension_reason');
    table.dropColumn('suspended_at');
    table.dropColumn('is_active');
  });
  for (const table of ['system_settings', 'promotions', 'banners', 'audit_logs', 'platform_admin_sessions', 'platform_admins']) {
    await knex.schema.dropTableIfExists(table);
  }
};
