'use strict';

const nodesService = require('../services/nodes');
const telemetryService = require('../services/telemetry');
const eventsService = require('../services/events');
const alertsService = require('../services/alerts');
const predictionsService = require('../services/predictions');
const { telemetryFilters, timeRange, paging } = require('./filters');
const { notFound } = require('../utils/helpers');

async function routes(app) {
  app.get('/nodes', async (request) => {
    const q = request.query;
    const data = await nodesService.list({
      status: q.status,
      gatewayId: q.gateway || q.gatewayId,
      siteId: q.site || q.siteId,
      zoneId: q.zone || q.zoneId,
      search: q.search
    });
    return { count: data.length, data };
  });

  app.get('/nodes/:nodeId', async (request) => {
    const node = await nodesService.getOrFail(request.params.nodeId);
    const [sensors, latest, openAlerts] = await Promise.all([
      nodesService.sensors(node.node_id),
      telemetryService.latestForNode(node.node_id),
      alertsService.list({ nodeId: node.node_id, active: true, limit: 20 })
    ]);
    return { data: { ...node, sensors, latest_telemetry: latest, open_alerts: openAlerts } };
  });

  app.patch('/nodes/:nodeId', async (request) => {
    const node = await nodesService.update(request.params.nodeId, request.body || {});
    return { data: node };
  });

  app.get('/nodes/:nodeId/telemetry', async (request) => {
    await nodesService.getOrFail(request.params.nodeId);
    const filters = { ...telemetryFilters(request.query), nodeId: request.params.nodeId, nodeIds: null };
    const data = await telemetryService.history(filters);
    return {
      count: data.length,
      node_id: request.params.nodeId,
      range: { start: filters.start, end: filters.end },
      data
    };
  });

  app.get('/nodes/:nodeId/telemetry/latest', async (request) => {
    await nodesService.getOrFail(request.params.nodeId);
    const data = await telemetryService.latestForNode(request.params.nodeId);
    if (!data) throw notFound(`No telemetry for node ${request.params.nodeId}`);
    return { data };
  });

  app.get('/nodes/:nodeId/telemetry/summary', async (request) => {
    await nodesService.getOrFail(request.params.nodeId);
    const filters = { ...telemetryFilters(request.query), nodeId: request.params.nodeId, nodeIds: null };
    return { data: await telemetryService.summary(filters) };
  });

  app.get('/nodes/:nodeId/telemetry/trend', async (request) => {
    await nodesService.getOrFail(request.params.nodeId);
    const filters = { ...telemetryFilters(request.query), nodeId: request.params.nodeId, nodeIds: null };
    return { data: await telemetryService.trend({ ...filters, bucketSeconds: filters.bucketSeconds || 3600 }) };
  });

  app.get('/nodes/:nodeId/events', async (request) => {
    await nodesService.getOrFail(request.params.nodeId);
    const { start, end } = timeRange(request.query);
    const { limit, offset } = paging(request.query);
    const data = await eventsService.list({
      nodeId: request.params.nodeId,
      eventType: request.query.type,
      severity: request.query.severity,
      start,
      end,
      limit,
      offset
    });
    return { count: data.length, data };
  });

  app.get('/nodes/:nodeId/alerts', async (request) => {
    await nodesService.getOrFail(request.params.nodeId);
    const { limit, offset } = paging(request.query);
    const data = await alertsService.list({
      nodeId: request.params.nodeId,
      status: request.query.status,
      severity: request.query.severity,
      active: request.query.active === 'true',
      limit,
      offset
    });
    return { count: data.length, data };
  });

  app.get('/nodes/:nodeId/predictions', async (request) => {
    await nodesService.getOrFail(request.params.nodeId);
    const { start, end } = timeRange(request.query);
    const { limit } = paging(request.query);
    const data = await predictionsService.list({
      nodeId: request.params.nodeId,
      predictionType: request.query.type,
      modelName: request.query.model,
      start,
      end,
      limit
    });
    return { count: data.length, data };
  });

  app.get('/nodes/:nodeId/anomalies', async (request) => {
    await nodesService.getOrFail(request.params.nodeId);
    const { start, end } = timeRange(request.query);
    const { limit } = paging(request.query);
    const data = await predictionsService.listAnomalies({
      nodeId: request.params.nodeId,
      anomalyType: request.query.type,
      start,
      end,
      limit
    });
    return { count: data.length, data };
  });

  app.get('/nodes/:nodeId/sensors', async (request) => {
    await nodesService.getOrFail(request.params.nodeId);
    const data = await nodesService.sensors(request.params.nodeId);
    return { count: data.length, data };
  });
}

module.exports = routes;
