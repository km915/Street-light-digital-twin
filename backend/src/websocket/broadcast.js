// src/websocket/broadcast.js
const WebSocket = require('ws');

let wss = null;

function init(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('React client connected via WebSocket');
    ws.on('close', () => console.log('React client disconnected'));
  });

  console.log('WebSocket server ready');
}

function broadcast(data) {
  if (!wss) return;

  const message = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

module.exports = { init, broadcast };