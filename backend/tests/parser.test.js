'use strict';

const test = require('node:test');
const assert = require('node:assert');

const parser = require('../src/mqtt/parser');
const topics = require('../src/mqtt/topics');
const telemetryService = require('../src/services/telemetry');

const TOPIC_INFO = { kind: 'telemetry', gatewayId: 'GW-001', nodeId: 'NODE-001' };

test('topic parsing', async (t) => {
  await t.test('parses a node telemetry topic', () => {
    assert.deepStrictEqual(
      topics.parseTopic('nirmaan/gateways/GW-001/nodes/NODE-001/telemetry'),
      { kind: 'telemetry', gatewayId: 'GW-001', nodeId: 'NODE-001' }
    );
  });

  await t.test('parses status and event topics', () => {
    assert.strictEqual(topics.parseTopic('nirmaan/gateways/GW-1/nodes/N-1/status').kind, 'node_status');
    assert.strictEqual(topics.parseTopic('nirmaan/gateways/GW-1/nodes/N-1/events').kind, 'event');
    assert.strictEqual(topics.parseTopic('nirmaan/gateways/GW-1/status').kind, 'gateway_status');
  });

  await t.test('rejects foreign or malformed topics', () => {
    assert.strictEqual(topics.parseTopic('other/gateways/GW-1/nodes/N-1/telemetry'), null);
    assert.strictEqual(topics.parseTopic('nirmaan/gateways'), null);
    assert.strictEqual(topics.parseTopic('nirmaan/gateways/GW-1/nodes/N-1/unknown'), null);
  });

  await t.test('builds topics that round-trip', () => {
    const topic = topics.telemetryTopic('GW-9', 'NODE-9');
    assert.deepStrictEqual(topics.parseTopic(topic), { kind: 'telemetry', gatewayId: 'GW-9', nodeId: 'NODE-9' });
  });
});

test('telemetry payload parsing', async (t) => {
  await t.test('parses the documented payload shape', () => {
    const payload = {
      node_id: 'NODE-001',
      gateway_id: 'GW-001',
      timestamp: '2026-09-16T10:30:00Z',
      sequence_number: 1001,
      sensors: { accel_x: 0.12, accel_z: 9.81, crack_detected: false, ultrasonic_distance_mm: 2495.3 },
      device: { battery_voltage: 3.92, firmware_version: '1.4.2' },
      comm: { lora_rssi: -92, lora_snr: 7.5 }
    };
    const parsed = parser.parseTelemetry(JSON.stringify(payload), TOPIC_INFO);

    assert.strictEqual(parsed.node_id, 'NODE-001');
    assert.strictEqual(parsed.gateway_id, 'GW-001');
    assert.strictEqual(parsed.sequence_number, 1001);
    assert.strictEqual(parsed.values.accel_x, 0.12);
    assert.strictEqual(parsed.values.battery_voltage, 3.92);
    assert.strictEqual(parsed.values.lora_rssi, -92);
    assert.strictEqual(parsed.values.crack_detected, false);
    assert.strictEqual(parsed.measured_at.toISOString(), '2026-09-16T10:30:00.000Z');
    assert.deepStrictEqual(parsed.raw_payload, payload);
  });

  await t.test('accepts flat payloads and field aliases', () => {
    const parsed = parser.parseTelemetry(JSON.stringify({
      nodeId: 'NODE-001', ax: 0.1, az: 9.8, vbat: 3.7, rssi: -100, seq: 42
    }), TOPIC_INFO);

    assert.strictEqual(parsed.values.accel_x, 0.1);
    assert.strictEqual(parsed.values.battery_voltage, 3.7);
    assert.strictEqual(parsed.values.lora_rssi, -100);
    assert.strictEqual(parsed.sequence_number, 42);
  });

  await t.test('coerces string and numeric booleans', () => {
    const parsed = parser.parseTelemetry(JSON.stringify({
      node_id: 'NODE-001', sensors: { crack_detected: 'true', vibration_detected: 1, accel_z: '9.79' }
    }), TOPIC_INFO);

    assert.strictEqual(parsed.values.crack_detected, true);
    assert.strictEqual(parsed.values.vibration_detected, true);
    assert.strictEqual(parsed.values.accel_z, 9.79);
  });

  await t.test('ignores unknown fields but keeps them in raw_payload', () => {
    const parsed = parser.parseTelemetry(JSON.stringify({
      node_id: 'NODE-001', sensors: { accel_z: 9.8, methane_ppm: 21 }
    }), TOPIC_INFO);

    assert.strictEqual(parsed.values.methane_ppm, undefined);
    assert.strictEqual(parsed.raw_payload.sensors.methane_ppm, 21);
  });

  await t.test('falls back to the topic node id when the payload omits it', () => {
    const parsed = parser.parseTelemetry(JSON.stringify({ sensors: { accel_z: 9.8 } }), TOPIC_INFO);
    assert.strictEqual(parsed.node_id, 'NODE-001');
  });

  await t.test('rejects malformed, empty and mismatched payloads', () => {
    assert.throws(() => parser.parseTelemetry('not json', TOPIC_INFO), parser.ParseError);
    assert.throws(() => parser.parseTelemetry('', TOPIC_INFO), parser.ParseError);
    assert.throws(() => parser.parseTelemetry('[1,2,3]', TOPIC_INFO), parser.ParseError);
    assert.throws(() => parser.parseTelemetry(JSON.stringify({ nothing: 'useful' }), TOPIC_INFO), parser.ParseError);
    assert.throws(
      () => parser.parseTelemetry(JSON.stringify({ node_id: 'OTHER', sensors: { accel_z: 1 } }), TOPIC_INFO),
      parser.ParseError
    );
  });

  await t.test('clamps timestamps that are far in the future', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const parsed = parser.parseTelemetry(
      JSON.stringify({ node_id: 'NODE-001', timestamp: future, sensors: { accel_z: 9.8 } }),
      TOPIC_INFO
    );
    assert.ok(parsed.measured_at.getTime() <= Date.now() + 1000);
  });

  await t.test('accepts unix epoch timestamps', () => {
    const parsed = parser.parseTelemetry(
      JSON.stringify({ node_id: 'NODE-001', timestamp: 1789000000, sensors: { accel_z: 9.8 } }),
      TOPIC_INFO
    );
    assert.strictEqual(parsed.measured_at.getTime(), 1789000000000);
  });
});

