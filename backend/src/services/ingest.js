'use strict';

const nodesService = require('./nodes');
const gatewaysService = require('./gateways');
const telemetryService = require('./telemetry');
const eventsService = require('./events');
const alertsService = require('./alerts');
const rules = require('../rules/engine');
const hub = require('../websocket/hub');
const logger = require('../utils/logger');
const { isPlainObject } = require('../utils/helpers');

const NODE_CACHE_TTL_MS = 60000;
const nodeCache = new Map();

const stats = {
  telemetry_received: 0,
  telemetry_stored: 0,
  telemetry_duplicates: 0,
  events_received: 0,
  status_received: 0,
  invalid_messages: 0,
  errors: 0,
  last_message_at: null
};

async function getNode(nodeId, gatewayId, firmwareVersion, seenAt) {
  const cached = nodeCache.get(nodeId);
  if (cached && Date.now() - cached.at < NODE_CACHE_TTL_MS) return cached.node;

  const node = await nodesService.ensureExists(nodeId, { gatewayId, firmwareVersion, seenAt });
  if (node && node.created) {
    await eventsService.create({
      node_id: nodeId,
      gateway_id: gatewayId,
      event_type: 'node_registered',
      severity: 'info',
      source: 'backend',
      message: `Node ${nodeId} auto-registered from MQTT traffic`,
      details: { gateway_id: gatewayId }
    });
  }
  nodeCache.set(nodeId, { node, at: Date.now() });
  return node;
}

function invalidateNode(nodeId) {
  nodeCache.delete(nodeId);
}

async function applyStatusChange(node, gatewayId, isOnline) {
  const changed = await nodesService.setStatus(node.node_id, isOnline ? 'online' : 'offline');
  if (!changed) return null;

  await eventsService.create({
    node_id: node.node_id,
    gateway_id: gatewayId,
    event_type: isOnline ? 'communication_restored' : 'communication_lost',
    severity: isOnline ? 'info' : 'warning',
    source: 'backend',
    message: `Node ${node.node_id} is ${isOnline ? 'online' : 'offline'}`,
    details: {}
  });

  hub.broadcast('node_status', {
    node_id: node.node_id,
    gateway_id: gatewayId,
    status: isOnline ? 'online' : 'offline',
    last_seen_at: changed.last_seen_at
  });

  if (isOnline) await alertsService.resolveByType(node.node_id, 'node_offline', { note: 'Node reporting again' });
  return changed;
}

async function ingestTelemetry(parsed) {
  stats.telemetry_received += 1;
  stats.last_message_at = new Date().toISOString();

  const seenAt = new Date();
  if (parsed.gateway_id) await gatewaysService.ensureExists(parsed.gateway_id, { seenAt });

  const node = await getNode(parsed.node_id, parsed.gateway_id, parsed.values.firmware_version, seenAt);
  const wasOffline = node.status !== 'online';

  const previous = await telemetryService.getPreviousState(parsed.node_id);
  const metrics = telemetryService.deriveMetrics(
    { ...parsed.values, measured_at: parsed.measured_at },
    node,
    previous
  );
  delete metrics.measured_at;

  const reading = {
    node_id: parsed.node_id,
    gateway_id: parsed.gateway_id,
    measured_at: parsed.measured_at,
    received_at: seenAt,
    sequence_number: parsed.sequence_number,
    values: metrics,
    raw_payload: parsed.raw_payload
  };

  const stored = await telemetryService.insert(reading);
  if (!stored) {
    stats.telemetry_duplicates += 1;
    return { stored: false, duplicate: true };
  }
  stats.telemetry_stored += 1;

  await nodesService.markSeen(parsed.node_id, {
    seenAt: parsed.measured_at,
    sequenceNumber: parsed.sequence_number,
    firmwareVersion: metrics.firmware_version
  });
  if (parsed.gateway_id) await gatewaysService.markSeen(parsed.gateway_id, { seenAt });

  if (wasOffline) {
    invalidateNode(parsed.node_id);
    await applyStatusChange({ ...node, status: 'offline' }, parsed.gateway_id, true);
  }

  const evaluation = await rules.evaluateTelemetry(parsed.node_id, metrics);
  await handleRuleOutcome(parsed, evaluation, stored);

  const state = await telemetryService.saveState(parsed.node_id, reading, metrics, evaluation.risk);

  hub.broadcast('telemetry', {
    node_id: parsed.node_id,
    gateway_id: parsed.gateway_id,
    measured_at: stored.measured_at,
    received_at: stored.received_at,
    sequence_number: stored.sequence_number,
    values: state.telemetry,
    risk_score: evaluation.risk.score,
    risk_level: evaluation.risk.level,
    active_rules: evaluation.triggered.map((t) => t.rule_key)
  });

  if (evaluation.risk.score > 0) {
    hub.broadcast('node_status', {
      node_id: parsed.node_id,
      status: 'online',
      risk_score: evaluation.risk.score,
      risk_level: evaluation.risk.level
    });
  }

  return { stored: true, telemetry_id: stored.id, risk: evaluation.risk, triggered: evaluation.triggered.length };
}

