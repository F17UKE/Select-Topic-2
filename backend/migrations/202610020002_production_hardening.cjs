exports.up = async function up(knex) {
  await knex.schema.alterTable('orders', (table) => {
    table.timestamp('delivering_at', { useTz: true });
  });

  await knex.schema.createTable('idempotency_keys', (table) => {
    table.increments('id').primary();
    table.string('scope', 200).notNullable();
    table.string('idempotency_key', 128).notNullable();
    table.string('request_fingerprint', 64).notNullable();
    table.string('status', 20).notNullable().defaultTo('PROCESSING');
    table.integer('response_status');
    table.jsonb('response_body');
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('completed_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['scope', 'idempotency_key']);
    table.index(['expires_at']);
  });

  await knex.schema.createTable('line_webhook_events', (table) => {
    table.increments('id').primary();
    table.string('webhook_event_id', 160).notNullable().unique();
    table.string('event_type', 40).notNullable();
    table.string('event_hash', 64).notNullable();
    table.string('status', 20).notNullable().defaultTo('PROCESSING');
    table.string('last_error_code', 120);
    table.timestamp('processed_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['status', 'created_at']);
  });

  await knex.schema.createTable('notification_outbox', (table) => {
    table.increments('id').primary();
    table.string('event_type', 40).notNullable();
    table.integer('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE');
    table.string('recipient_line_user_id', 128).notNullable();
    table.jsonb('payload').notNullable();
    table.string('status', 20).notNullable().defaultTo('PENDING');
    table.integer('attempts').notNullable().defaultTo(0);
    table.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('sent_at', { useTz: true });
    table.string('last_error_code', 120);
    table.string('dedupe_key', 220).notNullable().unique();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['status', 'next_attempt_at']);
    table.index(['order_id']);
  });

  await knex.raw("ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_status_check CHECK (status IN ('PROCESSING', 'COMPLETED'))");
  await knex.raw("ALTER TABLE line_webhook_events ADD CONSTRAINT line_webhook_events_status_check CHECK (status IN ('PROCESSING', 'PROCESSED', 'FAILED'))");
  await knex.raw("ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_status_check CHECK (status IN ('PENDING', 'PROCESSING', 'RETRY', 'SENT'))");
  await knex.raw('ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_attempts_check CHECK (attempts >= 0)');
  await knex.raw('CREATE UNIQUE INDEX merchant_staffs_active_username_global ON merchant_staffs (lower(username)) WHERE deleted_at IS NULL');
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS merchant_staffs_active_username_global');
  await knex.schema.dropTableIfExists('notification_outbox');
  await knex.schema.dropTableIfExists('line_webhook_events');
  await knex.schema.dropTableIfExists('idempotency_keys');
  await knex.schema.alterTable('orders', (table) => table.dropColumn('delivering_at'));
};
