// Schema V3 baseline. This migration is intended for a new, empty PostgreSQL database.
const id = (table) => table.increments('id').primary();

const timestamps = (table, knex) => {
  table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
};

const softDelete = (table) => table.timestamp('deleted_at', { useTz: true });

const money = (table, name, nullable = false) => {
  const column = table.decimal(name, 12, 2);
  return nullable ? column : column.notNullable();
};

exports.up = async (knex) => {
  await knex.schema.createTable('sois', (table) => {
    id(table);
    table.string('name', 120).notNullable().unique();
    table.boolean('is_active').notNullable().defaultTo(true);
    timestamps(table, knex);
  });

  await knex.schema.createTable('dormitories', (table) => {
    id(table);
    table.integer('soi_id').notNullable().references('id').inTable('sois');
    table.string('name', 160).notNullable();
    table.text('location_text').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    timestamps(table, knex);
    table.unique(['soi_id', 'name']);
    table.index(['soi_id', 'is_active']);
  });

  await knex.schema.createTable('customers', (table) => {
    id(table);
    table.string('line_user_id', 64).notNullable().unique();
    table.string('display_name', 160);
    table.string('profile_image_url', 2048);
    table.string('phone', 32);
    table.string('email', 320);
    table.boolean('is_active').notNullable().defaultTo(true);
    timestamps(table, knex);
  });

  await knex.schema.createTable('customer_addresses', (table) => {
    id(table);
    table.integer('customer_id').notNullable().references('id').inTable('customers');
    table.integer('dormitory_id').notNullable().references('id').inTable('dormitories');
    table.string('label', 80).notNullable();
    table.string('room_number', 80).notNullable();
    table.string('contact_phone', 32).notNullable();
    table.text('address_detail');
    table.boolean('is_default').notNullable().defaultTo(false);
    timestamps(table, knex);
    table.unique(['id', 'customer_id']);
    table.index('customer_id');
    table.index('dormitory_id');
  });

  await knex.schema.createTable('merchants', (table) => {
    id(table);
    table.string('store_name', 180).notNullable();
    table.string('phone', 32).notNullable();
    table.text('location_text').notNullable();
    table.string('promptpay_identifier_type', 24).notNullable();
    table.string('promptpay_id', 32).notNullable();
    table.string('prefix', 16).notNullable().unique();
    table.integer('last_order_number').notNullable().defaultTo(0);
    table.boolean('is_open').notNullable().defaultTo(false);
    timestamps(table, knex);
    softDelete(table);
  });

  await knex.schema.createTable('merchant_images', (table) => {
    id(table);
    table.integer('merchant_id').notNullable().references('id').inTable('merchants');
    table.string('image_url', 2048).notNullable();
    table.string('alt_text', 255);
    table.integer('sort_order').notNullable().defaultTo(0);
    table.boolean('is_primary').notNullable().defaultTo(false);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['merchant_id', 'is_primary', 'sort_order']);
  });

  await knex.schema.createTable('merchant_staffs', (table) => {
    id(table);
    table.integer('merchant_id').notNullable().references('id').inTable('merchants');
    table.string('username', 120).notNullable();
    table.string('password_hash', 255).notNullable();
    table.string('full_name', 180).notNullable();
    table.string('phone', 32);
    table.string('line_user_id', 64).unique();
    table.string('role', 24).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    timestamps(table, knex);
    softDelete(table);
    table.unique(['id', 'merchant_id']);
    table.index(['merchant_id', 'role', 'is_active']);
  });

  await knex.schema.createTable('delivery_fees', (table) => {
    id(table);
    table.integer('merchant_id').notNullable().references('id').inTable('merchants');
    table.integer('soi_id').notNullable().references('id').inTable('sois');
    money(table, 'fee');
    table.unique(['merchant_id', 'soi_id']);
    table.index(['soi_id', 'merchant_id']);
  });

  await knex.schema.createTable('menu_categories', (table) => {
    id(table);
    table.integer('merchant_id').notNullable().references('id').inTable('merchants');
    table.string('name', 120).notNullable();
    table.integer('sort_order').notNullable().defaultTo(0);
    table.boolean('is_active').notNullable().defaultTo(true);
    timestamps(table, knex);
    softDelete(table);
    table.unique(['id', 'merchant_id']);
    table.index(['merchant_id', 'sort_order']);
  });

  await knex.schema.createTable('menu_items', (table) => {
    id(table);
    table.integer('merchant_id').notNullable().references('id').inTable('merchants');
    table.integer('category_id').notNullable();
    table.string('name', 180).notNullable();
    table.text('description');
    table.string('image_url', 2048);
    money(table, 'price');
    table.boolean('is_available').notNullable().defaultTo(true);
    table.integer('stock_quantity');
    table.integer('sort_order').notNullable().defaultTo(0);
    timestamps(table, knex);
    softDelete(table);
    table.unique(['id', 'merchant_id']);
    table.foreign(['category_id', 'merchant_id'])
      .references(['id', 'merchant_id']).inTable('menu_categories');
    table.index(['merchant_id', 'category_id', 'is_available', 'sort_order']);
  });

  await knex.schema.createTable('menu_option_groups', (table) => {
    id(table);
    table.integer('menu_item_id').notNullable().references('id').inTable('menu_items');
    table.string('name', 120).notNullable();
    table.boolean('is_required').notNullable().defaultTo(false);
    table.integer('min_choices').notNullable().defaultTo(0);
    table.integer('max_choices').notNullable().defaultTo(1);
    table.integer('sort_order').notNullable().defaultTo(0);
    table.index(['menu_item_id', 'sort_order']);
  });

  await knex.schema.createTable('menu_option_choices', (table) => {
    id(table);
    table.integer('option_group_id').notNullable().references('id').inTable('menu_option_groups');
    table.string('name', 120).notNullable();
    money(table, 'extra_price');
    table.boolean('is_available').notNullable().defaultTo(true);
    table.integer('sort_order').notNullable().defaultTo(0);
    table.index(['option_group_id', 'is_available', 'sort_order']);
  });

  await knex.schema.createTable('orders', (table) => {
    id(table);
    table.string('order_code', 64).notNullable().unique();
    table.integer('merchant_order_number').notNullable();
    table.integer('customer_id').notNullable().references('id').inTable('customers');
    table.integer('merchant_id').notNullable().references('id').inTable('merchants');
    table.integer('customer_address_id');
    table.integer('assigned_rider_id');
    table.string('delivery_type', 16).notNullable();
    table.string('status', 24).notNullable().defaultTo('PENDING');
    table.string('payment_method', 24).notNullable();
    table.string('payment_status', 32).notNullable().defaultTo('UNPAID');
    money(table, 'subtotal_amount');
    money(table, 'delivery_fee').defaultTo(0);
    money(table, 'total_amount');
    table.string('delivery_address_label', 80);
    table.string('delivery_soi_name', 120);
    table.string('delivery_dormitory_name', 160);
    table.text('delivery_location_text');
    table.string('delivery_room_number', 80);
    table.string('delivery_contact_phone', 32);
    table.text('delivery_note');
    table.timestamp('accepted_at', { useTz: true });
    table.timestamp('completed_at', { useTz: true });
    table.timestamp('cancelled_at', { useTz: true });
    timestamps(table, knex);
    table.unique(['merchant_id', 'merchant_order_number']);
    table.unique(['id', 'merchant_id']);
    table.foreign(['customer_address_id', 'customer_id'])
      .references(['id', 'customer_id']).inTable('customer_addresses');
    table.foreign(['assigned_rider_id', 'merchant_id'])
      .references(['id', 'merchant_id']).inTable('merchant_staffs');
    table.index(['customer_id', 'created_at']);
    table.index(['merchant_id', 'status', 'created_at']);
    table.index(['merchant_id', 'payment_status', 'created_at']);
    table.index(['merchant_id', 'assigned_rider_id', 'status']);
  });

  await knex.schema.createTable('order_items', (table) => {
    id(table);
    table.integer('order_id').notNullable();
    table.integer('merchant_id').notNullable();
    table.integer('menu_item_id');
    table.string('item_name', 180).notNullable();
    table.integer('quantity').notNullable();
    money(table, 'unit_price');
    table.text('note');
    table.boolean('is_completed').notNullable().defaultTo(false);
    table.foreign(['order_id', 'merchant_id'])
      .references(['id', 'merchant_id']).inTable('orders');
    table.foreign(['menu_item_id', 'merchant_id'])
      .references(['id', 'merchant_id']).inTable('menu_items');
    table.index('order_id');
    table.index('menu_item_id');
  });

  await knex.schema.createTable('order_item_choices', (table) => {
    id(table);
    table.integer('order_item_id').notNullable().references('id').inTable('order_items');
    table.integer('menu_option_choice_id').references('id').inTable('menu_option_choices');
    table.string('choice_name', 120).notNullable();
    money(table, 'extra_price');
    table.index('order_item_id');
    table.index('menu_option_choice_id');
  });

  await knex.schema.createTable('payments', (table) => {
    id(table);
    table.integer('order_id').notNullable().references('id').inTable('orders');
    table.string('method', 24).notNullable();
    table.string('status', 24).notNullable().defaultTo('PENDING');
    table.string('verification_status', 24).notNullable().defaultTo('PENDING');
    money(table, 'expected_amount');
    money(table, 'amount_transferred', true);
    table.string('provider', 80);
    table.string('transaction_reference', 255);
    table.timestamp('verified_at', { useTz: true });
    table.timestamp('paid_at', { useTz: true });
    timestamps(table, knex);
    table.index(['order_id', 'created_at']);
    table.index(['order_id', 'status']);
  });

  await knex.schema.createTable('payment_slips', (table) => {
    id(table);
    table.integer('payment_id').notNullable().unique().references('id').inTable('payments');
    table.string('object_key', 1024).notNullable();
    table.string('file_hash', 128).notNullable().unique();
    table.timestamp('uploaded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('purge_after', { useTz: true }).notNullable();
    softDelete(table);
    table.index(['purge_after', 'deleted_at']);
  });

  await knex.schema.createTable('payment_verifications', (table) => {
    id(table);
    table.integer('payment_id').notNullable().references('id').inTable('payments');
    table.string('provider', 80).notNullable();
    table.string('provider_request_id', 255);
    table.string('status', 24).notNullable();
    table.string('failure_code', 120);
    table.string('provider_transaction_reference', 255);
    money(table, 'reported_amount', true);
    table.boolean('amount_matches');
    table.boolean('recipient_matches');
    table.jsonb('provider_response').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamp('verified_at', { useTz: true });
    table.timestamp('response_purge_after', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['provider', 'provider_request_id']);
    table.index(['payment_id', 'created_at']);
  });

  await knex.schema.createTable('order_messages', (table) => {
    id(table);
    table.integer('order_id').notNullable().references('id').inTable('orders');
    table.string('sender_type', 16).notNullable();
    table.integer('sender_customer_id').references('id').inTable('customers');
    table.integer('sender_staff_id').references('id').inTable('merchant_staffs');
    table.string('sender_role_snapshot', 24).notNullable();
    table.string('message_type', 16).notNullable();
    table.text('content_text');
    table.string('object_key', 1024);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['id', 'order_id']);
    table.index(['order_id', 'created_at', 'id']);
  });

  await knex.schema.createTable('order_chat_read_states', (table) => {
    id(table);
    table.integer('order_id').notNullable().references('id').inTable('orders');
    table.string('reader_type', 16).notNullable();
    table.integer('customer_id').references('id').inTable('customers');
    table.integer('staff_id').references('id').inTable('merchant_staffs');
    table.integer('last_read_message_id');
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index('order_id');
  });

  const statements = [
    `CREATE UNIQUE INDEX customer_addresses_one_default ON customer_addresses (customer_id) WHERE is_default`,
    `CREATE UNIQUE INDEX merchant_images_one_primary ON merchant_images (merchant_id) WHERE is_primary`,
    `CREATE UNIQUE INDEX merchant_staffs_active_username ON merchant_staffs (merchant_id, username) WHERE deleted_at IS NULL`,
    `CREATE UNIQUE INDEX menu_categories_active_name ON menu_categories (merchant_id, name) WHERE deleted_at IS NULL`,
    `CREATE UNIQUE INDEX payments_transaction_reference_unique ON payments (transaction_reference) WHERE transaction_reference IS NOT NULL`,
    `CREATE UNIQUE INDEX payments_one_paid_per_order ON payments (order_id) WHERE status = 'PAID'`,
    `CREATE UNIQUE INDEX order_chat_read_customer_unique ON order_chat_read_states (order_id, customer_id) WHERE customer_id IS NOT NULL`,
    `CREATE UNIQUE INDEX order_chat_read_staff_unique ON order_chat_read_states (order_id, staff_id) WHERE staff_id IS NOT NULL`,
    `ALTER TABLE order_chat_read_states ADD CONSTRAINT order_chat_last_read_same_order_fk FOREIGN KEY (last_read_message_id, order_id) REFERENCES order_messages (id, order_id) ON DELETE SET NULL (last_read_message_id)`,
    `ALTER TABLE merchants ADD CONSTRAINT merchants_promptpay_type_check CHECK (promptpay_identifier_type IN ('PHONE', 'NATIONAL_ID', 'TAX_ID', 'EWALLET'))`,
    `ALTER TABLE merchants ADD CONSTRAINT merchants_order_counter_check CHECK (last_order_number >= 0)`,
    `ALTER TABLE merchant_images ADD CONSTRAINT merchant_images_sort_order_check CHECK (sort_order >= 0)`,
    `ALTER TABLE merchant_staffs ADD CONSTRAINT merchant_staffs_role_check CHECK (role IN ('MANAGER', 'CASHIER', 'KITCHEN', 'RIDER'))`,
    `ALTER TABLE delivery_fees ADD CONSTRAINT delivery_fees_nonnegative_check CHECK (fee >= 0)`,
    `ALTER TABLE menu_categories ADD CONSTRAINT menu_categories_sort_order_check CHECK (sort_order >= 0)`,
    `ALTER TABLE menu_items ADD CONSTRAINT menu_items_values_check CHECK (price >= 0 AND (stock_quantity IS NULL OR stock_quantity >= 0) AND sort_order >= 0)`,
    `ALTER TABLE menu_option_groups ADD CONSTRAINT menu_option_groups_choices_check CHECK (min_choices >= 0 AND max_choices >= 1 AND min_choices <= max_choices AND (NOT is_required OR min_choices >= 1) AND sort_order >= 0)`,
    `ALTER TABLE menu_option_choices ADD CONSTRAINT menu_option_choices_values_check CHECK (extra_price >= 0 AND sort_order >= 0)`,
    `ALTER TABLE orders ADD CONSTRAINT orders_delivery_type_check CHECK (delivery_type IN ('DELIVERY', 'PICKUP'))`,
    `ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED', 'REJECTED'))`,
    `ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('PROMPTPAY', 'COD'))`,
    `ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check CHECK (payment_status IN ('UNPAID', 'PENDING_VERIFICATION', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'))`,
    `ALTER TABLE orders ADD CONSTRAINT orders_amounts_check CHECK (subtotal_amount >= 0 AND delivery_fee >= 0 AND total_amount >= 0 AND total_amount = subtotal_amount + delivery_fee)`,
    `ALTER TABLE orders ADD CONSTRAINT orders_delivery_snapshot_check CHECK ((delivery_type = 'DELIVERY' AND customer_address_id IS NOT NULL AND delivery_address_label IS NOT NULL AND delivery_soi_name IS NOT NULL AND delivery_dormitory_name IS NOT NULL AND delivery_location_text IS NOT NULL AND delivery_room_number IS NOT NULL AND delivery_contact_phone IS NOT NULL) OR (delivery_type = 'PICKUP' AND customer_address_id IS NULL AND delivery_fee = 0 AND delivery_address_label IS NULL AND delivery_soi_name IS NULL AND delivery_dormitory_name IS NULL AND delivery_location_text IS NULL AND delivery_room_number IS NULL AND delivery_contact_phone IS NULL))`,
    `ALTER TABLE order_items ADD CONSTRAINT order_items_values_check CHECK (quantity > 0 AND unit_price >= 0)`,
    `ALTER TABLE order_item_choices ADD CONSTRAINT order_item_choices_price_check CHECK (extra_price >= 0)`,
    `ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('PROMPTPAY', 'COD'))`,
    `ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('PENDING', 'SUBMITTED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'))`,
    `ALTER TABLE payments ADD CONSTRAINT payments_verification_status_check CHECK (verification_status IN ('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'VERIFIED', 'REJECTED', 'ERROR'))`,
    `ALTER TABLE payments ADD CONSTRAINT payments_amounts_check CHECK (expected_amount >= 0 AND (amount_transferred IS NULL OR amount_transferred >= 0))`,
    `ALTER TABLE payments ADD CONSTRAINT payments_method_verification_check CHECK ((method = 'COD' AND verification_status = 'NOT_REQUIRED') OR method = 'PROMPTPAY')`,
    `ALTER TABLE payment_verifications ADD CONSTRAINT payment_verifications_status_check CHECK (status IN ('PENDING', 'PROCESSING', 'VERIFIED', 'REJECTED', 'ERROR'))`,
    `ALTER TABLE payment_verifications ADD CONSTRAINT payment_verifications_amount_check CHECK (reported_amount IS NULL OR reported_amount >= 0)`,
    `ALTER TABLE order_messages ADD CONSTRAINT order_messages_sender_type_check CHECK (sender_type IN ('CUSTOMER', 'STAFF', 'SYSTEM'))`,
    `ALTER TABLE order_messages ADD CONSTRAINT order_messages_sender_role_check CHECK (sender_role_snapshot IN ('CUSTOMER', 'MANAGER', 'CASHIER', 'KITCHEN', 'RIDER', 'SYSTEM'))`,
    `ALTER TABLE order_messages ADD CONSTRAINT order_messages_type_check CHECK (message_type IN ('TEXT', 'IMAGE', 'SYSTEM'))`,
    `ALTER TABLE order_messages ADD CONSTRAINT order_messages_sender_check CHECK ((sender_type = 'CUSTOMER' AND sender_customer_id IS NOT NULL AND sender_staff_id IS NULL) OR (sender_type = 'STAFF' AND sender_customer_id IS NULL AND sender_staff_id IS NOT NULL) OR (sender_type = 'SYSTEM' AND sender_customer_id IS NULL AND sender_staff_id IS NULL))`,
    `ALTER TABLE order_messages ADD CONSTRAINT order_messages_content_check CHECK ((message_type IN ('TEXT', 'SYSTEM') AND content_text IS NOT NULL) OR (message_type = 'IMAGE' AND object_key IS NOT NULL))`,
    `ALTER TABLE order_chat_read_states ADD CONSTRAINT order_chat_reader_type_check CHECK (reader_type IN ('CUSTOMER', 'STAFF'))`,
    `ALTER TABLE order_chat_read_states ADD CONSTRAINT order_chat_reader_check CHECK ((reader_type = 'CUSTOMER' AND customer_id IS NOT NULL AND staff_id IS NULL) OR (reader_type = 'STAFF' AND customer_id IS NULL AND staff_id IS NOT NULL))`,
  ];

  for (const statement of statements) await knex.raw(statement);
};

exports.down = async (knex) => {
  const tables = [
    'order_chat_read_states', 'order_messages', 'payment_verifications', 'payment_slips',
    'payments', 'order_item_choices', 'order_items', 'orders', 'menu_option_choices',
    'menu_option_groups', 'menu_items', 'menu_categories', 'delivery_fees', 'merchant_staffs',
    'merchant_images', 'merchants', 'customer_addresses', 'customers', 'dormitories', 'sois',
  ];
  for (const table of tables) await knex.schema.dropTable(table);
};
