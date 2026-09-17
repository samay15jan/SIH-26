'use strict';

const mqtt = require('mqtt');
const config = require('../config');
const logger = require('../utils/logger');
const topics = require('./topics');
const parser = require('./parser');
const ingest = require('../services/ingest');
const db = require('../db');

const state = {
  client: null,
  connected: false,
  connectedAt: null,
  lastError: null,
  queueDepth: 0,
  inFlight: 0,
  dropped: 0
};

const queue = [];
const recentKeys = new Map();
const DEDUPE_TTL_MS = 120000;

function seenRecently(key) {
  if (!key) return false;
  const now = Date.now();
  if (recentKeys.size > 5000) {
    for (const [k, t] of recentKeys) {
      if (now - t > DEDUPE_TTL_MS) recentKeys.delete(k);
    }
  }
  const at = recentKeys.get(key);
  if (at && now - at < DEDUPE_TTL_MS) return true;
  recentKeys.set(key, now);
  return false;
}

async function handleMessage(topic, payload) {
  const info = topics.parseTopic(topic);
  if (!info) {
    ingest.recordInvalid('unknown topic', { topic });
    return;
  }

  try {
    if (info.kind === 'telemetry') {
      const parsed = parser.parseTelemetry(payload, info);
      if (parsed.sequence_number !== null && seenRecently(`${parsed.node_id}:${parsed.sequence_number}`)) {
        ingest.stats.telemetry_duplicates += 1;
        return;
      }
      await ingest.ingestTelemetry(parsed);
    } else if (info.kind === 'event') {
      await ingest.ingestEvent(parser.parseEvent(payload, info));
    } else {
      await ingest.ingestStatus(parser.parseStatus(payload, info));
    }
  } catch (err) {
    if (err instanceof parser.ParseError) {
      ingest.recordInvalid(err.message, { topic, ...(err.details || {}) });
    } else {
      ingest.recordError(err, { topic });
    }
  }
}

function drain() {
  while (state.inFlight < config.mqtt.ingestConcurrency && queue.length) {
    const job = queue.shift();
    state.queueDepth = queue.length;
    state.inFlight += 1;
    handleMessage(job.topic, job.payload)
      .catch((err) => ingest.recordError(err, { topic: job.topic }))
      .finally(() => {
        state.inFlight -= 1;
        if (queue.length) setImmediate(drain);
      });
  }
}

function enqueue(topic, payload) {
  if (queue.length >= config.mqtt.ingestQueueMax) {
    state.dropped += 1;
    if (state.dropped % 100 === 1) logger.warn('ingest queue full, dropping message', { dropped: state.dropped });
    return;
  }
  queue.push({ topic, payload });
  state.queueDepth = queue.length;
  drain();
}

async function start() {
  if (!config.mqtt.enabled) {
    logger.warn('MQTT disabled by configuration (MQTT_ENABLED=false)');
    return null;
  }

  const options = {
    clientId: config.mqtt.clientId,
    clean: true,
    reconnectPeriod: config.mqtt.reconnectPeriodMs,
    connectTimeout: 15000,
    resubscribe: true
  };
  if (config.mqtt.username) options.username = config.mqtt.username;
  if (config.mqtt.password) options.password = config.mqtt.password;

  logger.info('connecting to MQTT broker', { url: config.mqtt.url, clientId: config.mqtt.clientId });
  const client = mqtt.connect(config.mqtt.url, options);
  state.client = client;

  client.on('connect', () => {
    state.connected = true;
    state.connectedAt = new Date().toISOString();
    state.lastError = null;
    logger.info('MQTT connected', { url: config.mqtt.url });
    client.subscribe(topics.SUBSCRIPTIONS, { qos: config.mqtt.qos }, (err, granted) => {
      if (err) {
        logger.error('MQTT subscribe failed', err);
        return;
      }
      logger.info('MQTT subscribed', { topics: granted.map((g) => g.topic) });
    });
    db.query(
      `INSERT INTO system_events (level, category, message, details) VALUES ('info','mqtt','MQTT connected', $1::jsonb)`,
      [JSON.stringify({ url: config.mqtt.url, client_id: config.mqtt.clientId })]
    ).catch(() => {});
  });

  client.on('message', (topic, payload) => enqueue(topic, payload));

  client.on('reconnect', () => logger.info('MQTT reconnecting'));

  client.on('close', () => {
    if (state.connected) logger.warn('MQTT connection closed');
    state.connected = false;
  });

  client.on('error', (err) => {
    state.lastError = err.message;
    logger.error('MQTT error', err);
  });

  return client;
}

async function stop() {
  if (!state.client) return;
  await new Promise((resolve) => state.client.end(false, {}, resolve));
  state.connected = false;
}

function publish(topic, payload, options = {}) {
  if (!state.client) throw new Error('MQTT client not started');
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    state.client.publish(topic, body, { qos: config.mqtt.qos, ...options }, (err) => (err ? reject(err) : resolve()));
  });
}

function status() {
  return {
    enabled: config.mqtt.enabled,
    connected: state.connected,
    url: config.mqtt.url,
    client_id: config.mqtt.clientId,
    connected_at: state.connectedAt,
    last_error: state.lastError,
    subscriptions: topics.SUBSCRIPTIONS,
    queue_depth: state.queueDepth,
    in_flight: state.inFlight,
    dropped: state.dropped,
    ingest: ingest.stats
  };
}

module.exports = { start, stop, publish, status, handleMessage, state };
