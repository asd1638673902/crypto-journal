/**
 * 引擎客户端 — 前端与后端引擎服务的通信层
 *
 * 通过 WebSocket 接收实时数据
 * 通过 HTTP API 查询/控制
 */

const ENGINE_URL = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001';

// ==================== HTTP API ====================

async function api<T>(path: string, method: string = 'GET', body?: any): Promise<T> {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${method} ${path}: ${res.status}`);
  return res.json();
}

export const engineApi = {
  getState: () => api<any>('/api/state'),
  getAccount: () => api<any>('/api/account'),
  getPositions: () => api<any>('/api/positions'),
  getHistory: () => api<any>('/api/history'),
  getLogs: () => api<any>('/api/logs'),
  startEngine: () => api<any>('/api/engine/start', 'POST'),
  stopEngine: () => api<any>('/api/engine/stop', 'POST'),
  resetAccount: () => api<any>('/api/account/reset', 'POST'),
  closePosition: (id: string, price?: number) =>
    api<any>('/api/position/close', 'POST', { id, price }),
};

// ==================== WebSocket 客户端 ====================

type WSCallback = (data: any) => void;

let ws: WebSocket | null = null;
let wsConnected = false;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Map<string, Set<WSCallback>>();

function connectWS() {
  if (ws) return;
  try {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      wsConnected = true;
      console.log('[EngineWS] 已连接');
      notify('connection', { connected: true });
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type) notify(msg.type, msg.data);
      } catch {}
    };
    ws.onclose = () => {
      wsConnected = false;
      ws = null;
      notify('connection', { connected: false });
      scheduleReconnect();
    };
    ws.onerror = () => { ws?.close(); };
  } catch {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWS();
  }, 5000);
}

function notify(type: string, data: any) {
  const cbs = listeners.get(type);
  if (cbs) cbs.forEach((cb) => cb(data));
  // 也通知通配符监听器
  const all = listeners.get('*');
  if (all) all.forEach((cb) => cb({ type, data }));
}

export const engineWS = {
  /** 连接 */
  connect: connectWS,

  /** 断开 */
  disconnect: () => {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { ws.close(); ws = null; }
    wsConnected = false;
  },

  /** 监听消息类型 */
  on: (type: string, cb: WSCallback) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(cb);
    return () => listeners.get(type)?.delete(cb); // 返回取消监听函数
  },

  /** 连接状态 */
  isConnected: () => wsConnected,
};
