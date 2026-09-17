'use strict';

const config = require('../config');
const { parseTimestamp, toInt, badRequest } = require('../utils/helpers');

function timeRange(query) {
  const start = query.start || query.from || query.since;
  const end = query.end || query.to || query.until;

  const parsedStart = start ? parseTimestamp(start) : null;
  const parsedEnd = end ? parseTimestamp(end) : null;

  if (start && !parsedStart) throw badRequest('Invalid start timestamp');
  if (end && !parsedEnd) throw badRequest('Invalid end timestamp');
  if (parsedStart && parsedEnd && parsedStart > parsedEnd) throw badRequest('start must be before end');

  return { start: parsedStart, end: parsedEnd };
}

function paging(query, defaultLimit = 100, maxLimit = 1000) {
  const limit = toInt(query.limit);
  const offset = toInt(query.offset);
  return {
    limit: limit && limit > 0 ? Math.min(limit, maxLimit) : defaultLimit,
    offset: offset && offset > 0 ? offset : 0
  };
}

function telemetryFilters(query) {
  const { start, end } = timeRange(query);
  const { limit, offset } = paging(query, 200, config.telemetry.maxLimit);
  const nodeIds = query.nodes
    ? String(query.nodes).split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  return {
    nodeId: query.node || query.nodeId || null,
    nodeIds,
    gatewayId: query.gateway || query.gatewayId || null,
    start,
    end,
    limit,
    offset,
    order: query.order === 'asc' ? 'asc' : 'desc',
    metrics: query.metrics ? String(query.metrics).split(',').map((s) => s.trim()).filter(Boolean) : null,
    bucketSeconds: toInt(query.bucket || query.interval) || null
  };
}

module.exports = { timeRange, paging, telemetryFilters };