async function handleRuleOutcome(parsed, evaluation, storedTelemetry) {
  for (const trigger of evaluation.triggered) {
    const { alert, created } = await alertsService.raise({
      node_id: parsed.node_id,
      gateway_id: parsed.gateway_id,
      alert_type: trigger.alert_type,
      severity: trigger.severity,
      message: `${trigger.message} (node ${parsed.node_id})`,
      risk_score: evaluation.risk.score,
      source: 'rule',
      rule_key: trigger.rule_key,
      metadata: {
        metric: trigger.metric,
        value: trigger.value,
        threshold: trigger.threshold,
        telemetry_id: storedTelemetry ? storedTelemetry.id : null,
        measured_at: parsed.measured_at
      }
    });

    if (created && trigger.event_type) {
      await eventsService.create({
        node_id: parsed.node_id,
        gateway_id: parsed.gateway_id,
        event_type: trigger.event_type,
        severity: trigger.severity,
        source: 'rule',
        occurred_at: parsed.measured_at,
        message: trigger.message,
        details: { rule_key: trigger.rule_key, value: trigger.value, threshold: trigger.threshold, alert_id: alert.id }
      });
    }
  }

  for (const clear of evaluation.cleared) {
    await alertsService.resolveByType(parsed.node_id, clear.alert_type, {
      note: `${clear.metric} back within threshold`
    });
  }
}

async function ingestEvent(parsed) {
  stats.events_received += 1;
  stats.last_message_at = new Date().toISOString();

  const seenAt = new Date();
  if (parsed.gateway_id) await gatewaysService.ensureExists(parsed.gateway_id, { seenAt });
  if (parsed.node_id) {
    await getNode(parsed.node_id, parsed.gateway_id, null, seenAt);
    await nodesService.markSeen(parsed.node_id, { seenAt: parsed.occurred_at });
  }
  if (parsed.gateway_id) await gatewaysService.markSeen(parsed.gateway_id, { seenAt });

  const event = await eventsService.create({
    node_id: parsed.node_id,
    gateway_id: parsed.gateway_id,
    event_type: parsed.event_type,
    severity: parsed.severity,
    source: parsed.source || 'device',
    occurred_at: parsed.occurred_at,
    message: parsed.message,
    details: parsed.details
  });

  if (parsed.node_id && parsed.details && isPlainObject(parsed.details.sensor_status)) {
    for (const [sensor, status] of Object.entries(parsed.details.sensor_status)) {
      await nodesService.updateSensorStatus(parsed.node_id, sensor, String(status));
    }
  }

  if (parsed.node_id && parsed.event_type === 'sensor_failure') {
    const sensor = parsed.details && parsed.details.sensor ? parsed.details.sensor : 'unknown';
    await nodesService.updateSensorStatus(parsed.node_id, sensor, 'failed');
    await alertsService.raise({
      node_id: parsed.node_id,
      gateway_id: parsed.gateway_id,
      alert_type: 'sensor_failure',
      severity: parsed.severity === 'critical' ? 'critical' : 'warning',
      message: `Sensor failure reported by ${parsed.node_id}: ${sensor}`,
      source: 'device',
      rule_key: 'sensor_failure',
      event_id: event.id,
      metadata: parsed.details || {}
    });
  }

  if (parsed.node_id && ['node_started', 'node_restarted'].includes(parsed.event_type)) {
    await alertsService.resolveByType(parsed.node_id, 'node_offline', { note: 'Node restarted' });
  }

  return event;
}

async function ingestStatus(parsed) {
  stats.status_received += 1;
  stats.last_message_at = new Date().toISOString();

  const seenAt = new Date();
  if (parsed.gateway_id) await gatewaysService.ensureExists(parsed.gateway_id, { seenAt });

  if (!parsed.node_id) {
    if (!parsed.gateway_id) return null;
    const online = parsed.status === 'online';
    if (online) {
      await gatewaysService.markSeen(parsed.gateway_id, { seenAt, firmwareVersion: parsed.firmware_version });
      await alertsService.resolveByType(null, 'gateway_offline', {
        note: 'Gateway online',
        gatewayId: parsed.gateway_id
      });
    } else {
      await gatewaysService.setStatus(parsed.gateway_id, 'offline');
      await eventsService.create({
        gateway_id: parsed.gateway_id,
        event_type: 'gateway_offline',
        severity: 'warning',
        source: 'gateway',
        occurred_at: parsed.timestamp,
        message: `Gateway ${parsed.gateway_id} reported offline`,
        details: parsed.details || {}
      });
    }
    hub.broadcast('gateway_status', { gateway_id: parsed.gateway_id, status: parsed.status });
    return { gateway_id: parsed.gateway_id, status: parsed.status };
  }

  const node = await getNode(parsed.node_id, parsed.gateway_id, parsed.firmware_version, seenAt);
  const online = parsed.status !== 'offline';

  if (online) {
    await nodesService.markSeen(parsed.node_id, {
      seenAt: parsed.timestamp || seenAt,
      firmwareVersion: parsed.firmware_version
    });
  }
  invalidateNode(parsed.node_id);
  await applyStatusChange(node, parsed.gateway_id, online);

  if (parsed.details && isPlainObject(parsed.details.sensor_status)) {
    for (const [sensor, status] of Object.entries(parsed.details.sensor_status)) {
      await nodesService.updateSensorStatus(parsed.node_id, sensor, String(status));
    }
  }

  hub.broadcast('node_status', {
    node_id: parsed.node_id,
    gateway_id: parsed.gateway_id,
    status: parsed.status,
    firmware_version: parsed.firmware_version,
    uptime_s: parsed.uptime_s
  });

  return { node_id: parsed.node_id, status: parsed.status };
}

function recordInvalid(reason, detail) {
  stats.invalid_messages += 1;
  logger.warn('invalid mqtt message', { reason, ...detail });
}

function recordError(err, detail) {
  stats.errors += 1;
  logger.error('ingest error', { error: err.message, ...detail });
}

module.exports = {
  ingestTelemetry,
  ingestEvent,
  ingestStatus,
  invalidateNode,
  recordInvalid,
  recordError,
  stats,
  nodeCache
};
