'use strict';

const db = require('../db');
const hub = require('../websocket/hub');
const { notFound, badRequest } = require('../utils/helpers');

const SEVERITIES = ['info', 'warning', 'critical'];
const STATUSES = ['active', 'acknowledged', 'resolved'];
const SOURCES = ['rule', 'anomaly', 'prediction', 'device', 'system', 'manual'];

async function raise(input) {
  if (!SEVERITIES.includes(input.severity)) throw badRequest('Invalid severity');

  const existing = await db.one(
    `SELECT * FROM alerts
      WHERE node_id IS NOT DISTINCT FROM $1
        AND (node_id IS NOT NULL OR gateway_id IS NOT DISTINCT FROM $2)
        AND alert_type = $3
        AND status <> 'resolved'
      ORDER BY triggered_at DESC LIMIT 1`,
    [input.node_id || null, input.gateway_id || null, input.alert_type]
  );

  if (existing) {
    const row = await db.one(
      `UPDATE alerts
          SET last_seen_at = now(),
              occurrence_count = occurrence_count + 1,
              severity = CASE WHEN $2 = 'critical' OR (severity = 'info' AND $2 = 'warning') THEN $2 ELSE severity END,
              message = $3,
              risk_score = COALESCE($4, risk_score),
              metadata = alerts.metadata || $5::jsonb
        WHERE id = $1
        RETURNING *`,
      [existing.id, input.severity, input.message, input.risk_score ?? null, JSON.stringify(input.metadata || {})]
    );
    if (row.severity !== existing.severity) {
      hub.broadcast('alert', { ...row, change: 'escalated' });
    }
    return { alert: row, created: false };
  }

  const row = await db.one(
    `INSERT INTO alerts (node_id, gateway_id, alert_type, severity, status, message, risk_score,
                         source, rule_key, event_id, prediction_id, triggered_at, last_seen_at, metadata)
     VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, $10, now(), now(), $11::jsonb)
     RETURNING *`,
    [
      input.node_id || null,
      input.gateway_id || null,
      input.alert_type,
      input.severity,
      input.message,
      input.risk_score ?? null,
      SOURCES.includes(input.source) ? input.source : 'rule',
      input.rule_key || null,
      input.event_id || null,
      input.prediction_id || null,
      JSON.stringify(input.metadata || {})
    ]
  );

  await db.query(
    `INSERT INTO alert_history (alert_id, from_status, to_status, changed_by, note)
     VALUES ($1, NULL, 'active', $2, $3)`,
    [row.id, input.created_by || 'system', input.note || 'Alert created']
  );

  hub.broadcast('alert', { ...row, change: 'created' });
  return { alert: row, created: true };
}

async function resolveByType(nodeId, alertType, { by = 'system', note = 'Condition cleared', gatewayId = null } = {}) {
  const rows = await db.many(
    `UPDATE alerts
        SET status = 'resolved', resolved_at = now(), resolved_by = $3
      WHERE node_id IS NOT DISTINCT FROM $1
        AND (node_id IS NOT NULL OR gateway_id IS NOT DISTINCT FROM $4)
        AND alert_type = $2
        AND status <> 'resolved'
      RETURNING *`,
    [nodeId, alertType, by, gatewayId]
  );
  for (const row of rows) {
    await db.query(
      `INSERT INTO alert_history (alert_id, from_status, to_status, changed_by, note)
       VALUES ($1, 'active', 'resolved', $2, $3)`,
      [row.id, by, note]
    );
    hub.broadcast('alert', { ...row, change: 'resolved' });
  }
  return rows;
}

