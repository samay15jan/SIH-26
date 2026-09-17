'use strict';

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const WebSocket = require('ws');

const BROKER = process.env.TEST_BROKER || 'mqtt://127.0.0.1:1883';
const WS_URL = process.env.TEST_WS || 'ws://127.0.0.1:4000/ws';
const sample = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', f), 'utf8'));

const received = [];

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    received.push(msg);
    if (msg.type !== 'welcome' && msg.type !== 'subscribed') {
      const d = msg.data || {};
      const label = d.node_id || d.gateway_id || d.alert_type || '';
      process.stdout.write(`  [WS] ${msg.type.padEnd(13)} ${String(label).padEnd(10)} ${
        msg.type === 'telemetry' ? `seq=${d.sequence_number} risk=${d.risk_score}/${d.risk_level} rules=[${(d.active_rules || []).join(',')}]`
          : msg.type === 'alert' ? `${d.severity} ${d.change}`
            : msg.type === 'event' ? `${d.event_type} ${d.severity}`
              : msg.type === 'node_status' ? `${d.status || ''} risk=${d.risk_score || '-'}` : ''
      }\n`);
    }
  });
  ws.send(JSON.stringify({ action: 'subscribe', channels: 'all', nodes: 'all' }));
  await wait(300);

  const client = mqtt.connect(BROKER, { clientId: `e2e-${Date.now()}` });
  await new Promise((resolve, reject) => {
    client.on('connect', resolve);
    client.on('error', reject);
  });

  const pub = (topic, payload) => new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos: 1 }, (e) => (e ? reject(e) : resolve()));
  });

  const stamp = (p) => ({ ...p, timestamp: new Date().toISOString() });

  process.stdout.write('\n1. normal telemetry (NODE-001)\n');
  const t1 = stamp(sample('telemetry.json'));
  t1.sequence_number = Date.now() % 100000;
  await pub('nirmaan/gateways/GW-001/nodes/NODE-001/telemetry', t1);
  await wait(1200);

  process.stdout.write('\n2. duplicate of the same sequence number (must be ignored)\n');
  await pub('nirmaan/gateways/GW-001/nodes/NODE-001/telemetry', t1);
  await wait(1200);

  process.stdout.write('\n3. critical telemetry (NODE-003: crack + displacement + low battery)\n');
  const t2 = stamp(sample('telemetry-critical.json'));
  t2.sequence_number = (Date.now() % 100000) + 7;
  await pub('nirmaan/gateways/GW-002/nodes/NODE-003/telemetry', t2);
  await wait(1800);

  process.stdout.write('\n4. minimal payload, mostly missing fields (NODE-002)\n');
  const t3 = stamp(sample('telemetry-minimal.json'));
  t3.sequence_number = (Date.now() % 100000) + 11;
  await pub('nirmaan/gateways/GW-001/nodes/NODE-002/telemetry', t3);
  await wait(1200);

  process.stdout.write('\n5. device event: sensor_failure (NODE-004)\n');
  await pub('nirmaan/gateways/GW-002/nodes/NODE-004/events', stamp(sample('event-sensor-failure.json')));
  await wait(1200);

  process.stdout.write('\n6. unknown node auto-registration (NODE-099)\n');
  await pub('nirmaan/gateways/GW-001/nodes/NODE-099/telemetry', stamp({
    node_id: 'NODE-099',
    gateway_id: 'GW-001',
    sequence_number: 1,
    sensors: { accel_z: 9.8, relative_displacement_mm: 1.2, battery_voltage: 4.0 }
  }));
  await wait(1200);

  process.stdout.write('\n7. malformed payloads (must not crash the pipeline)\n');
  await new Promise((r) => client.publish('nirmaan/gateways/GW-001/nodes/NODE-001/telemetry', 'not-json{{', { qos: 1 }, r));
  await new Promise((r) => client.publish('nirmaan/gateways/GW-001/nodes/NODE-001/telemetry', '{"nothing":"useful"}', { qos: 1 }, r));
  await new Promise((r) => client.publish('nirmaan/gateways/GW-001/nodes/NODE-XX/telemetry', JSON.stringify({ node_id: 'MISMATCH', sensors: { accel_z: 1 } }), { qos: 1 }, r));
  await wait(1500);

  const counts = received.reduce((acc, m) => ({ ...acc, [m.type]: (acc[m.type] || 0) + 1 }), {});
  process.stdout.write(`\nWebSocket messages received: ${JSON.stringify(counts)}\n`);

  client.end();
  ws.close();
}

main().catch((err) => {
  process.stderr.write(`e2e failed: ${err.message}\n`);
  process.exit(1);
});
