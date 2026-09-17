'use strict';

const db = require('../db');
const hub = require('../websocket/hub');
const alerts = require('./alerts');
const { notFound, badRequest, toNumber } = require('../utils/helpers');

const SEVERITIES = ['info', 'warning', 'critical'];
const RISK_LEVELS = ['low', 'moderate', 'high', 'severe'];

async function create(input) {
  if (!input.model_name) throw badRequest('model_name is required');
  if (!input.prediction_type) throw badRequest('prediction_type is required');
  if (input.severity && !SEVERITIES.includes(input.severity)) throw badRequest('Invalid severity');

  const row = await db.one(
    `INSERT INTO predictions (node_id, zone_id, model_name, model_version, prediction_type, predicted_at,
                              target_time, horizon_minutes, predicted_value, predicted_label, confidence,
                              risk_score, severity, features, raw_response)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb)
     RETURNING *`,
    [
      input.node_id || null,
      input.zone_id || null,
      input.model_name,
      input.model_version || 'v1',
      input.prediction_type,
      input.predicted_at || null,
      input.target_time || null,
      input.horizon_minutes ?? null,
      toNumber(input.predicted_value),
      input.predicted_label || null,
      toNumber(input.confidence),
      toNumber(input.risk_score),
      input.severity || null,
      JSON.stringify(input.features || {}),
      input.raw_response ? JSON.stringify(input.raw_response) : null
    ]
  );

  hub.broadcast('prediction', row);

  if (input.raise_alert !== false && row.severity && row.severity !== 'info' && row.node_id) {
    await alerts.raise({
      node_id: row.node_id,
      alert_type: `ai_${row.prediction_type}`,
      severity: row.severity,
      message: input.alert_message
        || `AI model ${row.model_name} ${row.model_version} predicts ${row.predicted_label || row.predicted_value} for ${row.prediction_type}`,
      risk_score: row.risk_score,
      source: 'prediction',
      prediction_id: row.id,
      metadata: { model_name: row.model_name, model_version: row.model_version, confidence: row.confidence }
    });
  }

  return row;
}

async function createBatch(items) {
  const out = [];
  for (const item of items) out.push(await create(item));
  return out;
}

