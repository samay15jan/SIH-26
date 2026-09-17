'use strict';

const config = require('./config');
const logger = require('./utils/logger');
const db = require('./db');
const { buildApp } = require('./app');
const mqttClient = require('./mqtt');
const monitor = require('./services/monitor');
const rules = require('./rules/engine');

let app;
let shuttingDown = false;

async function waitForDatabase(attempts = 15) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await db.healthcheck();
      logger.info('database connected');
      return;
    } catch (err) {
      logger.warn('waiting for database', { attempt: i, error: err.message });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('database is not reachable');
}

async function verifySchema() {
  const row = await db.one(`SELECT to_regclass('public.telemetry') AS telemetry, to_regclass('public.nodes') AS nodes`);
  if (!row.telemetry || !row.nodes) {
    throw new Error('Database schema is missing. Run: npm run migrate && npm run seed');
  }
}

async function start() {
  await waitForDatabase();
  await verifySchema();
  await db.ensurePartitionsAround();
  await rules.load(true);

  app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  logger.info('HTTP server listening', { port: config.port, host: config.host });

  await mqttClient.start();
  monitor.start();

  return app;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  monitor.stop();
  try {
    await mqttClient.stop();
  } catch (err) {
    logger.warn('mqtt shutdown error', { error: err.message });
  }
  try {
    if (app) await app.close();
  } catch (err) {
    logger.warn('http shutdown error', { error: err.message });
  }
  try {
    await db.close();
  } catch (err) {
    logger.warn('database shutdown error', { error: err.message });
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error('unhandled rejection', err));
process.on('uncaughtException', (err) => {
  logger.error('uncaught exception', err);
  shutdown('uncaughtException');
});

if (require.main === module) {
  start().catch((err) => {
    logger.error('startup failed', err);
    process.exit(1);
  });
}

module.exports = { start, shutdown };
