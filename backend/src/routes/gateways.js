'use strict';

const gatewaysService = require('../services/gateways');
const nodesService = require('../services/nodes');
const eventsService = require('../services/events');
const { paging, timeRange } = require('./filters');

async function routes(app) {
  app.get('/gateways', async (request) => {
    const data = await gatewaysService.list({
      status: request.query.status,
      siteId: request.query.site || request.query.siteId
    });
    return { count: data.length, data };
  });

  app.get('/gateways/:gatewayId', async (request) => {
    const gateway = await gatewaysService.getOrFail(request.params.gatewayId);
    const nodes = await nodesService.list({ gatewayId: gateway.gateway_id });
    return { data: { ...gateway, nodes } };
  });

  app.get('/gateways/:gatewayId/nodes', async (request) => {
    await gatewaysService.getOrFail(request.params.gatewayId);
    const data = await nodesService.list({ gatewayId: request.params.gatewayId });
    return { count: data.length, data };
  });

  app.get('/gateways/:gatewayId/events', async (request) => {
    await gatewaysService.getOrFail(request.params.gatewayId);
    const { start, end } = timeRange(request.query);
    const { limit, offset } = paging(request.query);
    const data = await eventsService.list({
      gatewayId: request.params.gatewayId,
      start,
      end,
      limit,
      offset
    });
    return { count: data.length, data };
  });
}

module.exports = routes;