async function list(filters = {}) {
  const where = [];
  const params = [];

  if (filters.nodeId) {
    params.push(filters.nodeId);
    where.push(`p.node_id = $${params.length}`);
  }
  if (filters.predictionType) {
    params.push(filters.predictionType);
    where.push(`p.prediction_type = $${params.length}`);
  }
  if (filters.modelName) {
    params.push(filters.modelName);
    where.push(`p.model_name = $${params.length}`);
  }
  if (filters.severity) {
    params.push(filters.severity);
    where.push(`p.severity = $${params.length}`);
  }
  if (filters.start) {
    params.push(filters.start);
    where.push(`p.predicted_at >= $${params.length}`);
  }
  if (filters.end) {
    params.push(filters.end);
    where.push(`p.predicted_at <= $${params.length}`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Math.min(filters.limit || 100, 1000));
  const limitIdx = params.length;

  return db.many(
    `SELECT p.*, n.name AS node_name FROM predictions p
       LEFT JOIN nodes n ON n.node_id = p.node_id
       ${clause}
      ORDER BY p.predicted_at DESC, p.id DESC
      LIMIT $${limitIdx}`,
    params
  );
}

async function get(id) {
  const row = await db.one('SELECT * FROM predictions WHERE id = $1', [id]);
  if (!row) throw notFound(`Prediction ${id} not found`);
  return row;
}

async function latestPerNode() {
  return db.many(
    `SELECT DISTINCT ON (node_id, prediction_type)
            node_id, prediction_type, model_name, model_version, predicted_at, target_time,
            predicted_value, predicted_label, confidence, risk_score, severity
       FROM predictions
      WHERE node_id IS NOT NULL
      ORDER BY node_id, prediction_type, predicted_at DESC`
  );
}

async function createAnomaly(input) {
  if (!input.node_id) throw badRequest('node_id is required');
  if (!input.anomaly_type) throw badRequest('anomaly_type is required');

  const row = await db.one(
    `INSERT INTO anomalies (node_id, detected_at, window_start, window_end, anomaly_type, metric,
                            observed_value, expected_value, deviation, score, severity, method,
                            model_name, model_version, details)
     VALUES ($1, COALESCE($2, now()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
     RETURNING *`,
    [
      input.node_id,
      input.detected_at || null,
      input.window_start || null,
      input.window_end || null,
      input.anomaly_type,
      input.metric || null,
      toNumber(input.observed_value),
      toNumber(input.expected_value),
      toNumber(input.deviation),
      toNumber(input.score),
      SEVERITIES.includes(input.severity) ? input.severity : 'warning',
      ['rule', 'statistical', 'model'].includes(input.method) ? input.method : 'model',
      input.model_name || null,
      input.model_version || null,
      JSON.stringify(input.details || {})
    ]
  );

  hub.broadcast('event', { ...row, event_type: 'anomaly_detected', occurred_at: row.detected_at });

  if (input.raise_alert !== false && row.severity !== 'info') {
    await alerts.raise({
      node_id: row.node_id,
      alert_type: `anomaly_${row.anomaly_type}`,
      severity: row.severity,
      message: `Anomaly (${row.anomaly_type}) detected on ${row.metric || 'telemetry'}`,
      risk_score: row.score !== null ? Math.min(100, Number(row.score) * 20) : null,
      source: 'anomaly',
      metadata: { metric: row.metric, observed: row.observed_value, expected: row.expected_value }
    });
  }

  return row;
}

async function listAnomalies(filters = {}) {
  const where = [];
  const params = [];
  if (filters.nodeId) {
    params.push(filters.nodeId);
    where.push(`node_id = $${params.length}`);
  }
  if (filters.anomalyType) {
    params.push(filters.anomalyType);
    where.push(`anomaly_type = $${params.length}`);
  }
  if (filters.start) {
    params.push(filters.start);
    where.push(`detected_at >= $${params.length}`);
  }
  if (filters.end) {
    params.push(filters.end);
    where.push(`detected_at <= $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Math.min(filters.limit || 100, 1000));
  return db.many(
    `SELECT * FROM anomalies ${clause} ORDER BY detected_at DESC LIMIT $${params.length}`,
    params
  );
}

async function anomalySummary({ hours = 24 } = {}) {
  const rows = await db.many(
    `SELECT anomaly_type, severity, method, count(*)::bigint AS count, max(detected_at) AS last_detected
       FROM anomalies
      WHERE detected_at >= now() - make_interval(hours => $1)
      GROUP BY anomaly_type, severity, method
      ORDER BY count DESC`,
    [hours]
  );
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

async function createRiskAssessment(input) {
  if (!RISK_LEVELS.includes(input.risk_level)) throw badRequest(`risk_level must be one of ${RISK_LEVELS.join(', ')}`);
  const row = await db.one(
    `INSERT INTO risk_assessments (node_id, zone_id, assessed_at, risk_score, risk_level, source,
                                   model_name, model_version, contributing_factors, valid_until)
     VALUES ($1, $2, COALESCE($3, now()), $4, $5, $6, $7, $8, $9::jsonb, $10)
     RETURNING *`,
    [
      input.node_id || null,
      input.zone_id || null,
      input.assessed_at || null,
      toNumber(input.risk_score),
      input.risk_level,
      ['rule', 'ai', 'manual'].includes(input.source) ? input.source : 'ai',
      input.model_name || null,
      input.model_version || null,
      JSON.stringify(input.contributing_factors || {}),
      input.valid_until || null
    ]
  );

  if (row.node_id) {
    await db.query(
      `UPDATE node_state SET risk_score = $2, risk_level = $3, updated_at = now() WHERE node_id = $1`,
      [row.node_id, row.risk_score, row.risk_level]
    );
  }

  hub.broadcast('prediction', { ...row, prediction_type: 'risk_assessment' });
  return row;
}

async function listRiskAssessments(filters = {}) {
  const where = [];
  const params = [];
  if (filters.nodeId) {
    params.push(filters.nodeId);
    where.push(`node_id = $${params.length}`);
  }
  if (filters.riskLevel) {
    params.push(filters.riskLevel);
    where.push(`risk_level = $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Math.min(filters.limit || 100, 1000));
  return db.many(
    `SELECT * FROM risk_assessments ${clause} ORDER BY assessed_at DESC LIMIT $${params.length}`,
    params
  );
}

module.exports = {
  create,
  createBatch,
  list,
  get,
  latestPerNode,
  createAnomaly,
  listAnomalies,
  anomalySummary,
  createRiskAssessment,
  listRiskAssessments,
  RISK_LEVELS
};
