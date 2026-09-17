'use strict';

const db = require('../db');
const config = require('../config');

async function overview({ hours = 24 } = {}) {
  const [nodeCounts, gatewayCounts, alertCounts, eventCount, telemetryCount, riskRows, sites] = await Promise.all([
    db.one(
      `SELECT count(*)::bigint AS total,
              count(*) FILTER (WHERE status = 'online')::bigint  AS online,
              count(*) FILTER (WHERE status = 'offline')::bigint AS offline,
              count(*) FILTER (WHERE status = 'unknown')::bigint AS unknown
         FROM nodes`
    ),
    db.one(
      `SELECT count(*)::bigint AS total,
              count(*) FILTER (WHERE status = 'online')::bigint  AS online,
              count(*) FILTER (WHERE status = 'offline')::bigint AS offline
         FROM gateways`
    ),
    db.one(
      `SELECT count(*) FILTER (WHERE status = 'active')::bigint        AS active,
              count(*) FILTER (WHERE status = 'acknowledged')::bigint  AS acknowledged,
              count(*) FILTER (WHERE status <> 'resolved' AND severity = 'critical')::bigint AS critical_open,
              count(*) FILTER (WHERE status <> 'resolved' AND severity = 'warning')::bigint  AS warning_open
         FROM alerts`
    ),
    db.one(
      `SELECT count(*)::bigint AS count FROM events WHERE occurred_at >= now() - make_interval(hours => $1)`,
      [hours]
    ),
    db.one(
      `SELECT count(*)::bigint AS count FROM telemetry WHERE measured_at >= now() - make_interval(hours => $1)`,
      [hours]
    ),
    db.many(
      `SELECT COALESCE(risk_level, 'unknown') AS risk_level, count(*)::bigint AS count
         FROM node_state GROUP BY risk_level`
    ),
    db.many(
      `SELECT s.id, s.code, s.name,
              count(n.node_id)::bigint AS node_count,
              count(n.node_id) FILTER (WHERE n.status = 'online')::bigint AS online_nodes
         FROM sites s LEFT JOIN nodes n ON n.site_id = s.id
        GROUP BY s.id, s.code, s.name ORDER BY s.code`
    )
  ]);

  const toNum = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Number(v)]));

  return {
    window_hours: hours,
    generated_at: new Date().toISOString(),
    nodes: toNum(nodeCounts),
    gateways: toNum(gatewayCounts),
    alerts: toNum(alertCounts),
    events_in_window: Number(eventCount.count),
    telemetry_in_window: Number(telemetryCount.count),
    risk_distribution: riskRows.reduce((acc, r) => ({ ...acc, [r.risk_level]: Number(r.count) }), {}),
    sites: sites.map((s) => ({ ...s, node_count: Number(s.node_count), online_nodes: Number(s.online_nodes) }))
  };
}

async function nodeHealth() {
  const rows = await db.many(
    `SELECT n.node_id, n.name, n.status, n.gateway_id, z.name AS zone_name,
            n.last_seen_at,
            EXTRACT(EPOCH FROM (now() - n.last_seen_at))::int AS seconds_since_seen,
            s.risk_score, s.risk_level,
            (s.telemetry->>'battery_voltage')::double precision    AS battery_voltage,
            (s.telemetry->>'battery_percentage')::double precision AS battery_percentage,
            (s.telemetry->>'lora_rssi')::double precision          AS lora_rssi,
            (s.telemetry->>'subsidence_mm')::double precision      AS subsidence_mm,
            (s.telemetry->>'relative_displacement_mm')::double precision AS relative_displacement_mm,
            (s.telemetry->>'crack_detected')::boolean              AS crack_detected,
            COALESCE(a.open_alerts, 0)::int AS open_alerts,
            COALESCE(f.failed_sensors, 0)::int AS failed_sensors
       FROM nodes n
       LEFT JOIN zones z ON z.id = n.zone_id
       LEFT JOIN node_state s ON s.node_id = n.node_id
       LEFT JOIN (SELECT node_id, count(*) AS open_alerts FROM alerts WHERE status <> 'resolved' GROUP BY node_id) a
              ON a.node_id = n.node_id
       LEFT JOIN (SELECT node_id, count(*) AS failed_sensors FROM node_sensors WHERE status = 'failed' GROUP BY node_id) f
              ON f.node_id = n.node_id
      ORDER BY s.risk_score DESC NULLS LAST, n.node_id`
  );

  return rows.map((r) => ({
    ...r,
    healthy: r.status === 'online' && r.open_alerts === 0 && r.failed_sensors === 0,
    offline_threshold_s: config.liveness.nodeOfflineAfterSeconds
  }));
}

