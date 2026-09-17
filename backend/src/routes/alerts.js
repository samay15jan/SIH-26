'use strict';

const alertsService = require('../services/alerts');
const rules = require('../rules/engine');
const { timeRange, paging } = require('./filters');
const { badRequest, toInt } = require('../utils/helpers');

async function routes(app) {
  app.get('/alerts', async (request) => {
    const { start, end } = timeRange(request.query);
    const { limit, offset } = paging(request.query);
    const data = await alertsService.list({
      nodeId: request.query.node || request.query.nodeId,
      gatewayId: request.query.gateway || request.query.gatewayId,
      status: request.query.status,
      severity: request.query.severity,
      alertType: request.query.type || request.query.alertType,
      source: request.query.source,
      active: request.query.active === 'true',
      start,
      end,
      limit,
      offset
    });
    return { count: data.length, limit, offset, data };
  });

  app.get('/alerts/summary', async (request) => {
    const hours = toInt(request.query.hours) || 24;
    return { data: await alertsService.summary({ hours }) };
  });

  app.get('/alerts/:id', async (request) => {
    const id = toInt(request.params.id);
    if (!id) throw badRequest('Invalid alert id');
    return { data: await alertsService.get(id) };
  });

  app.patch('/alerts/:id', async (request) => {
    const id = toInt(request.params.id);
    if (!id) throw badRequest('Invalid alert id');
    const body = request.body || {};
    if (!body.status) throw badRequest('status is required (active, acknowledged or resolved)');
    const data = await alertsService.updateStatus(id, {
      status: body.status,
      by: body.by || body.user || 'operator',
      note: body.note || null
    });
    return { data };
  });

  app.post('/alerts', async (request, reply) => {
    const body = request.body || {};
    if (!body.alert_type) throw badRequest('alert_type is required');
    if (!body.message) throw badRequest('message is required');
    const { alert, created } = await alertsService.raise({
      node_id: body.node_id,
      gateway_id: body.gateway_id,
      alert_type: body.alert_type,
      severity: body.severity || 'warning',
      message: body.message,
      risk_score: body.risk_score,
      source: body.source || 'manual',
      rule_key: body.rule_key,
      metadata: body.metadata || {},
      created_by: body.created_by || 'operator'
    });
    reply.code(created ? 201 : 200);
    return { data: alert, created };
  });

  app.get('/rules', async () => {
    const data = await rules.listRules();
    return { count: data.length, data };
  });

  app.patch('/rules/:ruleKey', async (request) => {
    const data = await rules.updateRule(request.params.ruleKey, request.body || {});
    if (!data) throw badRequest(`Unknown rule ${request.params.ruleKey}`);
    return { data };
  });
}

module.exports = routes;
