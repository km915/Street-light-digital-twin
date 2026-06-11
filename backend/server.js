const http    = require('http');
const app     = require('./src/app');
const { init: initWS } = require('./src/websocket/broadcast');
const { start: startEngine } = require('./src/twin/engine');
const { start: startRetrain } = require('./src/twin/retrainScheduler');
require('dotenv').config();

const PORT = process.env.PORT || 3001;

// create HTTP server from Express app
const server = http.createServer(app);

// attach WebSocket server to the same HTTP server
initWS(server);

// start listening, then start the twin engine
server.listen(PORT, async () => {
  console.log(`Express server running on http://localhost:${PORT}`);
  console.log('Starting twin engine...');

  await startEngine();

  startRetrain();
});