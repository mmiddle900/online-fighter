const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const app = express(); const server = http.createServer(app); const wss = new WebSocket.Server({ server });
app.use(express.json({ limit: '10kb' })); app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req,res)=>res.json({status:'ok',project:'rpg-game'}));
const pool = process.env.DATABASE_URL ? new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('render.com')?{rejectUnauthorized:false}:undefined}) : null;
let schemaPromise;
async function ready(){ if(!pool) throw new Error('DB_NOT_CONFIGURED'); if(!schemaPromise) schemaPromise=pool.query('CREATE TABLE IF NOT EXISTS game_accounts (id BIGSERIAL PRIMARY KEY, username VARCHAR(24) UNIQUE NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'); await schemaPromise; }
const validName=n=>typeof n==='string'&&/^[a-zA-Z0-9_]{3,24}$/.test(n);
function derive(p,s){return new Promise((resolve,reject)=>crypto.scrypt(p,s,64,(e,k)=>e?reject(e):resolve(k.toString('hex'))));}
app.post('/api/account/register',async(req,res)=>{const {username,password}=req.body||{};if(!validName(username))return res.status(400).json({error:'아이디는 영문, 숫자, 밑줄 3~24자로 입력하세요.'});if(typeof password!=='string'||password.length<8||password.length>128)return res.status(400).json({error:'비밀번호는 8~128자로 입력하세요.'});try{await ready();const salt=crypto.randomBytes(16).toString('hex');const hash=await derive(password,salt);const q=await pool.query('INSERT INTO game_accounts(username,password_hash,password_salt) VALUES($1,$2,$3) RETURNING id,username',[username,hash,salt]);res.status(201).json(q.rows[0]);}catch(e){if(e.code==='23505')return res.status(409).json({error:'이미 사용 중인 아이디입니다.'});if(e.message==='DB_NOT_CONFIGURED')return res.status(503).json({error:'계정 데이터베이스 연결 설정이 필요합니다.'});console.error('register error',e.message);res.status(500).json({error:'계정 생성 실패'});}});
app.post('/api/account/login',async(req,res)=>{const {username,password}=req.body||{};if(!validName(username)||typeof password!=='string'||password.length>128)return res.status(400).json({error:'아이디 또는 비밀번호를 확인하세요.'});try{await ready();const q=await pool.query('SELECT id,username,password_hash,password_salt FROM game_accounts WHERE username=$1',[username]);if(!q.rowCount)return res.status(401).json({error:'아이디 또는 비밀번호가 올바르지 않습니다.'});const u=q.rows[0],a=Buffer.from(await derive(password,u.password_salt),'hex'),b=Buffer.from(u.password_hash,'hex');if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'아이디 또는 비밀번호가 올바르지 않습니다.'});res.json({id:u.id,username:u.username});}catch(e){if(e.message==='DB_NOT_CONFIGURED')return res.status(503).json({error:'계정 데이터베이스 연결 설정이 필요합니다.'});console.error('login error',e.message);res.status(500).json({error:'로그인 실패'});}});
wss.on('connection',socket=>socket.send(JSON.stringify({type:'connected'})));
const port=process.env.PORT||3000; server.listen(port,'0.0.0.0',()=>console.log('RPG server listening on '+port));
