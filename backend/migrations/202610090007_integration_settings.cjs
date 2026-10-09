exports.up = async function (knex) {
  await knex.schema.createTable('integration_settings', (t) => {
    t.smallint('id').primary();
    t.jsonb('normal_values').notNullable().defaultTo('{}');
    t.jsonb('secret_values').notNullable().defaultTo('{}');
    t.integer('version').notNullable().defaultTo(0);
    t.integer('updated_by_admin_id').references('id').inTable('platform_admins').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check('id = 1 AND version >= 0');
    t.check("jsonb_typeof(normal_values) = 'object' AND jsonb_typeof(secret_values) = 'object'");
  });
};
exports.down = async function (knex) {
  if (await knex('integration_settings').first()) throw new Error('Remove integration overrides intentionally before rollback');
  await knex.schema.dropTable('integration_settings');
};
