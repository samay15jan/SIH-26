'use strict';

const analyticsService = require('../services/analytics');
const alertsService = require('../services/alerts');
const eventsService = require('../services/events');
const telemetryService = require('../services/telemetry');
const { telemetryFilters } = require('./filters');
const { toInt } = require('../utils/helpers');

async function routes(app) {
  app.get('/analytics/overview', async (request) => {
    const hours = toInt(request.query.hours) || 24;
    return { data: await analyticsService.overview({ hours }) };
  });

  app.get('/analytics/nodes/health', async () => {
    const data = await analyticsService.nodeHealth();
    return { count: data.length, data };
  });

  app.get('/analytics/nodes/latest', async (request) => {
    const data = await telemetryService.latestAll({
      gatewayId: request.query.gateway || request.query.gatewayId,
      zoneId: request.query.zone || request.query.zoneId
    });
    return { count: data.length, data };
  });

  app.get('/analytics/sensors/status', async () => ({ data: await analyticsService.sensorStatus() }));

  app.get('/analytics/alerts/summary', async (request) => {
    const hours = toInt(request.query.hours) || 24;
    const [summary, timeline] = await Promise.all([
      alertsService.summary({ hours }),
      analyticsService.alertTimeline({ hours, bucketHours: toInt(request.query.bucket_hours) || 1 })
    ]);
    return { data: { ...summary, timeline } };
  });

  app.get('/analytics/events/summary', async (request) => {
    const hours = toInt(request.query.hours) || 24;
    const data = await eventsService.summary({ hours });
    return { window_hours: hours, data: data.map((r) => ({ ...r, count: Number(r.count) })) };
  });

  app.get('/analytics/anomalies/summary', async (request) => {
    const predictionsService = require('../services/predictions');
    const hours = toInt(request.query.hours) || 24;
    const data = await predictionsService.anomalySummary({ hours });
    return { window_hours: hours, data };
  });

  app.get('/analytics/telemetry/summary', async (request) => {
    const filters = telemetryFilters(request.query);
    return { data: await telemetryService.summary(filters) };
  });

  app.get('/analytics/telemetry/trends', async (request) => {
    const filters = telemetryFilters(request.query);
    const bucketSeconds = filters.bucketSeconds || 3600;
    const data = await telemetryService.trend({ ...filters, bucketSeconds });
    return { bucket_seconds: bucketSeconds, count: data.length, data };
  });

  app.get('/analytics/zones/risk', async () => {
    const data = await analyticsService.zoneRisk();
    return { count: data.length, data };
  });

  app.get('/analytics/ingestion', async (request) => {
    const hours = toInt(request.query.hours) || 24;
    return { data: await analyticsService.ingestionStats({ hours }) };
  });
}

module.exports = routes;
