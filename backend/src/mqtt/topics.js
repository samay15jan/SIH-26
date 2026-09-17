'use strict';

const config = require('../config');

const prefix = config.mqtt.topicPrefix;

const SUBSCRIPTIONS = [
  `${prefix}/gateways/+/nodes/+/telemetry`,
  `${prefix}/gateways/+/nodes/+/status`,
  `${prefix}/gateways/+/nodes/+/events`,
  `${prefix}/gateways/+/status`
];

function telemetryTopic(gatewayId, nodeId) {
  return `${prefix}/gateways/${gatewayId}/nodes/${nodeId}/telemetry`;
}

function statusTopic(gatewayId, nodeId) {
  return `${prefix}/gateways/${gatewayId}/nodes/${nodeId}/status`;
}

function eventsTopic(gatewayId, nodeId) {
  return `${prefix}/gateways/${gatewayId}/nodes/${nodeId}/events`;
}

function gatewayStatusTopic(gatewayId) {
  return `${prefix}/gateways/${gatewayId}/status`;
}

function parseTopic(topic) {
  const parts = String(topic).split('/');
  if (parts[0] !== prefix || parts[1] !== 'gateways') return null;

  const gatewayId = parts[2];
  if (!gatewayId) return null;

  if (parts.length === 4 && parts[3] === 'status') {
    return { kind: 'gateway_status', gatewayId, nodeId: null };
  }
  if (parts.length === 6 && parts[3] === 'nodes') {
    const nodeId = parts[4];
    const leaf = parts[5];
    if (!nodeId) return null;
    if (leaf === 'telemetry') return { kind: 'telemetry', gatewayId, nodeId };
    if (leaf === 'status') return { kind: 'node_status', gatewayId, nodeId };
    if (leaf === 'events' || leaf === 'event') return { kind: 'event', gatewayId, nodeId };
  }
  return null;
}

module.exports = {
  prefix,
  SUBSCRIPTIONS,
  telemetryTopic,
  statusTopic,
  eventsTopic,
  gatewayStatusTopic,
  parseTopic
};
