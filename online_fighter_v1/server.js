const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req,res)=>res.json({status:'ok',project:'rpg-game'}));

const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized:false } : undefined
}) : null;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'rpg_session';
let schemaPromise;
async function ready() {
  if (!pool) throw new Error('DB_NOT_CONFIGURED');
  if (!schemaPromise) schemaPromise = (async()=>{
    await pool.query(`CREATE TABLE IF NOT EXISTS game_accounts (
      id BIGSERIAL PRIMARY KEY, username VARCHAR(24) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS player_data (
      account_id BIGINT PRIMARY KEY REFERENCES game_accounts(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  })();
  await schemaPromise;
}
const validName=n=>typeof n==='string'&&/^[a-zA-Z0-9_]{3,24}$/.test(n);
function derive(p,s){return new Promise((resolve,reject)=>crypto.scrypt(p,s,64,(e,k)=>e?reject(e):resolve(k.toString('hex'))));}
function sign(payload){const body=Buffer.from(JSON.stringify(payload)).toString('base64url');const sig=crypto.createHmac('sha256',SESSION_SECRET).update(body).digest('base64url');return body+'.'+sig;}
function readSession(req){
  const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
  if(!raw)return null;
  const token=decodeURIComponent(raw.slice(COOKIE.length+1)),parts=token.split('.');
  if(parts.length!==2)return null;
  const expected=crypto.createHmac('sha256',SESSION_SECRET).update(parts[0]).digest();
  let actual;try{actual=Buffer.from(parts[1],'base64url');}catch(_){return null;}
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;
  try{const data=JSON.parse(Buffer.from(parts[0],'base64url').toString());if(!data.exp||data.exp<Date.now()||!data.id)return null;return data;}catch(_){return null;}
}
function setSession(res,account){
  const token=sign({id:String(account.id),username:account.username,exp:Date.now()+7*24*60*60*1000});
  res.setHeader('Set-Cookie',COOKIE+'='+encodeURIComponent(token)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800');
}
function clearSession(res){res.setHeader('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');}
function requireAccount(req,res,next){const session=readSession(req);if(!session)return res.status(401).json({error:'로그인이 필요합니다.'});req.account=session;next();}

app.post('/api/account/register',async(req,res)=>{
  const {username,password}=req.body||{};
  if(!validName(username))return res.status(400).json({error:'아이디는 영문, 숫자, 밑줄 3~24자로 입력하세요.'});
  if(typeof password!=='string'||password.length<8||password.length>128)return res.status(400).json({error:'비밀번호는 8~128자로 입력하세요.'});
  try{
    await ready();const salt=crypto.randomBytes(16).toString('hex');const hash=await derive(password,salt);
    const q=await pool.query('INSERT INTO game_accounts(username,password_hash,password_salt) VALUES($1,$2,$3) RETURNING id,username',[username,hash,salt]);
    await pool.query('INSERT INTO player_data(account_id,data) VALUES($1,$2)',[q.rows[0].id,JSON.stringify({level:1,exp:0,gold:0,location:{map:'start',x:0,y:0},inventory:[],quests:{}})]);
    setSession(res,q.rows[0]);res.status(201).json(q.rows[0]);
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'이미 사용 중인 아이디입니다.'});if(e.message==='DB_NOT_CONFIGURED')return res.status(503).json({error:'계정 데이터베이스 연결 설정이 필요합니다.'});console.error('register error',e.message);res.status(500).json({error:'계정 생성 실패'});}
});
app.post('/api/account/login',async(req,res)=>{
  const {username,password}=req.body||{};
  if(!validName(username)||typeof password!=='string'||password.length>128)return res.status(400).json({error:'아이디 또는 비밀번호를 확인하세요.'});
  try{
    await ready();const q=await pool.query('SELECT id,username,password_hash,password_salt FROM game_accounts WHERE username=$1',[username]);
    if(!q.rowCount)return res.status(401).json({error:'아이디 또는 비밀번호가 올바르지 않습니다.'});
    const u=q.rows[0],a=Buffer.from(await derive(password,u.password_salt),'hex'),b=Buffer.from(u.password_hash,'hex');
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'아이디 또는 비밀번호가 올바르지 않습니다.'});
    setSession(res,u);res.json({id:u.id,username:u.username});
  }catch(e){if(e.message==='DB_NOT_CONFIGURED')return res.status(503).json({error:'계정 데이터베이스 연결 설정이 필요합니다.'});console.error('login error',e.message);res.status(500).json({error:'로그인 실패'});}
});
app.get('/api/account/me',requireAccount,(req,res)=>res.json({id:req.account.id,username:req.account.username}));
app.post('/api/account/logout',(req,res)=>{clearSession(res);res.json({ok:true});});
app.get('/api/player-data',requireAccount,async(req,res)=>{
  try{await ready();const q=await pool.query('SELECT data,updated_at FROM player_data WHERE account_id=$1',[req.account.id]);if(!q.rowCount)return res.status(404).json({error:'플레이어 데이터가 없습니다.'});res.json({data:q.rows[0].data,updatedAt:q.rows[0].updated_at});}
  catch(e){console.error('load player data',e.message);res.status(500).json({error:'저장 데이터 불러오기 실패'});}
});
app.put('/api/player-data',requireAccount,async(req,res)=>{
  const data=req.body?.data;
  if(!data||typeof data!=='object'||Array.isArray(data))return res.status(400).json({error:'저장 데이터 형식이 올바르지 않습니다.'});
  const allowed=['level','exp','gold','location','inventory','quests'];
  if(Object.keys(data).some(k=>!allowed.includes(k)))return res.status(400).json({error:'허용되지 않은 저장 항목입니다.'});
  const serialized=JSON.stringify(data);if(Buffer.byteLength(serialized)>24000)return res.status(413).json({error:'저장 데이터가 너무 큽니다.'});
  try{await ready();const q=await pool.query(`INSERT INTO player_data(account_id,data,updated_at) VALUES($1,$2::jsonb,NOW())
    ON CONFLICT(account_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW() RETURNING updated_at`,[req.account.id,serialized]);res.json({ok:true,updatedAt:q.rows[0].updated_at});}
  catch(e){console.error('save player data',e.message);res.status(500).json({error:'저장 실패'});}
});
wss.on('connection',socket=>socket.send(JSON.stringify({type:'connected'})));
const port=process.env.PORT||3000;server.listen(port,'0.0.0.0',()=>console.log('RPG server listening on '+port));
