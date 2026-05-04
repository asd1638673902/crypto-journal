/**
 * WebSocket Server + HTTP API — 前端通信层
 * - WS: 推送到前端（实时信号/状态/日志）
 * - HTTP: 前端查询（账户/持仓/历史）
 */
import http from 'node:http';
import { WebSocketServer, WebSocket as WS } from 'ws';
import express from 'express';
import cors from 'cors';
import { readTable } from './db.js';
import { getAccount, getPositions, getHistory, initAccount, closePosition } from './account.js';
import { getState, startEngine, stopEngine, setWSServer } from './engine.js';

const PORT = 3001;

// Express
const app = express();
app.use(cors());
app.use(express.json());

// HTTP API
app.get('/api/account', (_req, res) => res.json(getAccount()));
app.get('/api/positions', (_req, res) => res.json(getPositions()));
app.get('/api/history', (_req, res) => res.json(getHistory().slice(0, 100)));
app.get('/api/state', (_req, res) => res.json(getState()));
app.get('/api/logs', (_req, res) => res.json(readTable('engine_logs').slice(0, 100)));

app.post('/api/engine/start', (_req, res) => { startEngine(); res.json({ success: true }); });
app.post('/api/engine/stop', (_req, res) => { stopEngine(); res.json({ success: true }); });
app.post('/api/account/reset', (_req, res) => { initAccount(10000); res.json({ success: true }); });
app.post('/api/position/close', (req, res) => {
  const { id, price } = req.body;
  const result = closePosition(id, price || 0);
  res.json(result || { error: 'not found' });
});

// HTTP Server
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocketServer({ server });
const clients = new Set<WS>();

wss.on('connection', (ws) => {
  clients.add(ws);
  // 推送初始状态
  ws.send(JSON.stringify({ type: 'state', data: getState() }));
  ws.send(JSON.stringify({ type: 'account', data: getAccount() }));
  ws.on('close', () => clients.delete(ws));
});

// 广播给所有前端
function broadcast(data: any) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WS.OPEN) {
      client.send(msg);
    }
  }
}

// 注册广播到引擎
setWSServer({ broadcast });

// 启动
server.listen(PORT, () => {
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  Crypto-Journal Engine Server`);
  console.log(`  WS/HTTP: http://localhost:${PORT}`);
  console.log(`  WS: ws://localhost:${PORT}`);
  console.log(`  Data: ${new URL('./data', import.meta.url).pathname}`);
  console.log(`═══════════════════════════════════════\n`);
});
