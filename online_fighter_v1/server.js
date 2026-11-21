const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok', project: 'online-pvp' }));

wss.on('connection', socket => {
  socket.send(JSON.stringify({ type: 'connected' }));
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log('Online PVP server listening on ' + port));
