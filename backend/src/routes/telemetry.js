'use strict';

const telemetryService = require('../services/telemetry');
const { FIELDS, NUMERIC_METRICS } = require('../config/telemetryFields');
const { telemetryFilters } = require('./filters');

const CSV_COLUMNS = ['node_id', 'gateway_id', 'measured_at', 'received_at', 'sequence_number',
  ...FIELDS.filter((f) => f.type !== 'jsonb').map((f) => f.column)];

function toCsv(rows) {
  const header = CSV_COLUMNS.join(',');
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => {
    const value = row[col];
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(','));
  return [header, ...lines].join('\n');
}

async function routes(app) {
  app.get('/telemetry/latest', async (request) => {
    const data = await telemetryService.latestAll({
      nodeId: request.query.node || request.query.nodeId,
      gatewayId: request.query.gateway || request.query.gatewayId,
      zoneId: request.query.zone || request.query.zoneId
    });
    return { count: data.length, data };
  });

  app.get('/telemetry/history', async (request, reply) => {
    const filters = telemetryFilters(request.query);
    const data = await telemetryService.history(filters);

    if (request.query.format === 'csv') {
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="nirmaan-telemetry.csv"');
      return toCsv(data);
    }

    return {
      count: data.length,
      limit: filters.limit,
      offset: filters.offset,
      range: { start: filters.start, end: filters.end },
      data
    };
  });

  app.get('/telemetry/count', async (request) => {
    const filters = telemetryFilters(request.query);
    return { data: { total: await telemetryService.count(filters) } };
  });

  app.get('/telemetry/summary', async (request) => {
    const filters = telemetryFilters(request.query);
    return { data: await telemetryService.summary(filters) };
  });

  app.get('/telemetry/trend', async (request) => {
    const filters = telemetryFilters(request.query);
    const data = await telemetryService.trend({ ...filters, bucketSeconds: filters.bucketSeconds || 3600 });
    return { count: data.length, bucket_seconds: filters.bucketSeconds || 3600, data };
  });

  app.get('/telemetry/fields', async () => ({
    count: FIELDS.length,
    numeric_metrics: NUMERIC_METRICS,
    data: FIELDS.map((f) => ({ field: f.column, type: f.type, unit: f.unit, group: f.group, aliases: f.aliases }))
  }));
}

module.exports = routes;
