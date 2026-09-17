'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../src/config');

async function main() {
  const client = new Client({ connectionString: config.db.url });
  await client.connect();
  const seed = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
  await client.query(seed);

  const counts = await client.query(`
    SELECT 'nodes' AS table, count(*)::int AS rows FROM nodes
    UNION ALL SELECT 'gateways', count(*)::int FROM gateways
    UNION ALL SELECT 'telemetry', count(*)::int FROM telemetry
    UNION ALL SELECT 'events', count(*)::int FROM events
    UNION ALL SELECT 'alerts', count(*)::int FROM alerts
    UNION ALL SELECT 'predictions', count(*)::int FROM predictions
    UNION ALL SELECT 'alert_rules', count(*)::int FROM alert_rules
    ORDER BY 1`);

  process.stdout.write('seed complete\n');
  for (const row of counts.rows) process.stdout.write(`  ${row.table.padEnd(12)} ${row.rows}\n`);
  await client.end();
}

main().catch((err) => {
  process.stderr.write(`seed failed: ${err.message}\n`);
  process.exit(1);
});
