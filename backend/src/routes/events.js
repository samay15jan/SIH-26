'use strict';

const eventsService = require('../services/events');
const { timeRange, paging } = require('./filters');
const { badRequest, toInt } = require('../utils/helpers');

async function routes(app) {
  app.get('/events', async (request) => {
    const { start, end } = timeRange(request.query);
    const { limit, offset } = paging(request.query);
    const data = await eventsService.list({
      nodeId: request.query.node || request.query.nodeId,
      gatewayId: request.query.gateway || request.query.gatewayId,
      eventType: request.query.type || request.query.eventType,
      severity: request.query.severity,
      source: request.query.source,
      start,
      end,
      limit,
      offset
    });
    return { count: data.length, limit, offset, data };
  });

  app.get('/events/summary', async (request) => {
    const hours = toInt(request.query.hours) || 24;
    const data = await eventsService.summary({ hours });
    return { window_hours: hours, data: data.map((r) => ({ ...r, count: Number(r.count) })) };
  });

  app.get('/events/:id', async (request) => {
    const id = toInt(request.params.id);
    if (!id) throw badRequest('Invalid event id');
    return { data: await eventsService.get(id) };
  });

  app.post('/events', async (request, reply) => {
    const body = request.body || {};
    if (!body.event_type) throw badRequest('event_type is required');
    const data = await eventsService.create({
      node_id: body.node_id,
      gateway_id: body.gateway_id,
      event_type: body.event_type,
      severity: body.severity,
      source: body.source || 'manual',
      occurred_at: body.occurred_at ? new Date(body.occurred_at) : new Date(),
      message: body.message,
      details: body.details || {}
    });
    reply.code(201);
    return { data };
  });
}

module.exports = routes;
