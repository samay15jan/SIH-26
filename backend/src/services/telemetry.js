'use strict';

const db = require('../db');
const config = require('../config');
const { FIELDS, FIELD_BY_COLUMN, NUMERIC_METRICS } = require('../config/telemetryFields');
const { badRequest, toNumber } = require('../utils/helpers');

const GRAVITY = 9.80665;
const NO_PARTITION_ERRORS = new Set(['23514', '23P01']);

const SELECT_COLUMNS = `id, node_id, gateway_id, measured_at, received_at, sequence_number,
  ${FIELDS.map((f) => f.column).join(', ')}`;

function deriveMetrics(values, node, previous) {
  const derived = { ...values };

  const ax = toNumber(derived.accel_x);
  const ay = toNumber(derived.accel_y);
  const az = toNumber(derived.accel_z);
  if (ax !== null && ay !== null && az !== null) {
    const magnitude = Math.sqrt(ax * ax + ay * ay + az * az);
    derived.accel_magnitude = Number((magnitude / GRAVITY).toFixed(4));
    if (derived.vibration_intensity === undefined || derived.vibration_intensity === null) {
      derived.vibration_intensity = Number((Math.abs(magnitude - GRAVITY) / GRAVITY + 1).toFixed(4));
    }
  }

  const roll = toNumber(derived.roll);
  const pitch = toNumber(derived.pitch);
  if (roll !== null || pitch !== null) {
    derived.tilt_deg = Number(Math.max(Math.abs(roll || 0), Math.abs(pitch || 0)).toFixed(3));
  }

  const reference = toNumber(derived.reference_distance_mm) ?? toNumber(node && node.reference_distance_mm);
  const distance = toNumber(derived.ultrasonic_distance_mm);
  if (reference !== null) derived.reference_distance_mm = reference;

  if (reference !== null && distance !== null) {
    if (derived.displacement_mm === undefined || derived.displacement_mm === null) {
      derived.displacement_mm = Number((reference - distance).toFixed(3));
    }
    if (derived.subsidence_mm === undefined || derived.subsidence_mm === null) {
      derived.subsidence_mm = Number(Math.max(0, reference - distance).toFixed(3));
    }
  }

  const subsidence = toNumber(derived.subsidence_mm);
  const prevSubsidence = previous ? toNumber(previous.subsidence_mm) : null;
  const prevAt = previous && previous.measured_at ? new Date(previous.measured_at).getTime() : null;
  const nowAt = derived.measured_at ? new Date(derived.measured_at).getTime() : Date.now();
  if (
    (derived.subsidence_rate_mm_per_day === undefined || derived.subsidence_rate_mm_per_day === null) &&
    subsidence !== null && prevSubsidence !== null && prevAt && nowAt > prevAt
  ) {
    const days = (nowAt - prevAt) / 86400000;
    if (days >= 0.0007) {
      derived.subsidence_rate_mm_per_day = Number(((subsidence - prevSubsidence) / days).toFixed(3));
    }
  }

  const battery = toNumber(derived.battery_voltage);
  if (battery !== null && (derived.battery_percentage === undefined || derived.battery_percentage === null)) {
    const pct = ((battery - 3.0) / (4.2 - 3.0)) * 100;
    derived.battery_percentage = Number(Math.min(100, Math.max(0, pct)).toFixed(1));
  }

  return derived;
}

function buildInsert(reading) {
  const columns = ['node_id', 'gateway_id', 'measured_at', 'received_at', 'sequence_number'];
  const values = [
    reading.node_id,
    reading.gateway_id || null,
    reading.measured_at,
    reading.received_at || new Date(),
    reading.sequence_number ?? null
  ];

  for (const field of FIELDS) {
    const value = reading.values ? reading.values[field.column] : undefined;
    if (value === undefined || value === null) continue;
    columns.push(field.column);
    values.push(field.type === 'jsonb' ? JSON.stringify(value) : value);
  }

  columns.push('raw_payload');
  values.push(JSON.stringify(reading.raw_payload || {}));

  const placeholders = columns.map((col, i) => {
    const field = FIELD_BY_COLUMN.get(col);
    return field && field.type === 'jsonb' ? `$${i + 1}::jsonb` : col === 'raw_payload' ? `$${i + 1}::jsonb` : `$${i + 1}`;
  });

  const text = `INSERT INTO telemetry (${columns.join(', ')})
                VALUES (${placeholders.join(', ')})
                ON CONFLICT DO NOTHING
                RETURNING ${SELECT_COLUMNS}`;
  return { text, values };
}

