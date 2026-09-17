'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../src/db');
const { buildApp } = require('../src/app');
const hub = require('../src/websocket/hub');
const ingest = require('../src/services/ingest');
const nodesService = require('../src/services/nodes');
const eventsService = require('../src/services/events');
const alertsService = require('../src/services/alerts');
const telemetryService = require('../src/services/telemetry');
const predictionsService = require('../src/services/predictions');
const rules = require('../src/rules/engine');

const TEST_NODE = 'TEST-NODE-01';
const TEST_GATEWAY = 'TEST-GW-01';

let app;
let dbReady = false;

test.before(async () => {
  try {
    await db.healthcheck();
    await db.ensurePartitionsAround();
    dbReady = true;
  } catch (err) {
    process.stderr.write(`\nSKIPPING integration tests - database unavailable: ${err.message}\n`);
    return;
  }

  await db.query('DELETE FROM telemetry WHERE node_id = $1', [TEST_NODE]);
  await db.query('DELETE FROM nodes WHERE node_id = $1', [TEST_NODE]);
  await db.query('DELETE FROM gateways WHERE gateway_id = $1', [TEST_GATEWAY]);
  await rules.load(true);
  app = await buildApp();
  await app.ready();
});

test.after(async () => {
  if (!dbReady) return;
  await db.query('DELETE FROM telemetry WHERE node_id = $1', [TEST_NODE]);
  await db.query('DELETE FROM alerts WHERE node_id = $1', [TEST_NODE]);
  await db.query('DELETE FROM events WHERE node_id = $1', [TEST_NODE]);
  await db.query('DELETE FROM predictions WHERE node_id = $1', [TEST_NODE]);
  await db.query('DELETE FROM node_state WHERE node_id = $1', [TEST_NODE]);
  await db.query('DELETE FROM nodes WHERE node_id = $1', [TEST_NODE]);
  await db.query('DELETE FROM gateways WHERE gateway_id = $1', [TEST_GATEWAY]);
  if (app) await app.close();
  await db.close();
});

test('database connection and schema', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  await t.test('connects', async () => {
    const health = await db.healthcheck();
    assert.strictEqual(health.ok, true);
  });

  await t.test('has every expected table', async () => {
    const rows = await db.many(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = rows.map((r) => r.table_name);
    for (const expected of ['sites', 'zones', 'gateways', 'nodes', 'node_sensors', 'telemetry',
      'node_state', 'events', 'anomalies', 'predictions', 'risk_assessments', 'alerts',
      'alert_history', 'alert_rules', 'system_events']) {
      assert.ok(names.includes(expected), `missing table ${expected}`);
    }
  });

  await t.test('telemetry is partitioned by month', async () => {
    const parts = await db.many(
      `SELECT c.relname FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'telemetry'`
    );
    assert.ok(parts.length >= 2, 'expected at least two monthly partitions');
    assert.ok(parts.every((p) => /^telemetry_\d{4}_\d{2}$/.test(p.relname)));
  });
});

test('API health', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  await t.test('GET /api/health reports database status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = res.json();
    assert.ok([200, 503].includes(res.statusCode));
    assert.strictEqual(body.database.ok, true);
    assert.ok(body.uptime_s >= 0);
    assert.ok(body.version);
  });

  await t.test('unknown routes return a 404 envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.json().error, 'not_found');
  });
});

test('node creation and update', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  await t.test('auto-registers an unknown node', async () => {
    const node = await nodesService.ensureExists(TEST_NODE, { gatewayId: null, seenAt: new Date() });
    assert.strictEqual(node.node_id, TEST_NODE);
    assert.strictEqual(node.created, true);
    assert.strictEqual(node.metadata.auto_registered, true);
  });

  await t.test('is idempotent on repeat', async () => {
    const node = await nodesService.ensureExists(TEST_NODE, {});
    assert.strictEqual(node.created, false);
  });

  await t.test('updates last_seen and status', async () => {
    const when = new Date();
    await nodesService.markSeen(TEST_NODE, { seenAt: when, sequenceNumber: 77 });
    const node = await nodesService.getRaw(TEST_NODE);
    assert.strictEqual(node.status, 'online');
    assert.strictEqual(node.last_sequence_number, 77);
  });

  await t.test('patches editable fields', async () => {
    const node = await nodesService.update(TEST_NODE, { name: 'Integration Test Node', reference_distance_mm: 2000 });
    assert.strictEqual(node.name, 'Integration Test Node');
    assert.strictEqual(Number(node.reference_distance_mm), 2000);
  });
});

