'use strict';

const db = require('../db');
const config = require('../config');
const { notFound } = require('../utils/helpers');

const NODE_COLUMNS = `node_id, name, gateway_id, site_id, zone_id, latitude, longitude, elevation_m,
  status, firmware_version, hardware_revision, reference_distance_mm, install_depth_m,
  first_seen_at, last_seen_at, last_sequence_number, metadata, created_at, updated_at`;

async function list(filters = {}) {
  const where = [];
  const params = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.gatewayId) {
    params.push(filters.gatewayId);
    where.push(`gateway_id = $${params.length}`);
  }
  if (filters.siteId) {
    params.push(filters.siteId);
    where.push(`site_id = $${params.length}`);
  }
  if (filters.zoneId) {
    params.push(filters.zoneId);
    where.push(`zone_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(node_id ILIKE $${params.length} OR name ILIKE $${params.length})`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.many(`SELECT * FROM node_overview ${clause} ORDER BY node_id`, params);
}

async function get(nodeId) {
  return db.one('SELECT * FROM node_overview WHERE node_id = $1', [nodeId]);
}

async function getOrFail(nodeId) {
  const node = await get(nodeId);
  if (!node) throw notFound(`Node ${nodeId} not found`);
  return node;
}

async function getRaw(nodeId) {
  return db.one(`SELECT ${NODE_COLUMNS} FROM nodes WHERE node_id = $1`, [nodeId]);
}

async function ensureExists(nodeId, { gatewayId = null, firmwareVersion = null, seenAt = new Date() } = {}) {
  const row = await db.one(
    `INSERT INTO nodes (node_id, name, gateway_id, firmware_version, status, first_seen_at, last_seen_at, metadata)
     VALUES ($1, $1, $2, $3, 'online', $4, $4, jsonb_build_object('auto_registered', true))
     ON CONFLICT (node_id) DO UPDATE
       SET gateway_id = COALESCE(EXCLUDED.gateway_id, nodes.gateway_id),
           firmware_version = COALESCE(EXCLUDED.firmware_version, nodes.firmware_version),
           first_seen_at = COALESCE(nodes.first_seen_at, EXCLUDED.first_seen_at)
     RETURNING ${NODE_COLUMNS}, (xmax = 0) AS created`,
    [nodeId, gatewayId, firmwareVersion, seenAt]
  );
  return row;
}

async function markSeen(nodeId, { seenAt = new Date(), sequenceNumber = null, firmwareVersion = null } = {}) {
  return db.one(
    `UPDATE nodes
        SET last_seen_at = GREATEST(COALESCE(last_seen_at, $2), $2),
            first_seen_at = COALESCE(first_seen_at, $2),
            last_sequence_number = COALESCE($3, last_sequence_number),
            firmware_version = COALESCE($4, firmware_version),
            status = 'online'
      WHERE node_id = $1
      RETURNING node_id, status, last_seen_at, (status IS DISTINCT FROM 'online') AS was_offline`,
    [nodeId, seenAt, sequenceNumber, firmwareVersion]
  );
}

async function setStatus(nodeId, status) {
  return db.one(
    `UPDATE nodes SET status = $2 WHERE node_id = $1 AND status IS DISTINCT FROM $2
     RETURNING node_id, status, last_seen_at`,
    [nodeId, status]
  );
}

async function findStale(seconds = config.liveness.nodeOfflineAfterSeconds) {
  return db.many(
    `SELECT node_id, gateway_id, status, last_seen_at,
            EXTRACT(EPOCH FROM (now() - last_seen_at))::int AS seconds_since_seen
       FROM nodes
      WHERE status NOT IN ('offline','maintenance')
        AND (last_seen_at IS NULL OR last_seen_at < now() - make_interval(secs => $1))`,
    [seconds]
  );
}

async function update(nodeId, patch) {
  const allowed = ['name', 'gateway_id', 'site_id', 'zone_id', 'latitude', 'longitude', 'elevation_m',
    'status', 'firmware_version', 'hardware_revision', 'reference_distance_mm', 'install_depth_m', 'metadata'];
  const sets = [];
  const params = [nodeId];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      params.push(key === 'metadata' ? JSON.stringify(patch[key]) : patch[key]);
      sets.push(`${key} = $${params.length}${key === 'metadata' ? '::jsonb' : ''}`);
    }
  }
  if (!sets.length) return getRaw(nodeId);
  const row = await db.one(
    `UPDATE nodes SET ${sets.join(', ')} WHERE node_id = $1 RETURNING ${NODE_COLUMNS}`,
    params
  );
  if (!row) throw notFound(`Node ${nodeId} not found`);
  return row;
}

async function sensors(nodeId) {
  return db.many(
    `SELECT id, node_id, sensor_type, model, enabled, status, last_status_at, config
       FROM node_sensors WHERE node_id = $1 ORDER BY sensor_type`,
    [nodeId]
  );
}

async function updateSensorStatus(nodeId, sensorType, status) {
  return db.one(
    `INSERT INTO node_sensors (node_id, sensor_type, status, last_status_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (node_id, sensor_type) DO UPDATE
       SET status = EXCLUDED.status, last_status_at = now()
     RETURNING node_id, sensor_type, status`,
    [nodeId, sensorType, status]
  );
}

module.exports = {
  list,
  get,
  getOrFail,
  getRaw,
  ensureExists,
  markSeen,
  setStatus,
  findStale,
  update,
  sensors,
  updateSensorStatus
};
