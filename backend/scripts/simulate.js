'use strict';

const mqtt = require('mqtt');
const config = require('../src/config');
const topics = require('../src/mqtt/topics');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
}

const intervalMs = Number(arg('interval', '5000'));
const scenario = arg('scenario', 'normal');
const nodeFilter = arg('nodes', '');

const NODES = [
  { node_id: 'NODE-001', gateway_id: 'GW-001', reference_mm: 2500, disp: 3.0, subs: 1.0, batt: 3.95, rssi: -92 },
  { node_id: 'NODE-002', gateway_id: 'GW-001', reference_mm: 1800, disp: 1.5, subs: 0.5, batt: 3.88, rssi: -97 },
  { node_id: 'NODE-003', gateway_id: 'GW-002', reference_mm: 3200, disp: 9.0, subs: 6.0, batt: 3.61, rssi: -104 },
  { node_id: 'NODE-004', gateway_id: 'GW-002', reference_mm: 2750, disp: 6.0, subs: 3.0, batt: 3.36, rssi: -110 }
].filter((n) => !nodeFilter || nodeFilter.split(',').includes(n.node_id));

const sequence = new Map(NODES.map((n) => [n.node_id, 1000 + Math.floor(Math.random() * 100)]));
const drift = new Map(NODES.map((n) => [n.node_id, 0]));

function jitter(base, spread) {
  return Number((base + (Math.random() - 0.5) * spread).toFixed(4));
}

function buildTelemetry(node) {
  const seq = sequence.get(node.node_id) + 1;
  sequence.set(node.node_id, seq);

  let extraDrift = drift.get(node.node_id);
  if (scenario === 'degrading' && node.node_id === 'NODE-003') {
    extraDrift += 0.8;
    drift.set(node.node_id, extraDrift);
  }

  const displacement = jitter(node.disp + extraDrift, 0.4);
  const subsidence = Math.max(0, jitter(node.subs + extraDrift * 0.9, 0.5));
  const distance = Number((node.reference_mm - subsidence).toFixed(2));
  const crack = scenario === 'crack' && node.node_id === 'NODE-003';
  const vibration = scenario === 'vibration' ? Math.random() < 0.7 : Math.random() < 0.08;

  return {
    node_id: node.node_id,
    gateway_id: node.gateway_id,
    timestamp: new Date().toISOString(),
    sequence_number: seq,
    sensors: {
      accel_x: jitter(0.12, 0.05),
      accel_y: jitter(0.04, 0.05),
      accel_z: jitter(9.81, vibration ? 1.6 : 0.06),
      gyro_x: jitter(0, 0.05),
      gyro_y: jitter(0, 0.05),
      gyro_z: jitter(0, 0.05),
      roll: jitter(1.2, 0.6),
      pitch: jitter(0.8, 0.6),
      vibration_detected: vibration,
      vibration_count: vibration ? Math.ceil(Math.random() * 6) : 0,
      vibration_duration_ms: vibration ? Math.ceil(Math.random() * 900) : 0,
      potentiometer_raw: Math.round(1800 + displacement * 20),
      potentiometer_voltage: Number(((1800 + displacement * 20) * 3.3 / 4095).toFixed(4)),
      relative_displacement_mm: displacement,
      crack_sensor_raw: crack ? 2100 : Math.round(Math.random() * 40),
      crack_sensor_voltage: crack ? 1.69 : 0.02,
      crack_detected: crack,
      ultrasonic_distance_mm: distance,
      ultrasonic_echo_time_us: Math.round(distance / 0.1715),
      reference_distance_mm: node.reference_mm,
      servo_target_angle: 45,
      servo_state: 'idle'
    },
    device: {
      firmware_version: '1.4.2',
      uptime_s: Math.round(process.uptime()),
      battery_voltage: jitter(node.batt, 0.02),
      supply_voltage: jitter(5.02, 0.05),
      reset_reason: 'POWERON',
      sensor_status: { imu: 'ok', vibration: 'ok', ultrasonic: 'ok', crack: 'ok' }
    },
    comm: {
      lora_rssi: jitter(node.rssi, 6),
      lora_snr: jitter(7.5, 3),
      packets_lost: Math.floor(Math.random() * 2)
    }
  };
}

const options = { clientId: `nirmaan-simulator-${Math.random().toString(16).slice(2, 8)}`, clean: true };
if (config.mqtt.username) options.username = config.mqtt.username;
if (config.mqtt.password) options.password = config.mqtt.password;

const client = mqtt.connect(config.mqtt.url, options);

client.on('connect', () => {
  process.stdout.write(`simulator connected to ${config.mqtt.url}\n`);
  process.stdout.write(`scenario=${scenario} interval=${intervalMs}ms nodes=${NODES.map((n) => n.node_id).join(',')}\n`);

  for (const node of NODES) {
    client.publish(topics.statusTopic(node.gateway_id, node.node_id), JSON.stringify({
      node_id: node.node_id,
      gateway_id: node.gateway_id,
      timestamp: new Date().toISOString(),
      status: 'online',
      firmware_version: '1.4.2',
      uptime_s: 0
    }), { qos: 1 });
  }

  setInterval(() => {
    for (const node of NODES) {
      const payload = buildTelemetry(node);
      client.publish(topics.telemetryTopic(node.gateway_id, node.node_id), JSON.stringify(payload), { qos: 1 });

      if (payload.sensors.crack_detected && Math.random() < 0.3) {
        client.publish(topics.eventsTopic(node.gateway_id, node.node_id), JSON.stringify({
          node_id: node.node_id,
          gateway_id: node.gateway_id,
          timestamp: new Date().toISOString(),
          event_type: 'crack_detected',
          severity: 'critical',
          message: 'Crack sensor circuit broken',
          details: { crack_sensor_raw: payload.sensors.crack_sensor_raw }
        }), { qos: 1 });
      }
    }
    process.stdout.write(`published ${NODES.length} telemetry messages at ${new Date().toISOString()}\n`);
  }, intervalMs);
});

client.on('error', (err) => {
  process.stderr.write(`simulator error: ${err.message}\n`);
});

process.on('SIGINT', () => {
  client.end(true, () => process.exit(0));
});
