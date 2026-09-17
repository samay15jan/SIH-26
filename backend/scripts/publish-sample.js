'use strict';

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const config = require('../src/config');
const topics = require('../src/mqtt/topics');

const file = process.argv[2] || 'telemetry.json';
const samplePath = path.isAbsolute(file) ? file : path.join(__dirname, '..', 'samples', file);
const payload = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

const gatewayId = payload.gateway_id || 'GW-001';
const nodeId = payload.node_id || 'NODE-001';

const topic = /event/i.test(file)
  ? topics.eventsTopic(gatewayId, nodeId)
  : /status/i.test(file)
    ? topics.statusTopic(gatewayId, nodeId)
    : topics.telemetryTopic(gatewayId, nodeId);

const options = { clientId: `nirmaan-publisher-${Math.random().toString(16).slice(2, 8)}` };
if (config.mqtt.username) options.username = config.mqtt.username;
if (config.mqtt.password) options.password = config.mqtt.password;

const client = mqtt.connect(config.mqtt.url, options);

client.on('connect', () => {
  if (payload.timestamp) payload.timestamp = new Date().toISOString();
  client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      process.stderr.write(`publish failed: ${err.message}\n`);
      process.exit(1);
    }
    process.stdout.write(`published ${samplePath} -> ${topic}\n`);
    client.end();
  });
});

client.on('error', (err) => {
  process.stderr.write(`mqtt error: ${err.message}\n`);
  process.exit(1);
});