test('telemetry ingestion', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  const baseSeq = Math.floor(Math.random() * 100000);

  await t.test('stores a full MQTT reading end to end', async () => {
    const result = await ingest.ingestTelemetry({
      node_id: TEST_NODE,
      gateway_id: TEST_GATEWAY,
      measured_at: new Date(),
      sequence_number: baseSeq,
      values: { accel_z: 9.81, ultrasonic_distance_mm: 1995, battery_voltage: 3.9, relative_displacement_mm: 2.0 },
      raw_payload: { test: true }
    });

    assert.strictEqual(result.stored, true);
    const row = await telemetryService.latestForNode(TEST_NODE);
    assert.strictEqual(row.sequence_number, baseSeq);
    assert.strictEqual(row.subsidence_mm, 5);
    assert.deepStrictEqual(row.raw_payload, { test: true });
  });

  await t.test('creates the gateway referenced by the reading', async () => {
    const gw = await db.one('SELECT * FROM gateways WHERE gateway_id = $1', [TEST_GATEWAY]);
    assert.ok(gw);
    assert.strictEqual(gw.status, 'online');
  });

  await t.test('rejects a duplicate sequence number', async () => {
    const measured = new Date();
    const first = await ingest.ingestTelemetry({
      node_id: TEST_NODE, gateway_id: TEST_GATEWAY, measured_at: measured,
      sequence_number: baseSeq + 1, values: { accel_z: 9.8 }, raw_payload: {}
    });
    const second = await ingest.ingestTelemetry({
      node_id: TEST_NODE, gateway_id: TEST_GATEWAY, measured_at: measured,
      sequence_number: baseSeq + 1, values: { accel_z: 9.8 }, raw_payload: {}
    });
    assert.strictEqual(first.stored, true);
    assert.strictEqual(second.stored, false);
    assert.strictEqual(second.duplicate, true);
  });

  await t.test('stores readings with mostly missing fields', async () => {
    const result = await ingest.ingestTelemetry({
      node_id: TEST_NODE, gateway_id: TEST_GATEWAY, measured_at: new Date(),
      sequence_number: baseSeq + 2, values: { battery_voltage: 3.9 }, raw_payload: {}
    });
    assert.strictEqual(result.stored, true);
    const row = await telemetryService.latestForNode(TEST_NODE);
    assert.strictEqual(row.accel_z, null);
    assert.strictEqual(row.crack_detected, null);
  });

  await t.test('updates the node_state snapshot', async () => {
    const state = await db.one('SELECT * FROM node_state WHERE node_id = $1', [TEST_NODE]);
    assert.ok(state);
    assert.ok(state.telemetry.battery_voltage);
  });
});

test('historical telemetry retrieval', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  await t.test('returns rows newest first', async () => {
    const rows = await telemetryService.history({ nodeId: TEST_NODE, limit: 10 });
    assert.ok(rows.length >= 3);
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(new Date(rows[i - 1].measured_at) >= new Date(rows[i].measured_at));
    }
  });

  await t.test('filters by time range', async () => {
    const future = await telemetryService.history({ nodeId: TEST_NODE, start: new Date(Date.now() + 60000) });
    assert.strictEqual(future.length, 0);
    const past = await telemetryService.history({ nodeId: TEST_NODE, start: new Date(Date.now() - 3600000) });
    assert.ok(past.length >= 3);
  });

  await t.test('serves history over the REST API', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/nodes/${TEST_NODE}/telemetry?limit=2` });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json().data.length, 2);
  });

  await t.test('exports CSV for the AI team', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/telemetry/history?node=${TEST_NODE}&format=csv&limit=5` });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('text/csv'));
    assert.ok(res.body.split('\n')[0].startsWith('node_id,gateway_id,measured_at'));
  });

  await t.test('aggregates a summary', async () => {
    const summary = await telemetryService.summary({ nodeId: TEST_NODE, metrics: ['battery_voltage'] });
    assert.ok(summary.samples >= 3);
    assert.ok(summary.metrics.battery_voltage.avg > 0);
  });

  await t.test('404s for an unknown node', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nodes/DOES-NOT-EXIST/telemetry' });
    assert.strictEqual(res.statusCode, 404);
  });
});

