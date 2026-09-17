'use strict';

const websocketPlugin = require('@fastify/websocket');
const hub = require('./hub');
const logger = require('../utils/logger');

async function registerWebsocket(app) {
  await app.register(websocketPlugin, { options: { maxPayload: 1048576 } });

  app.get('/ws', { websocket: true }, (connection) => {
    const socket = connection.socket || connection;
    const client = hub.register(socket);
    logger.info('websocket connected', { client: client.id });

    hub.send(client, {
      type: 'welcome',
      ts: new Date().toISOString(),
      data: {
        clientId: client.id,
        channels: hub.CHANNELS,
        usage: 'send {"action":"subscribe","channels":["telemetry","alert"],"nodes":["NODE-001"]}'
      }
    });

    socket.on('message', (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (err) {
        hub.send(client, { type: 'error', ts: new Date().toISOString(), data: { message: 'invalid JSON' } });
        return;
      }
      if (payload.action === 'subscribe') {
        const applied = hub.applySubscription(client, payload);
        hub.send(client, { type: 'subscribed', ts: new Date().toISOString(), data: applied });
      } else if (payload.action === 'ping') {
        hub.send(client, { type: 'pong', ts: new Date().toISOString(), data: {} });
      } else {
        hub.send(client, { type: 'error', ts: new Date().toISOString(), data: { message: 'unknown action' } });
      }
    });

    socket.on('pong', () => {
      client.alive = true;
    });

    socket.on('close', () => {
      hub.unregister(client);
      logger.info('websocket disconnected', { client: client.id });
    });

    socket.on('error', (err) => {
      logger.warn('websocket error', { client: client.id, error: err.message });
      hub.unregister(client);
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of hub.clients) {
      if (!client.alive) {
        try {
          client.socket.terminate();
        } catch (err) {
          /* already gone */
        }
        hub.unregister(client);
        continue;
      }
      client.alive = false;
      try {
        client.socket.ping();
      } catch (err) {
        hub.unregister(client);
      }
    }
  }, 30000);
  heartbeat.unref();

  app.addHook('onClose', async () => clearInterval(heartbeat));
}

module.exports = { registerWebsocket, hub };