async function insert(reading) {
  const { text, values } = buildInsert(reading);
  try {
    const res = await db.query(text, values);
    return res.rows[0] || null;
  } catch (err) {
    if (NO_PARTITION_ERRORS.has(err.code) && /partition/i.test(err.message || '')) {
      await db.ensurePartition(reading.measured_at);
      const retry = await db.query(text, values);
      return retry.rows[0] || null;
    }
    throw err;
  }
}

async function getPreviousState(nodeId) {
  return db.one(
    `SELECT measured_at, telemetry->>'subsidence_mm' AS subsidence_mm
       FROM node_state WHERE node_id = $1`,
    [nodeId]
  );
}

async function saveState(nodeId, reading, metrics, risk) {
  const snapshot = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (value !== null && value !== undefined) snapshot[key] = value;
  }
  return db.one(
    `INSERT INTO node_state (node_id, measured_at, received_at, sequence_number, gateway_id, telemetry, risk_score, risk_level, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
     ON CONFLICT (node_id) DO UPDATE
       SET measured_at = EXCLUDED.measured_at,
           received_at = EXCLUDED.received_at,
           sequence_number = EXCLUDED.sequence_number,
           gateway_id = COALESCE(EXCLUDED.gateway_id, node_state.gateway_id),
           telemetry = EXCLUDED.telemetry,
           risk_score = EXCLUDED.risk_score,
           risk_level = EXCLUDED.risk_level,
           updated_at = now()
     RETURNING node_id, measured_at, telemetry, risk_score, risk_level`,
    [
      nodeId,
      reading.measured_at,
      reading.received_at || new Date(),
      reading.sequence_number ?? null,
      reading.gateway_id || null,
      JSON.stringify(snapshot),
      risk ? risk.score : null,
      risk ? risk.level : null
    ]
  );
}

