const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok', project: 'jinsoo-dungeon' }));

const rooms = new Map();
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let code;
  do { code = Array.from({length:6}, () => codeChars[Math.floor(Math.random()*codeChars.length)]).join(''); } while (rooms.has(code));
  return code;
}
function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function publicRoom(room) {
  return { code: room.code, host: room.host, started: room.started, players: [...room.players.values()].map(p => ({id:p.id,name:p.name,character:p.character,ready:p.ready,host:p.id===room.host})) };
}
function broadcast(room, data) {
  const payload = JSON.stringify(data);
  for (const p of room.players.values()) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload);
}
function updateRoom(room) { broadcast(room, {type:'room-update', room:publicRoom(room)}); }
function removePlayer(ws) {
  const code = ws.roomCode, id = ws.playerId;
  if (!code || !id) return;
  const room = rooms.get(code);
  if (!room) return;
  room.players.delete(id);
  if (!room.players.size) { rooms.delete(code); return; }
  if (room.host === id) room.host = room.players.keys().next().value;
  updateRoom(room);
  broadcast(room, {type:'player-left', id});
}
wss.on('connection', ws => {
  ws.id = crypto.randomUUID();
  send(ws, {type:'connected', id:ws.id});
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'create-room') {
      if (ws.roomCode) removePlayer(ws);
      const code = makeCode();
      const room = {code,host:ws.id,started:false,players:new Map()};
      room.players.set(ws.id,{id:ws.id,ws,name:'김진수',character:'jinsoo',ready:false});
      rooms.set(code,room); ws.roomCode=code;ws.playerId=ws.id;
      send(ws,{type:'room-created',room:publicRoom(room),id:ws.id});
      updateRoom(room); return;
    }
    if (msg.type === 'join-room') {
      const code = String(msg.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
      const room = rooms.get(code);
      if (!room) return send(ws,{type:'error',message:'방 코드를 찾을 수 없습니다.'});
      if (room.started) return send(ws,{type:'error',message:'이미 던전이 시작된 방입니다.'});
      if (room.players.size >= 6) return send(ws,{type:'error',message:'방 인원이 가득 찼습니다. (최대 6명)'});
      if (ws.roomCode) removePlayer(ws);
      room.players.set(ws.id,{id:ws.id,ws,name:'김진수',character:'jinsoo',ready:false});
      ws.roomCode=code;ws.playerId=ws.id;
      send(ws,{type:'joined-room',room:publicRoom(room),id:ws.id});updateRoom(room);return;
    }
    const room=rooms.get(ws.roomCode);
    if (!room) return;
    const player=room.players.get(ws.playerId);
    if (!player) return;
    if (msg.type==='choose-character') {
      player.character='jinsoo'; player.ready=false; updateRoom(room); return;
    }
    if (msg.type==='ready') { player.ready=!!msg.ready; updateRoom(room); return; }
    if (msg.type==='start-dungeon') {
      if (room.host!==player.id) return send(ws,{type:'error',message:'던전 입장은 방장만 시작할 수 있습니다.'});
      if ([...room.players.values()].some(p=>!p.ready)) return send(ws,{type:'error',message:'모든 플레이어가 캐릭터 선택 후 준비 완료해야 합니다.'});
      room.started=true; room.seed=crypto.randomInt(1,2147483647);
      broadcast(room,{type:'dungeon-start',seed:room.seed,room:publicRoom(room)});return;
    }
    if (msg.type==='game-state' && room.started) {
      const state=msg.state;
      if (!state || !Number.isFinite(state.x) || !Number.isFinite(state.y)) return;
      broadcast(room,{type:'remote-state',id:player.id,name:player.name,state:{x:Math.max(0,Math.min(1,state.x)),y:Math.max(0,Math.min(1,state.y)),hp:Math.max(0,Math.min(250,Number(state.hp)||0)),face:Number.isFinite(state.face)?Math.max(-Math.PI,Math.min(Math.PI,state.face)):0,attack:!!state.attack}});
      return;
    }
    if (msg.type==='game-event' && room.started) {
      if (!['room-clear','room-enter','enemy-hit','enemy-killed','xp'].includes(msg.event)) return;
      broadcast(room,{type:'game-event',id:player.id,event:msg.event,data:msg.data||{}});
    }
  });
  ws.on('close',()=>removePlayer(ws));
  ws.on('error',()=>removePlayer(ws));
});
const port=process.env.PORT||3000;
server.listen(port,'0.0.0.0',()=>console.log('Jinsoo Dungeon server listening on '+port));
