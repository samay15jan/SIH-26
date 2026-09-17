'use strict';

const db = require('../db');
const config = require('../config');
const { notFound } = require('../utils/helpers');

const GATEWAY_COLUMNS = `gateway_id, name, site_id, zone_id, status, latitude, longitude,
  firmware_version, first_seen_at, last_seen_at, metadata, created_at, updated_at`;

async function list(filters = {}) {
  const where = [];
  const params = [];
  if (filters.status) {
    params.push(filters.status);
    where.push(`g.status = $${params.length}`);
  }
  if (filters.siteId) {
    params.push(filters.siteId);
    where.push(`g.site_id = $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.many(
    `SELECT g.gateway_id, g.name, g.site_id, s.code AS site_code, s.name AS site_name,
            g.zone_id, g.status, g.latitude, g.longitude, g.firmware_version,
            g.first_seen_at, g.last_seen_at, g.metadata,
            COALESCE(n.node_count, 0)   AS node_count,
            COALESCE(n.online_nodes, 0) AS online_nodes
       FROM gateways g
       LEFT JOIN sites s ON s.id = g.site_id
       LEFT JOIN (
         SELECT gateway_id, count(*) AS node_count,
                count(*) FILTER (WHERE status = 'online') AS online_nodes
           FROM nodes GROUP BY gateway_id
       ) n ON n.gateway_id = g.gateway_id
       ${clause}
      ORDER BY g.gateway_id`,
    params
  );
}

async function get(gatewayId) {
  const rows = await list({});
  return rows.find((g) => g.gateway_id === gatewayId) || null;
}

async function getOrFail(gatewayId) {
  const gateway = await get(gatewayId);
  if (!gateway) throw notFound(`Gateway ${gatewayId} not found`);
  return gateway;
}

async function ensureExists(gatewayId, { seenAt = new Date() } = {}) {
  if (!gatewayId) return null;
  return db.one(
    `INSERT INTO gateways (gateway_id, name, status, first_seen_at, last_seen_at, metadata)
     VALUES ($1, $1, 'online', $2, $2, jsonb_build_object('auto_registered', true))
     ON CONFLICT (gateway_id) DO UPDATE
       SET first_seen_at = COALESCE(gateways.first_seen_at, EXCLUDED.first_seen_at)
     RETURNING ${GATEWAY_COLUMNS}`,
    [gatewayId, seenAt]
  );
}

async function markSeen(gatewayId, { seenAt = new Date(), firmwareVersion = null } = {}) {
  if (!gatewayId) return null;
  return db.one(
    `UPDATE gateways
        SET last_seen_at = GREATEST(COALESCE(last_seen_at, $2), $2),
            first_seen_at = COALESCE(first_seen_at, $2),
            firmware_version = COALESCE($3, firmware_version),
            status = 'online'
      WHERE gateway_id = $1
      RETURNING gateway_id, status, last_seen_at`,
    [gatewayId, seenAt, firmwareVersion]
  );
}

async function setStatus(gatewayId, status) {
  return db.one(
    `UPDATE gateways SET status = $2 WHERE gateway_id = $1 AND status IS DISTINCT FROM $2
     RETURNING gateway_id, status, last_seen_at`,
    [gatewayId, status]
  );
}

async function findStale(seconds = config.liveness.gatewayOfflineAfterSeconds) {
  return db.many(
    `SELECT gateway_id, status, last_seen_at,
            EXTRACT(EPOCH FROM (now() - last_seen_at))::int AS seconds_since_seen
       FROM gateways
      WHERE status NOT IN ('offline','maintenance')
        AND (last_seen_at IS NULL OR last_seen_at < now() - make_interval(secs => $1))`,
    [seconds]
  );
}

module.exports = { list, get, getOrFail, ensureExists, markSeen, setStatus, findStale };
