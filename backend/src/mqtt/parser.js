'use strict';

const config = require('../config');
const { FIELD_BY_KEY } = require('../config/telemetryFields');
const { toNumber, toInt, toBool, toText, parseTimestamp, isPlainObject } = require('../utils/helpers');

const NESTED_KEYS = ['sensors', 'data', 'measurements', 'device', 'power', 'comm', 'lora', 'meta', 'metadata'];
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

class ParseError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

function decode(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  if (!text.trim()) throw new ParseError('empty payload');
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new ParseError('payload is not valid JSON', { sample: text.slice(0, 160) });
  }
  if (!isPlainObject(payload)) throw new ParseError('payload must be a JSON object');
  return payload;
}

function flatten(payload) {
  const flat = {};
  for (const [key, value] of Object.entries(payload)) {
    if (NESTED_KEYS.includes(key) && isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        if (flat[k] === undefined) flat[k] = v;
      }
    } else if (flat[key] === undefined) {
      flat[key] = value;
    }
  }
  return flat;
}

function coerce(field, value) {
  switch (field.type) {
    case 'float': return toNumber(value);
    case 'int': return toInt(value);
    case 'bool': return toBool(value);
    case 'text': return toText(value);
    case 'jsonb': return isPlainObject(value) || Array.isArray(value) ? value : null;
    default: return null;
  }
}

function extractValues(flat) {
  const values = {};
  const rejected = [];
  for (const [key, rawValue] of Object.entries(flat)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) continue;
    if (rawValue === null || rawValue === undefined || rawValue === '') continue;
    const value = coerce(field, rawValue);
    if (value === null) {
      rejected.push(key);
      continue;
    }
    values[field.column] = value;
  }
  return { values, rejected };
}

function resolveIds(flat, topicInfo) {
  const nodeId = toText(flat.node_id || flat.nodeId || flat.device_id || flat.id)
    || (topicInfo && topicInfo.nodeId);
  const gatewayId = toText(flat.gateway_id || flat.gatewayId || flat.gw_id)
    || (topicInfo && topicInfo.gatewayId);

  if (!nodeId) throw new ParseError('node_id is missing');
  if (!ID_PATTERN.test(nodeId)) throw new ParseError('node_id has invalid format', { node_id: nodeId });
  if (gatewayId && !ID_PATTERN.test(gatewayId)) {
    throw new ParseError('gateway_id has invalid format', { gateway_id: gatewayId });
  }
  if (topicInfo && topicInfo.nodeId && topicInfo.nodeId !== nodeId) {
    throw new ParseError('node_id does not match topic', { topic_node: topicInfo.nodeId, payload_node: nodeId });
  }
  return { nodeId, gatewayId: gatewayId || null };
}

function resolveTimestamp(flat, key = 'timestamp') {
  const parsed = parseTimestamp(flat[key] || flat.ts || flat.time || flat.measured_at);
  const now = new Date();
  if (!parsed) return now;
  const skewMs = config.telemetry.futureSkewSeconds * 1000;
  if (parsed.getTime() > now.getTime() + skewMs) return now;
  if (parsed.getTime() < now.getTime() - 3600 * 1000 * 24 * 365 * 5) return now;
  return parsed;
}

function parseTelemetry(raw, topicInfo) {
  const payload = decode(raw);
  const flat = flatten(payload);
  const { nodeId, gatewayId } = resolveIds(flat, topicInfo);
  const { values, rejected } = extractValues(flat);

  if (!Object.keys(values).length) {
    throw new ParseError('no recognised measurements in payload', { node_id: nodeId });
  }

  const sequenceRaw = flat.sequence_number ?? flat.seq ?? flat.sequence ?? flat.packet_id;
  const sequenceNumber = toInt(sequenceRaw);

  return {
    node_id: nodeId,
    gateway_id: gatewayId,
    measured_at: resolveTimestamp(flat),
    sequence_number: sequenceNumber,
    values,
    rejected_fields: rejected,
    raw_payload: payload
  };
}

function parseEvent(raw, topicInfo) {
  const payload = decode(raw);
  const flat = flatten(payload);
  const { nodeId, gatewayId } = resolveIds(flat, topicInfo);

  const eventType = toText(flat.event_type || flat.event || flat.type);
  if (!eventType) throw new ParseError('event_type is missing', { node_id: nodeId });

  const severity = toText(flat.severity || flat.level);
  const details = isPlainObject(flat.details) ? flat.details
    : isPlainObject(payload.details) ? payload.details : {};

  return {
    node_id: nodeId,
    gateway_id: gatewayId,
    event_type: eventType,
    severity: ['info', 'warning', 'critical'].includes(severity) ? severity : 'info',
    source: 'device',
    occurred_at: resolveTimestamp(flat),
    message: toText(flat.message) || null,
    details: { ...details, ...(flat.sensor ? { sensor: flat.sensor } : {}) },
    raw_payload: payload
  };
}

function parseStatus(raw, topicInfo) {
  const payload = decode(raw);
  const flat = flatten(payload);

  const isGatewayScope = topicInfo && topicInfo.kind === 'gateway_status';
  let nodeId = null;
  let gatewayId = topicInfo ? topicInfo.gatewayId : null;

  if (isGatewayScope) {
    gatewayId = toText(flat.gateway_id) || gatewayId;
    if (!gatewayId) throw new ParseError('gateway_id is missing');
  } else {
    const ids = resolveIds(flat, topicInfo);
    nodeId = ids.nodeId;
    gatewayId = ids.gatewayId;
  }

  const rawStatus = toText(flat.status || flat.state) || 'online';
  const status = ['online', 'offline', 'maintenance'].includes(rawStatus.toLowerCase())
    ? rawStatus.toLowerCase()
    : 'online';

  return {
    node_id: nodeId,
    gateway_id: gatewayId,
    status,
    timestamp: resolveTimestamp(flat),
    firmware_version: toText(flat.firmware_version || flat.firmware),
    uptime_s: toInt(flat.uptime_s || flat.uptime),
    battery_voltage: toNumber(flat.battery_voltage),
    details: {
      ...(isPlainObject(flat.sensor_status) ? { sensor_status: flat.sensor_status } : {}),
      ...(flat.reset_reason ? { reset_reason: flat.reset_reason } : {})
    },
    raw_payload: payload
  };
}

module.exports = { ParseError, decode, flatten, extractValues, parseTelemetry, parseEvent, parseStatus };