async function list(filters = {}) {
  const where = [];
  const params = [];

  if (filters.nodeId) {
    params.push(filters.nodeId);
    where.push(`a.node_id = $${params.length}`);
  }
  if (filters.gatewayId) {
    params.push(filters.gatewayId);
    where.push(`a.gateway_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`a.status = $${params.length}`);
  }
  if (filters.severity) {
    params.push(filters.severity);
    where.push(`a.severity = $${params.length}`);
  }
  if (filters.alertType) {
    params.push(filters.alertType);
    where.push(`a.alert_type = $${params.length}`);
  }
  if (filters.source) {
    params.push(filters.source);
    where.push(`a.source = $${params.length}`);
  }
  if (filters.active) where.push(`a.status <> 'resolved'`);
  if (filters.start) {
    params.push(filters.start);
    where.push(`a.triggered_at >= $${params.length}`);
  }
  if (filters.end) {
    params.push(filters.end);
    where.push(`a.triggered_at <= $${params.length}`);
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
    `SELECT a.*, n.name AS node_name, z.name AS zone_name
       FROM alerts a
       LEFT JOIN nodes n ON n.node_id = a.node_id
       LEFT JOIN zones z ON z.id = n.zone_id
       ${clause}
      ORDER BY (a.status <> 'resolved') DESC,
               CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               a.triggered_at DESC
      LIMIT $${limitIdx} ${offsetClause}`,
    params
  );
}

async function get(id) {
  const alert = await db.one(
    `SELECT a.*, n.name AS node_name FROM alerts a
      LEFT JOIN nodes n ON n.node_id = a.node_id
      WHERE a.id = $1`,
    [id]
  );
  if (!alert) throw notFound(`Alert ${id} not found`);
  alert.history = await db.many(
    'SELECT * FROM alert_history WHERE alert_id = $1 ORDER BY changed_at ASC',
    [id]
  );
  return alert;
}

async function updateStatus(id, { status, by = 'operator', note = null }) {
  if (!STATUSES.includes(status)) throw badRequest(`Invalid status. Allowed: ${STATUSES.join(', ')}`);

  const current = await db.one('SELECT * FROM alerts WHERE id = $1', [id]);
  if (!current) throw notFound(`Alert ${id} not found`);
  if (current.status === status) return current;

  const sets = ['status = $2'];
  const params = [id, status];

  if (status === 'acknowledged') {
    params.push(by);
    sets.push(`acknowledged_at = now(), acknowledged_by = $${params.length}`);
  }
  if (status === 'resolved') {
    params.push(by);
    sets.push(`resolved_at = now(), resolved_by = $${params.length}`);
  }
  if (status === 'active') {
    sets.push('resolved_at = NULL, resolved_by = NULL');
  }

  const row = await db.one(`UPDATE alerts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);

  await db.query(
    `INSERT INTO alert_history (alert_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, current.status, status, by, note]
  );

  hub.broadcast('alert', { ...row, change: status });
  return row;
}

async function summary({ hours = 24 } = {}) {
  const [byStatus, bySeverity, byType, recent] = await Promise.all([
    db.many(`SELECT status, count(*)::bigint AS count FROM alerts GROUP BY status`),
    db.many(`SELECT severity, count(*)::bigint AS count FROM alerts WHERE status <> 'resolved' GROUP BY severity`),
    db.many(
      `SELECT alert_type, count(*)::bigint AS count FROM alerts
        WHERE triggered_at >= now() - make_interval(hours => $1)
        GROUP BY alert_type ORDER BY count DESC LIMIT 10`,
      [hours]
    ),
    db.one(
      `SELECT count(*)::bigint AS count FROM alerts WHERE triggered_at >= now() - make_interval(hours => $1)`,
      [hours]
    )
  ]);

  const toMap = (rows, key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: Number(r.count) }), {});

  return {
    window_hours: hours,
    by_status: toMap(byStatus, 'status'),
    open_by_severity: toMap(bySeverity, 'severity'),
    top_types: byType.map((r) => ({ alert_type: r.alert_type, count: Number(r.count) })),
    triggered_in_window: Number(recent.count)
  };
}

module.exports = { raise, resolveByType, list, get, updateStatus, summary, SEVERITIES, STATUSES, SOURCES };
