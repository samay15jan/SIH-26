'use strict';

const db = require('../db');
const mqttClient = require('../mqtt');
const hub = require('../websocket/hub');
const config = require('../config');

const nodes = require('./nodes');
const gateways = require('./gateways');
const telemetry = require('./telemetry');
const events = require('./events');
const alerts = require('./alerts');
const predictions = require('./predictions');
const analytics = require('./analytics');

const startedAt = Date.now();

async function healthRoutes(app) {
  app.get('/health', async (request, reply) => {
    let database = { ok: false };
    try {
      database = await db.healthcheck();
    } catch (err) {
      database = { ok: false, error: err.message };
    }

    const mqttStatus = mqttClient.status();
    const healthy = database.ok && (!config.mqtt.enabled || mqttStatus.connected);

    reply.code(healthy ? 200 : 503);
    return {
      status: healthy ? 'ok' : 'degraded',
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      version: require('../../package.json').version,
      time: new Date().toISOString(),
      database,
      mqtt: {
        enabled: mqttStatus.enabled,
        connected: mqttStatus.connected,
        url: mqttStatus.url,
        queue_depth: mqttStatus.queue_depth,
        ingest: mqttStatus.ingest
      },
      websocket: { clients: hub.stats().clients }
    };
  });

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/status/mqtt', async () => ({ data: mqttClient.status() }));

  app.get('/status/websocket', async () => ({ data: hub.stats() }));

  app.get('/sites', async () => {
    const data = await db.many(
      `SELECT s.*, count(z.id)::int AS zone_count FROM sites s
        LEFT JOIN zones z ON z.site_id = s.id
       GROUP BY s.id ORDER BY s.code`
    );
    return { count: data.length, data };
  });

  app.get('/zones', async (request) => {
    const params = [];
    let clause = '';
    if (request.query.site || request.query.siteId) {
      params.push(Number(request.query.site || request.query.siteId));
      clause = `WHERE z.site_id = $${params.length}`;
    }
    const data = await db.many(
      `SELECT z.*, s.code AS site_code, count(n.node_id)::int AS node_count
         FROM zones z
         JOIN sites s ON s.id = z.site_id
         LEFT JOIN nodes n ON n.zone_id = z.id
         ${clause}
        GROUP BY z.id, s.code ORDER BY s.code, z.code`,
      params
    );
    return { count: data.length, data };
  });
}

async function registerRoutes(app) {
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(nodes, { prefix: '/api' });
  await app.register(gateways, { prefix: '/api' });
  await app.register(telemetry, { prefix: '/api' });
  await app.register(events, { prefix: '/api' });
  await app.register(alerts, { prefix: '/api' });
  await app.register(predictions, { prefix: '/api' });
  await app.register(analytics, { prefix: '/api' });
}

module.exports = { registerRoutes };