function buildHistoryQuery(filters) {
  const where = [];
  const params = [];

  if (filters.nodeId) {
    params.push(filters.nodeId);
    where.push(`node_id = $${params.length}`);
  }
  if (filters.nodeIds && filters.nodeIds.length) {
    params.push(filters.nodeIds);
    where.push(`node_id = ANY($${params.length})`);
  }
  if (filters.gatewayId) {
    params.push(filters.gatewayId);
    where.push(`gateway_id = $${params.length}`);
  }
  if (filters.start) {
    params.push(filters.start);
    where.push(`measured_at >= $${params.length}`);
  }
  if (filters.end) {
    params.push(filters.end);
    where.push(`measured_at <= $${params.length}`);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function history(filters = {}) {
  const limit = Math.min(filters.limit || 200, config.telemetry.maxLimit);
  const { clause, params } = buildHistoryQuery(filters);
  params.push(limit);
  const limitIdx = params.length;
  let offsetClause = '';
  if (filters.offset) {
    params.push(filters.offset);
    offsetClause = `OFFSET $${params.length}`;
  }
  const order = filters.order === 'asc' ? 'ASC' : 'DESC';
  return db.many(
    `SELECT ${SELECT_COLUMNS} FROM telemetry ${clause}
      ORDER BY measured_at ${order}, id ${order}
      LIMIT $${limitIdx} ${offsetClause}`,
    params
  );
}

async function count(filters = {}) {
  const { clause, params } = buildHistoryQuery(filters);
  const row = await db.one(`SELECT count(*)::bigint AS total FROM telemetry ${clause}`, params);
  return row ? Number(row.total) : 0;
}

async function latestForNode(nodeId) {
  return db.one(
    `SELECT ${SELECT_COLUMNS}, raw_payload FROM telemetry
      WHERE node_id = $1 ORDER BY measured_at DESC LIMIT 1`,
    [nodeId]
  );
}

async function latestAll(filters = {}) {
  const where = [];
  const params = [];
  if (filters.nodeId) {
    params.push(filters.nodeId);
    where.push(`s.node_id = $${params.length}`);
  }
  if (filters.gatewayId) {
    params.push(filters.gatewayId);
    where.push(`n.gateway_id = $${params.length}`);
  }
  if (filters.zoneId) {
    params.push(filters.zoneId);
    where.push(`n.zone_id = $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.many(
    `SELECT s.node_id, n.name, n.gateway_id, n.zone_id, n.status,
            s.measured_at, s.received_at, s.sequence_number, s.telemetry,
            s.risk_score, s.risk_level
       FROM node_state s
       JOIN nodes n ON n.node_id = s.node_id
       ${clause}
      ORDER BY s.node_id`,
    params
  );
}

async function summary(filters = {}) {
  const metrics = (filters.metrics && filters.metrics.length ? filters.metrics : [
    'relative_displacement_mm', 'subsidence_mm', 'vibration_intensity', 'battery_voltage', 'lora_rssi'
  ]).filter((m) => NUMERIC_METRICS.includes(m));

  if (!metrics.length) throw badRequest('No valid metrics requested', { allowed: NUMERIC_METRICS });

  const { clause, params } = buildHistoryQuery(filters);
  const aggregates = metrics
    .map((m) => `min(${m}) AS ${m}_min, max(${m}) AS ${m}_max, avg(${m}) AS ${m}_avg`)
    .join(', ');

  const row = await db.one(
    `SELECT count(*)::bigint AS samples,
            min(measured_at) AS first_sample,
            max(measured_at) AS last_sample,
            ${aggregates}
       FROM telemetry ${clause}`,
    params
  );

  const out = { samples: Number(row.samples), first_sample: row.first_sample, last_sample: row.last_sample, metrics: {} };
  for (const m of metrics) {
    out.metrics[m] = {
      min: row[`${m}_min`],
      max: row[`${m}_max`],
      avg: row[`${m}_avg`] === null ? null : Number(Number(row[`${m}_avg`]).toFixed(4))
    };
  }
  return out;
}

async function trend(filters = {}) {
  const metrics = (filters.metrics && filters.metrics.length ? filters.metrics : ['subsidence_mm'])
    .filter((m) => NUMERIC_METRICS.includes(m));
  if (!metrics.length) throw badRequest('No valid metrics requested', { allowed: NUMERIC_METRICS });

  const bucketSeconds = Math.max(60, Math.min(filters.bucketSeconds || 3600, 86400));
  const { clause, params } = buildHistoryQuery(filters);
  params.push(bucketSeconds);
  const bucketIdx = params.length;

  const aggregates = metrics
    .map((m) => `avg(${m}) AS ${m}_avg, min(${m}) AS ${m}_min, max(${m}) AS ${m}_max`)
    .join(', ');

  const rows = await db.many(
    `SELECT to_timestamp(floor(extract(epoch FROM measured_at) / $${bucketIdx}) * $${bucketIdx}) AS bucket,
            count(*)::bigint AS samples,
            ${aggregates}
       FROM telemetry ${clause}
      GROUP BY bucket
      ORDER BY bucket ASC`,
    params
  );

  return rows.map((r) => {
    const point = { bucket: r.bucket, samples: Number(r.samples) };
    for (const m of metrics) {
      point[m] = {
        avg: r[`${m}_avg`] === null ? null : Number(Number(r[`${m}_avg`]).toFixed(4)),
        min: r[`${m}_min`],
        max: r[`${m}_max`]
      };
    }
    return point;
  });
}

module.exports = {
  SELECT_COLUMNS,
  deriveMetrics,
  buildInsert,
  insert,
  getPreviousState,
  saveState,
  history,
  count,
  latestForNode,
  latestAll,
  summary,
  trend
};
