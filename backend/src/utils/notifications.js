const logger = require('./logger');

const clients = new Set();

function addClient(res) {
  clients.add(res);
  logger.info('SSE client connected', { clientCount: clients.size });
}

function removeClient(res) {
  clients.delete(res);
  logger.info('SSE client disconnected', { clientCount: clients.size });
}

function broadcast(event) {
  const data = JSON.stringify(event);
  logger.info('SSE broadcast', { type: event.type, clientCount: clients.size });
  for (const client of clients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

module.exports = { addClient, removeClient, broadcast };
