'use strict';

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const config = require('./config');
const { registerRoutes } = require('./routes');
const { registerWebsocket } = require('./websocket');
const logger = require('./utils/logger');

async function buildApp(options = {}) {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    ...options
  });

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']
  });

  await registerWebsocket(app);
  await registerRoutes(app);

  app.get('/', async () => ({
    name: 'Nirmaan Backend',
    description: 'Smart Mining Safety and Structural Monitoring',
    version: require('../package.json').version,
    endpoints: {
      health: '/api/health',
      nodes: '/api/nodes',
      gateways: '/api/gateways',
      telemetry: '/api/telemetry/latest',
      events: '/api/events',
      alerts: '/api/alerts',
      predictions: '/api/predictions',
      analytics: '/api/analytics/overview',
      websocket: '/ws'
    }
  }));

  app.setNotFoundHandler(async (request, reply) => {
    reply.code(404);
    return { error: 'not_found', message: `Route ${request.method} ${request.url} not found` };
  });

  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      logger.error('request failed', { url: request.url, method: request.method, error: error.message, stack: error.stack });
    } else {
      logger.warn('request rejected', { url: request.url, status, error: error.message });
    }
    reply.code(status);
    return {
      error: status >= 500 ? 'internal_error' : 'request_error',
      message: status >= 500 && config.env === 'production' ? 'Internal server error' : error.message,
      ...(error.details ? { details: error.details } : {})
    };
  });

  return app;
}

module.exports = { buildApp };