test('event and status parsing', async (t) => {
  await t.test('parses a device event', () => {
    const parsed = parser.parseEvent(JSON.stringify({
      node_id: 'NODE-004',
      gateway_id: 'GW-002',
      event_type: 'sensor_failure',
      severity: 'warning',
      details: { sensor: 'ultrasonic' }
    }), { kind: 'event', gatewayId: 'GW-002', nodeId: 'NODE-004' });

    assert.strictEqual(parsed.event_type, 'sensor_failure');
    assert.strictEqual(parsed.severity, 'warning');
    assert.strictEqual(parsed.details.sensor, 'ultrasonic');
  });

  await t.test('defaults unknown severity to info and requires event_type', () => {
    const info = { kind: 'event', gatewayId: 'GW-1', nodeId: 'NODE-1' };
    const parsed = parser.parseEvent(JSON.stringify({ event_type: 'manual_test', severity: 'bogus' }), info);
    assert.strictEqual(parsed.severity, 'info');
    assert.throws(() => parser.parseEvent(JSON.stringify({ message: 'hi' }), info), parser.ParseError);
  });

  await t.test('parses node and gateway status payloads', () => {
    const node = parser.parseStatus(JSON.stringify({ status: 'offline', uptime_s: 90 }),
      { kind: 'node_status', gatewayId: 'GW-1', nodeId: 'NODE-1' });
    assert.strictEqual(node.node_id, 'NODE-1');
    assert.strictEqual(node.status, 'offline');
    assert.strictEqual(node.uptime_s, 90);

    const gw = parser.parseStatus(JSON.stringify({ status: 'online' }),
      { kind: 'gateway_status', gatewayId: 'GW-1', nodeId: null });
    assert.strictEqual(gw.node_id, null);
    assert.strictEqual(gw.gateway_id, 'GW-1');
  });
});

test('derived metrics', async (t) => {
  await t.test('derives subsidence from the node reference distance', () => {
    const out = telemetryService.deriveMetrics(
      { ultrasonic_distance_mm: 2495.3 },
      { reference_distance_mm: 2500 },
      null
    );
    assert.strictEqual(out.reference_distance_mm, 2500);
    assert.strictEqual(out.displacement_mm, 4.7);
    assert.strictEqual(out.subsidence_mm, 4.7);
  });

  await t.test('never reports negative subsidence', () => {
    const out = telemetryService.deriveMetrics(
      { ultrasonic_distance_mm: 2510 },
      { reference_distance_mm: 2500 },
      null
    );
    assert.strictEqual(out.subsidence_mm, 0);
    assert.strictEqual(out.displacement_mm, -10);
  });

  await t.test('computes the subsidence rate against the previous state', () => {
    const now = new Date();
    const out = telemetryService.deriveMetrics(
      { ultrasonic_distance_mm: 2490, measured_at: now },
      { reference_distance_mm: 2500 },
      { measured_at: new Date(now.getTime() - 86400000), subsidence_mm: '4' }
    );
    assert.strictEqual(out.subsidence_mm, 10);
    assert.strictEqual(out.subsidence_rate_mm_per_day, 6);
  });

  await t.test('derives tilt and battery percentage', () => {
    const out = telemetryService.deriveMetrics({ roll: -12.5, pitch: 3, battery_voltage: 3.6 }, {}, null);
    assert.strictEqual(out.tilt_deg, 12.5);
    assert.strictEqual(out.battery_percentage, 50);
  });

  await t.test('does not overwrite values supplied by the gateway', () => {
    const out = telemetryService.deriveMetrics(
      { ultrasonic_distance_mm: 2495.3, subsidence_mm: 99 },
      { reference_distance_mm: 2500 },
      null
    );
    assert.strictEqual(out.subsidence_mm, 99);
  });
});

test('insert statement builder', async (t) => {
  await t.test('only includes fields that are present', () => {
    const { text, values } = telemetryService.buildInsert({
      node_id: 'NODE-001',
      gateway_id: 'GW-001',
      measured_at: new Date('2026-09-17T10:30:00Z'),
      sequence_number: 5,
      values: { accel_z: 9.81, crack_detected: false },
      raw_payload: { a: 1 }
    });

    const columnList = text.slice(text.indexOf('(') + 1, text.indexOf(')'));
    assert.ok(columnList.includes('accel_z'));
    assert.ok(columnList.includes('crack_detected'));
    assert.ok(!columnList.includes('gyro_x'));
    assert.ok(text.includes('ON CONFLICT DO NOTHING'));
    assert.strictEqual(values[0], 'NODE-001');
    assert.ok(values.includes(9.81));
    assert.ok(values.includes(false));
  });
});
