'use strict';

const config = require('../config');
const db = require('../db');
const logger = require('../utils/logger');
const nodesService = require('./nodes');
const gatewaysService = require('./gateways');
const eventsService = require('./events');
const alertsService = require('./alerts');
const rules = require('../rules/engine');
const hub = require('../websocket/hub');
const ingest = require('./ingest');

let timer = null;
let partitionTimer = null;

async function sweepNodes() {
  const stale = await nodesService.findStale(config.liveness.nodeOfflineAfterSeconds);
  for (const node of stale) {
    await nodesService.setStatus(node.node_id, 'offline');
    ingest.invalidateNode(node.node_id);

    await eventsService.create({
      node_id: node.node_id,
      gateway_id: node.gateway_id,
      event_type: 'communication_lost',
      severity: 'warning',
      source: 'backend',
      message: `No telemetry from ${node.node_id} for ${node.seconds_since_seen || 'unknown'} s`,
      details: { seconds_since_seen: node.seconds_since_seen, last_seen_at: node.last_seen_at }
    });

    const triggered = await rules.evaluateLiveness(node.node_id, node.seconds_since_seen || 999999, ['node_offline']);
    for (const trigger of triggered) {
      await alertsService.raise({
        node_id: node.node_id,
        gateway_id: node.gateway_id,
        alert_type: trigger.alert_type,
        severity: trigger.severity,
        message: `Node ${node.node_id} offline (last seen ${node.last_seen_at || 'never'})`,
        risk_score: trigger.risk_weight,
        source: 'rule',
        rule_key: trigger.rule_key,
        metadata: { seconds_since_seen: node.seconds_since_seen }
      });
    }

    hub.broadcast('node_status', {
      node_id: node.node_id,
      gateway_id: node.gateway_id,
      status: 'offline',
      last_seen_at: node.last_seen_at,
      seconds_since_seen: node.seconds_since_seen
    });
  }
  return stale.length;
}

async function sweepGateways() {
  const stale = await gatewaysService.findStale(config.liveness.gatewayOfflineAfterSeconds);
  for (const gateway of stale) {
    await gatewaysService.setStatus(gateway.gateway_id, 'offline');

    await eventsService.create({
      gateway_id: gateway.gateway_id,
      event_type: 'gateway_offline',
      severity: 'warning',
      source: 'backend',
      message: `Gateway ${gateway.gateway_id} has not reported for ${gateway.seconds_since_seen || 'unknown'} s`,
      details: { seconds_since_seen: gateway.seconds_since_seen }
    });

    const gatewayRule = await rules.getRule('gateway_offline');
    await alertsService.raise({
      gateway_id: gateway.gateway_id,
      alert_type: 'gateway_offline',
      severity: gatewayRule ? gatewayRule.severity : 'warning',
      message: `Gateway ${gateway.gateway_id} offline`,
      risk_score: 20,
      source: 'rule',
      rule_key: 'gateway_offline',
      metadata: { seconds_since_seen: gateway.seconds_since_seen }
    });

    hub.broadcast('gateway_status', {
      gateway_id: gateway.gateway_id,
      status: 'offline',
      last_seen_at: gateway.last_seen_at
    });
  }
  return stale.length;
}

async function runOnce() {
  try {
    const [nodes, gateways] = await Promise.all([sweepNodes(), sweepGateways()]);
    if (nodes || gateways) logger.info('liveness sweep', { nodes_offline: nodes, gateways_offline: gateways });
  } catch (err) {
    logger.error('liveness sweep failed', err);
  }
}

function start() {
  if (timer) return;
  timer = setInterval(runOnce, config.liveness.monitorIntervalSeconds * 1000);
  timer.unref();

  partitionTimer = setInterval(() => {
    db.ensurePartitionsAround().catch((err) => logger.error('partition maintenance failed', err));
  }, 6 * 3600 * 1000);
  partitionTimer.unref();

  logger.info('liveness monitor started', {
    interval_s: config.liveness.monitorIntervalSeconds,
    node_offline_after_s: config.liveness.nodeOfflineAfterSeconds
  });
}

function stop() {
  if (timer) clearInterval(timer);
  if (partitionTimer) clearInterval(partitionTimer);
  timer = null;
  partitionTimer = null;
}

module.exports = { start, stop, runOnce, sweepNodes, sweepGateways };