test('event insertion', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  await t.test('inserts a device event', async () => {
    const event = await eventsService.create({
      node_id: TEST_NODE,
      gateway_id: TEST_GATEWAY,
      event_type: 'manual_test',
      severity: 'info',
      source: 'manual',
      message: 'integration test event',
      details: { origin: 'test' }
    });
    assert.ok(event.id);
    assert.strictEqual(event.event_type, 'manual_test');
    assert.strictEqual(event.details.origin, 'test');
  });

  await t.test('lists events through the API', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/nodes/${TEST_NODE}/events` });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.json().data.some((e) => e.event_type === 'manual_test'));
  });

  await t.test('handles a sensor_failure event and raises an alert', async () => {
    await ingest.ingestEvent({
      node_id: TEST_NODE,
      gateway_id: TEST_GATEWAY,
      event_type: 'sensor_failure',
      severity: 'warning',
      occurred_at: new Date(),
      message: 'ultrasonic dead',
      details: { sensor: 'ultrasonic' }
    });

    const sensor = await db.one(
      'SELECT * FROM node_sensors WHERE node_id = $1 AND sensor_type = $2',
      [TEST_NODE, 'ultrasonic']
    );
    assert.strictEqual(sensor.status, 'failed');

    const alerts = await alertsService.list({ nodeId: TEST_NODE, alertType: 'sensor_failure' });
    assert.strictEqual(alerts.length, 1);
  });
});

test('alert lifecycle', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  let alertId;

  await t.test('raises an alert', async () => {
    const { alert, created } = await alertsService.raise({
      node_id: TEST_NODE,
      gateway_id: TEST_GATEWAY,
      alert_type: 'test_alert',
      severity: 'warning',
      message: 'integration test alert',
      risk_score: 30,
      source: 'rule',
      rule_key: 'test_rule'
    });
    alertId = alert.id;
    assert.strictEqual(created, true);
    assert.strictEqual(alert.status, 'active');
    assert.strictEqual(alert.occurrence_count, 1);
  });

  await t.test('deduplicates a repeat instead of creating a second row', async () => {
    const { alert, created } = await alertsService.raise({
      node_id: TEST_NODE,
      alert_type: 'test_alert',
      severity: 'warning',
      message: 'integration test alert again'
    });
    assert.strictEqual(created, false);
    assert.strictEqual(alert.id, alertId);
    assert.strictEqual(alert.occurrence_count, 2);
  });

  await t.test('escalates severity on repeat', async () => {
    const { alert } = await alertsService.raise({
      node_id: TEST_NODE,
      alert_type: 'test_alert',
      severity: 'critical',
      message: 'now critical'
    });
    assert.strictEqual(alert.severity, 'critical');
  });

  await t.test('acknowledges through PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/alerts/${alertId}`,
      payload: { status: 'acknowledged', by: 'test.operator', note: 'looking into it' }
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json().data.status, 'acknowledged');
    assert.strictEqual(res.json().data.acknowledged_by, 'test.operator');
  });

  await t.test('resolves and records history', async () => {
    await app.inject({ method: 'PATCH', url: `/api/alerts/${alertId}`, payload: { status: 'resolved' } });
    const res = await app.inject({ method: 'GET', url: `/api/alerts/${alertId}` });
    const alert = res.json().data;
    assert.strictEqual(alert.status, 'resolved');
    assert.deepStrictEqual(
      alert.history.map((h) => h.to_status),
      ['active', 'acknowledged', 'resolved']
    );
  });

  await t.test('rejects an invalid status', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/alerts/${alertId}`, payload: { status: 'nope' } });
    assert.strictEqual(res.statusCode, 400);
  });

  await t.test('allows a new alert of the same type once resolved', async () => {
    const { created } = await alertsService.raise({
      node_id: TEST_NODE, alert_type: 'test_alert', severity: 'info', message: 'reopened'
    });
    assert.strictEqual(created, true);
    await alertsService.resolveByType(TEST_NODE, 'test_alert', { note: 'cleanup' });
  });
});

test('rule engine', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  await t.test('fires threshold rules and scores risk', async () => {
    const result = await rules.evaluateTelemetry(TEST_NODE, {
      crack_detected: true,
      relative_displacement_mm: 40,
      battery_voltage: 3.1
    });
    const keys = result.triggered.map((r) => r.rule_key);
    assert.ok(keys.includes('crack_detected'));
    assert.ok(keys.includes('displacement_high'));
    assert.ok(keys.includes('battery_critical'));
    assert.ok(result.risk.score > 50);
    assert.ok(['high', 'severe'].includes(result.risk.level));
  });

  await t.test('stays quiet for healthy telemetry', async () => {
    const result = await rules.evaluateTelemetry(TEST_NODE, {
      crack_detected: false,
      crack_sensor_raw: 0,
      relative_displacement_mm: 2,
      subsidence_mm: 1,
      battery_voltage: 3.95,
      lora_rssi: -90,
      vibration_detected: false,
      tilt_deg: 1.1
    });
    assert.deepStrictEqual(result.triggered.map((r) => r.rule_key), []);
    assert.strictEqual(result.risk.score, 0);
    assert.strictEqual(result.risk.level, 'low');
  });

  await t.test('only evaluates the liveness rules it is asked for', async () => {
    const triggered = await rules.evaluateLiveness(TEST_NODE, 99999, ['node_offline']);
    assert.strictEqual(triggered.length, 1);
    assert.strictEqual(triggered[0].rule_key, 'node_offline');
  });
});

test('AI integration boundary', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  await t.test('stores a model prediction', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/predictions',
      payload: {
        node_id: TEST_NODE,
        model_name: 'test-model',
        model_version: 'v0.1',
        prediction_type: 'subsidence_forecast',
        predicted_value: 12.5,
        confidence: 0.82,
        risk_score: 40,
        severity: 'info',
        features: { window_hours: 72 }
      }
    });
    assert.strictEqual(res.statusCode, 201);
    const p = res.json().data;
    assert.strictEqual(p.model_name, 'test-model');
    assert.strictEqual(Number(p.confidence), 0.82);
  });

  await t.test('raises an alert for a severe prediction', async () => {
    await predictionsService.create({
      node_id: TEST_NODE,
      model_name: 'test-model',
      model_version: 'v0.1',
      prediction_type: 'structural_risk',
      predicted_label: 'high_risk',
      confidence: 0.9,
      risk_score: 85,
      severity: 'critical'
    });
    const alerts = await alertsService.list({ nodeId: TEST_NODE, alertType: 'ai_structural_risk' });
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].source, 'prediction');
    await alertsService.resolveByType(TEST_NODE, 'ai_structural_risk', { note: 'cleanup' });
  });

  await t.test('stores an anomaly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/anomalies',
      payload: {
        node_id: TEST_NODE,
        anomaly_type: 'point_anomaly',
        metric: 'subsidence_mm',
        observed_value: 30,
        expected_value: 5,
        score: 3.2,
        severity: 'info',
        method: 'model',
        raise_alert: false
      }
    });
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.json().data.anomaly_type, 'point_anomaly');
  });

  await t.test('rejects a prediction without a model name', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/predictions', payload: { node_id: TEST_NODE } });
    assert.strictEqual(res.statusCode, 400);
  });
});

test('analytics endpoints', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  await t.test('overview returns counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/overview' });
    const data = res.json().data;
    assert.ok(data.nodes.total > 0);
    assert.ok(typeof data.alerts.active === 'number');
    assert.ok(Array.isArray(data.sites));
  });

  await t.test('node health lists our test node', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/nodes/health' });
    assert.ok(res.json().data.some((n) => n.node_id === TEST_NODE));
  });

  await t.test('sensor status aggregates by type', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/sensors/status' });
    assert.ok(Array.isArray(res.json().data.by_sensor));
  });
});

test('websocket broadcasting', async (t) => {
  if (!dbReady) return t.skip('database unavailable');
  await t.test('delivers messages to subscribed clients', async () => {
    const sent = [];
    const fake = { readyState: 1, send: (m) => sent.push(JSON.parse(m)) };
    const client = hub.register(fake);

    const delivered = hub.broadcast('telemetry', { node_id: TEST_NODE, value: 1 });
    assert.ok(delivered >= 1);
    assert.strictEqual(sent[0].type, 'telemetry');
    assert.strictEqual(sent[0].data.node_id, TEST_NODE);
    assert.ok(sent[0].ts);

    hub.unregister(client);
  });

  await t.test('respects channel filters', async () => {
    const sent = [];
    const client = hub.register({ readyState: 1, send: (m) => sent.push(JSON.parse(m)) });
    hub.applySubscription(client, { channels: ['alert'] });

    hub.broadcast('telemetry', { node_id: TEST_NODE });
    hub.broadcast('alert', { node_id: TEST_NODE, alert_type: 'x' });

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].type, 'alert');
    hub.unregister(client);
  });

  await t.test('respects node filters', async () => {
    const sent = [];
    const client = hub.register({ readyState: 1, send: (m) => sent.push(JSON.parse(m)) });
    hub.applySubscription(client, { nodes: ['OTHER-NODE'] });

    hub.broadcast('telemetry', { node_id: TEST_NODE });
    hub.broadcast('telemetry', { node_id: 'OTHER-NODE' });

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].data.node_id, 'OTHER-NODE');
    hub.unregister(client);
  });

  await t.test('broadcasts telemetry as part of ingestion', async () => {
    const sent = [];
    const client = hub.register({ readyState: 1, send: (m) => sent.push(JSON.parse(m)) });

    await ingest.ingestTelemetry({
      node_id: TEST_NODE,
      gateway_id: TEST_GATEWAY,
      measured_at: new Date(),
      sequence_number: Math.floor(Math.random() * 100000) + 500000,
      values: { accel_z: 9.8, battery_voltage: 3.95 },
      raw_payload: {}
    });

    const telemetryMsg = sent.find((m) => m.type === 'telemetry');
    assert.ok(telemetryMsg, 'expected a telemetry broadcast');
    assert.strictEqual(telemetryMsg.data.node_id, TEST_NODE);
    assert.ok(telemetryMsg.data.values);
    hub.unregister(client);
  });

  await t.test('drops clients whose socket is closed', () => {
    const client = hub.register({ readyState: 3, send: () => { throw new Error('closed'); } });
    assert.doesNotThrow(() => hub.broadcast('telemetry', { node_id: TEST_NODE }));
    hub.unregister(client);
  });
});
