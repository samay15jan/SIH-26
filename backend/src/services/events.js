'use strict';

const db = require('../db');
const hub = require('../websocket/hub');
const { notFound } = require('../utils/helpers');

const SEVERITIES = ['info', 'warning', 'critical'];
const SOURCES = ['device', 'gateway', 'backend', 'rule', 'ai', 'manual'];

async function create(event, { broadcast = true } = {}) {
  const severity = SEVERITIES.includes(event.severity) ? event.severity : 'info';
  const source = SOURCES.includes(event.source) ? event.source : 'device';
  const row = await db.one(
    `INSERT INTO events (node_id, gateway_id, event_type, severity, source, occurred_at, received_at, message, details)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8::jsonb)
     RETURNING *`,
    [
      event.node_id || null,
      event.gateway_id || null,
      event.event_type,
      severity,
      source,
      event.occurred_at || new Date(),
      event.message || null,
      JSON.stringify(event.details || {})
    ]
  );
  if (broadcast) hub.broadcast('event', row);
  return row;
}

async function list(filters = {}) {
  const where = [];
  const params = [];

  if (filters.nodeId) {
    params.push(filters.nodeId);
    where.push(`node_id = $${params.length}`);
  }
  if (filters.gatewayId) {
    params.push(filters.gatewayId);
    where.push(`gateway_id = $${params.length}`);
  }
  if (filters.eventType) {
    params.push(filters.eventType);
    where.push(`event_type = $${params.length}`);
  }
  if (filters.severity) {
    params.push(filters.severity);
    where.push(`severity = $${params.length}`);
  }
  if (filters.source) {
    params.push(filters.source);
    where.push(`source = $${params.length}`);
  }
  if (filters.start) {
    params.push(filters.start);
    where.push(`occurred_at >= $${params.length}`);
  }
  if (filters.end) {
    params.push(filters.end);
    where.push(`occurred_at <= $${params.length}`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Math.min(filters.limit || 100, 1000));
  const limitIdx = params.length;
  let offsetClause = '';
  if (filters.offset) {
    params.push(filters.offset);
    offsetClause = `OFFSET $${params.length}`;
  }

  return db.many(
    `SELECT * FROM events ${clause} ORDER BY occurred_at DESC, id DESC LIMIT $${limitIdx} ${offsetClause}`,
    params
  );
}

async function get(id) {
  const row = await db.one('SELECT * FROM events WHERE id = $1', [id]);
  if (!row) throw notFound(`Event ${id} not found`);
  return row;
}

async function summary({ hours = 24 } = {}) {
  return db.many(
    `SELECT event_type, severity, count(*)::bigint AS count, max(occurred_at) AS last_seen
       FROM events
      WHERE occurred_at >= now() - make_interval(hours => $1)
      GROUP BY event_type, severity
      ORDER BY count DESC`,
    [hours]
  );
}

module.exports = { create, list, get, summary, SEVERITIES, SOURCES };
