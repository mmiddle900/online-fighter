const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
app.use(express.static(path.join(__dirname, 'public')));

function newCode() {
  let code;
  do { code = Array.from({length: 6}, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
function relay(room, sender, message) {
  for (const player of room.players) if (player !== sender) send(player, message);
}

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'create') {
      if (ws.room) return send(ws, {type:'error', message:'이미 방에 참가 중입니다.'});
      const code = newCode();
      const maxPlayers = Number(msg.maxPlayers) === 3 ? 3 : 2;
      const room = {code, players:[ws], host:ws, maxPlayers};
      rooms.set(code, room);
      ws.room = room;
      ws.role = 'host';
      return send(ws, {type:'created', code, role:'host', maxPlayers, count:1});
    }

    if (msg.type === 'join') {
      if (ws.room) return send(ws, {type:'error', message:'이미 방에 참가 중입니다.'});
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = rooms.get(code);
      if (!room) return send(ws, {type:'error', message:'방을 찾을 수 없습니다. 코드를 확인하세요.'});
      if (room.players.length >= room.maxPlayers) return send(ws, {type:'error', message:room.maxPlayers+'인 방이 가득 찼습니다.'});
      const existingPlayers = room.players.slice();
      room.players.push(ws);
      ws.room = room;
      ws.role = 'guest';
      ws.playerIndex = room.players.length;
      send(ws, {type:'joined', code, role:'guest', playerIndex:ws.playerIndex, maxPlayers:room.maxPlayers, count:room.players.length});
      for (const player of existingPlayers) send(player, {type:'peer-joined', playerIndex:ws.playerIndex, count:room.players.length, maxPlayers:room.maxPlayers});
      return;
    }

    const room = ws.room;
    if (!room) return;
    if (msg.type === 'input') {
      if (ws.role === 'host') return;
      return send(room.host, {...msg, playerIndex:ws.playerIndex});
    }
    if (['state','rematch'].includes(msg.type)) relay(room, ws, msg);
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    // 연결이 끊긴 플레이어가 남긴 방 참조를 모두 정리해 재입장을 막지 않도록 한다.
    rooms.delete(room.code);
    for (const player of room.players) {
      if (player === ws) continue;
      player.room = null;
      player.role = null;
      player.playerIndex = null;
      send(player, {type:'peer-left', message:'상대 플레이어의 연결이 끊어졌습니다. 새 방을 만들거나 다시 참가하세요.'});
    }
    room.players.length = 0;
    ws.room = null;
    ws.role = null;
    ws.playerIndex = null;
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`ONLINE FIGHTER listening on ${port}`));
