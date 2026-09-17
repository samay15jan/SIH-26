'use strict';

const predictionsService = require('../services/predictions');
const { timeRange, paging } = require('./filters');
const { badRequest, toInt } = require('../utils/helpers');

async function routes(app) {
  app.get('/predictions', async (request) => {
    const { start, end } = timeRange(request.query);
    const { limit } = paging(request.query);
    const data = await predictionsService.list({
      nodeId: request.query.node || request.query.nodeId,
      predictionType: request.query.type,
      modelName: request.query.model,
      severity: request.query.severity,
      start,
      end,
      limit
    });
    return { count: data.length, data };
  });

  app.get('/predictions/latest', async () => {
    const data = await predictionsService.latestPerNode();
    return { count: data.length, data };
  });

  app.get('/predictions/:id', async (request) => {
    const id = toInt(request.params.id);
    if (!id) throw badRequest('Invalid prediction id');
    return { data: await predictionsService.get(id) };
  });

  app.post('/predictions', async (request, reply) => {
    const body = request.body || {};
    if (Array.isArray(body)) {
      const data = await predictionsService.createBatch(body);
      reply.code(201);
      return { count: data.length, data };
    }
    if (Array.isArray(body.predictions)) {
      const data = await predictionsService.createBatch(body.predictions);
      reply.code(201);
      return { count: data.length, data };
    }
    const data = await predictionsService.create(body);
    reply.code(201);
    return { data };
  });

  app.get('/anomalies', async (request) => {
    const { start, end } = timeRange(request.query);
    const { limit } = paging(request.query);
    const data = await predictionsService.listAnomalies({
      nodeId: request.query.node || request.query.nodeId,
      anomalyType: request.query.type,
      start,
      end,
      limit
    });
    return { count: data.length, data };
  });

  app.get('/anomalies/summary', async (request) => {
    const hours = toInt(request.query.hours) || 24;
    const data = await predictionsService.anomalySummary({ hours });
    return { window_hours: hours, count: data.length, data };
  });

  app.post('/anomalies', async (request, reply) => {
    const data = await predictionsService.createAnomaly(request.body || {});
    reply.code(201);
    return { data };
  });

  app.get('/risk-assessments', async (request) => {
    const { limit } = paging(request.query);
    const data = await predictionsService.listRiskAssessments({
      nodeId: request.query.node || request.query.nodeId,
      riskLevel: request.query.level,
      limit
    });
    return { count: data.length, data };
  });

  app.post('/risk-assessments', async (request, reply) => {
    const data = await predictionsService.createRiskAssessment(request.body || {});
    reply.code(201);
    return { data };
  });
}

module.exports = routes;
