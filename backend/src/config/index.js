'use strict';

require('dotenv').config();

function str(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const config = {
  env: str('NODE_ENV', 'development'),
  port: num('PORT', 4000),
  host: str('HOST', '0.0.0.0'),
  logLevel: str('LOG_LEVEL', 'info'),
  corsOrigin: str('CORS_ORIGIN', '*'),

  db: {
    url: str('DATABASE_URL', 'postgres://nirmaan:nirmaan@localhost:5432/nirmaan'),
    poolMax: num('PG_POOL_MAX', 10),
    statementTimeoutMs: num('PG_STATEMENT_TIMEOUT_MS', 15000)
  },

  mqtt: {
    enabled: bool('MQTT_ENABLED', true),
    url: str('MQTT_URL', 'mqtt://mqtt.samay15jan.com:1883'),
    username: str('MQTT_USERNAME', undefined),
    password: str('MQTT_PASSWORD', undefined),
    clientId: `${str('MQTT_CLIENT_ID', 'nirmaan-backend')}-${Math.random().toString(16).slice(2, 8)}`,
    topicPrefix: str('MQTT_TOPIC_PREFIX', 'nirmaan'),
    qos: num('MQTT_QOS', 1),
    reconnectPeriodMs: num('MQTT_RECONNECT_PERIOD_MS', 5000),
    ingestConcurrency: num('MQTT_INGEST_CONCURRENCY', 8),
    ingestQueueMax: num('MQTT_INGEST_QUEUE_MAX', 5000)
  },

  liveness: {
    nodeOfflineAfterSeconds: num('NODE_OFFLINE_AFTER_SECONDS', 180),
    gatewayOfflineAfterSeconds: num('GATEWAY_OFFLINE_AFTER_SECONDS', 300),
    monitorIntervalSeconds: num('MONITOR_INTERVAL_SECONDS', 30)
  },

  telemetry: {
    maxLimit: num('TELEMETRY_MAX_LIMIT', 5000),
    futureSkewSeconds: num('TELEMETRY_FUTURE_SKEW_SECONDS', 300),
    partitionMonthsAhead: num('PARTITION_MONTHS_AHEAD', 1)
  },

  rules: {
    refreshSeconds: num('RULES_REFRESH_SECONDS', 60)
  }
};

module.exports = config;
