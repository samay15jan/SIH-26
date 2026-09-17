'use strict';

const logger = require('../utils/logger');

const CHANNELS = ['telemetry', 'node_status', 'gateway_status', 'event', 'alert', 'prediction', 'system'];

const clients = new Set();
let counter = 0;

function register(socket, meta = {}) {
  counter += 1;
  const client = {
    id: `ws-${counter}`,
    socket,
    channels: new Set(CHANNELS),
    nodes: null,
    alive: true,
    connectedAt: new Date().toISOString(),
    ...meta
  };
  clients.add(client);
  return client;
}

function unregister(client) {
  clients.delete(client);
}

function applySubscription(client, payload) {
  if (Array.isArray(payload.channels) && payload.channels.length) {
    client.channels = new Set(payload.channels.filter((c) => CHANNELS.includes(c)));
  } else if (payload.channels === 'all') {
    client.channels = new Set(CHANNELS);
  }
  if (Array.isArray(payload.nodes) && payload.nodes.length) {
    client.nodes = new Set(payload.nodes);
  } else if (payload.nodes === 'all' || payload.nodes === null) {
    client.nodes = null;
  }
  return {
    channels: [...client.channels],
    nodes: client.nodes ? [...client.nodes] : 'all'
  };
}

function send(client, message) {
  try {
    if (client.socket.readyState === 1) client.socket.send(JSON.stringify(message));
  } catch (err) {
    logger.warn('websocket send failed', { client: client.id, error: err.message });
  }
}

function broadcast(channel, data, options = {}) {
  const message = {
    type: channel,
    ts: new Date().toISOString(),
    data
  };
  const nodeId = options.nodeId || (data && data.node_id) || null;
  let delivered = 0;
  for (const client of clients) {
    if (!client.channels.has(channel)) continue;
    if (client.nodes && nodeId && !client.nodes.has(nodeId)) continue;
    send(client, message);
    delivered += 1;
  }
  return delivered;
}

function stats() {
  return {
    clients: clients.size,
    channels: CHANNELS,
    connections: [...clients].map((c) => ({
      id: c.id,
      connectedAt: c.connectedAt,
      channels: [...c.channels],
      nodes: c.nodes ? [...c.nodes] : 'all'
    }))
  };
}

module.exports = { CHANNELS, register, unregister, applySubscription, send, broadcast, stats, clients };
