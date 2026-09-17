'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../src/config');

const reset = process.argv.includes('--reset');

async function main() {
  const client = new Client({ connectionString: config.db.url });
  await client.connect();

  if (reset) {
    process.stdout.write('dropping existing schema...\n');
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }

  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await client.query(schema);
  process.stdout.write('schema applied\n');

  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  process.stdout.write(`tables: ${rows.map((r) => r.table_name).join(', ')}\n`);
  await client.end();
}

main().catch((err) => {
  process.stderr.write(`migration failed: ${err.message}\n`);
  process.exit(1);
});