async function sensorStatus() {
  const rows = await db.many(
    `SELECT sensor_type,
            count(*)::bigint AS total,
            count(*) FILTER (WHERE status = 'ok')::bigint       AS ok,
            count(*) FILTER (WHERE status = 'degraded')::bigint AS degraded,
            count(*) FILTER (WHERE status = 'failed')::bigint   AS failed,
            count(*) FILTER (WHERE status = 'unknown')::bigint  AS unknown
       FROM node_sensors
      GROUP BY sensor_type ORDER BY sensor_type`
  );
  const failing = await db.many(
    `SELECT node_id, sensor_type, status, last_status_at FROM node_sensors
      WHERE status IN ('failed','degraded') ORDER BY node_id, sensor_type`
  );
  return {
    by_sensor: rows.map((r) => Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, k === 'sensor_type' ? v : Number(v)])
    )),
    failing
  };
}

async function alertTimeline({ hours = 24, bucketHours = 1 } = {}) {
  const rows = await db.many(
    `SELECT to_timestamp(floor(extract(epoch FROM triggered_at) / ($2 * 3600)) * ($2 * 3600)) AS bucket,
            severity, count(*)::bigint AS count
       FROM alerts
      WHERE triggered_at >= now() - make_interval(hours => $1)
      GROUP BY bucket, severity
      ORDER BY bucket`,
    [hours, bucketHours]
  );
  return rows.map((r) => ({ bucket: r.bucket, severity: r.severity, count: Number(r.count) }));
}

async function zoneRisk() {
  return db.many(
    `SELECT z.id AS zone_id, z.code, z.name, z.risk_category, s.code AS site_code,
            count(n.node_id)::int AS node_count,
            round(avg(st.risk_score)::numeric, 2) AS avg_risk_score,
            max(st.risk_score) AS max_risk_score,
            count(*) FILTER (WHERE n.status = 'offline')::int AS offline_nodes,
            COALESCE(sum(a.open_alerts), 0)::int AS open_alerts
       FROM zones z
       JOIN sites s ON s.id = z.site_id
       LEFT JOIN nodes n ON n.zone_id = z.id
       LEFT JOIN node_state st ON st.node_id = n.node_id
       LEFT JOIN (SELECT node_id, count(*) AS open_alerts FROM alerts WHERE status <> 'resolved' GROUP BY node_id) a
              ON a.node_id = n.node_id
      GROUP BY z.id, z.code, z.name, z.risk_category, s.code
      ORDER BY max_risk_score DESC NULLS LAST`
  );
}

async function ingestionStats({ hours = 24 } = {}) {
  const [perNode, latency] = await Promise.all([
    db.many(
      `SELECT node_id, count(*)::bigint AS samples,
              min(measured_at) AS first_sample, max(measured_at) AS last_sample
         FROM telemetry
        WHERE measured_at >= now() - make_interval(hours => $1)
        GROUP BY node_id ORDER BY node_id`,
      [hours]
    ),
    db.one(
      `SELECT round(avg(EXTRACT(EPOCH FROM (received_at - measured_at)))::numeric, 3) AS avg_latency_s,
              max(EXTRACT(EPOCH FROM (received_at - measured_at))) AS max_latency_s
         FROM telemetry
        WHERE measured_at >= now() - make_interval(hours => $1)`,
      [hours]
    )
  ]);
  return {
    window_hours: hours,
    per_node: perNode.map((r) => ({ ...r, samples: Number(r.samples) })),
    latency: latency || {}
  };
}

module.exports = { overview, nodeHealth, sensorStatus, alertTimeline, zoneRisk, ingestionStats };
