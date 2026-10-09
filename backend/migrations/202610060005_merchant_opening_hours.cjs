exports.up = async function (knex) {
  await knex.schema.createTable('merchant_opening_hours', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('merchant_id').notNullable().references('id').inTable('merchants');
    t.smallint('day_of_week').notNullable();
    t.time('open_time');
    t.time('close_time');
    t.boolean('is_closed').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.unique(['merchant_id', 'day_of_week']);
    t.check('day_of_week between 0 and 6');
    t.check('is_closed OR (open_time IS NOT NULL AND close_time IS NOT NULL AND close_time > open_time)');
  });
};
exports.down = (knex) => knex.schema.dropTable('merchant_opening_hours');
