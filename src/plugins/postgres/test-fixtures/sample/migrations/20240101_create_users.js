exports.up = function (knex) {
  return knex.schema.createTable('users', (table) => {
    table.uuid('id').primary();
    table.string('email').notNullable().unique();
    table.string('display_name');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.boolean('is_admin').defaultTo(false);
    table.jsonb('metadata');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('users');
};
