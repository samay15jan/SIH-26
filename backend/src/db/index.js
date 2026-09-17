'use strict';

const { Pool, types } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const pool = new Pool({
  connectionString: config.db.url,
  max: config.db.poolMax,
  statement_timeout: config.db.statementTimeoutMs,
  idleTimeoutMillis: 30000
});

pool.on('error', (err) => logger.error('postgres pool error', err));

async function query(text, params) {
  const started = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - started;
  if (ms > 1000) logger.warn('slow query', { ms, text: text.slice(0, 120) });
  return res;
}

async function one(text, params) {
  const res = await query(text, params);
  return res.rows[0] || null;
}

async function many(text, params) {
  const res = await query(text, params);
  return res.rows;
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('rollback failed', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

async function healthcheck() {
  const started = Date.now();
  const res = await pool.query('SELECT 1 AS ok');
  return { ok: res.rows[0].ok === 1, latencyMs: Date.now() - started };
}

async function ensurePartition(when) {
  const at = when instanceof Date ? when : new Date(when);
  await query('SELECT ensure_telemetry_partition($1)', [at.toISOString()]);
}

async function ensurePartitionsAround(date = new Date()) {
  const months = [-1, 0];
  for (let i = 1; i <= config.telemetry.partitionMonthsAhead; i += 1) months.push(i);
  for (const offset of months) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1, 12));
    await ensurePartition(d);
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, one, many, transaction, healthcheck, ensurePartition, ensurePartitionsAround, close };
