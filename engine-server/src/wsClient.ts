/**
 * 币安 WebSocket 客户端 — 实时K线 + Ticker 数据
 * 不依赖任何第三方 WS 库，使用 Node.js 原生 WebSocket
 */

// Node.js 18+ 内置 WebSocket
import WebSocket from 'ws';

export type StreamCallback = (data: any) => void;

interface StreamSubscription {
  symbol: string;
  stream: string;
  cb: StreamCallback;
}

export class BinanceStreamClient {
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, StreamCallback[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private baseUrl = 'wss://fstream.binance.com/stream';
  private isConnected = false;

  connect(): void {
    if (this.ws) return;
    const streams = Array.from(this.subscriptions.keys()).join('/');
    const url = `${this.baseUrl}?streams=${streams}`;
    
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.isConnected = true;
      console.log(`[Binance WS] 已连接: ${this.subscriptions.size} 个订阅`);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data.toString());
        if (msg.stream && msg.data) {
          const cbs = this.subscriptions.get(msg.stream);
          if (cbs) cbs.forEach(cb => cb(msg.data));
        }
      } catch {}
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[Binance WS] 错误:', err.message);
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[Binance WS] 重连中...');
      this.connect();
    }, 5000);
  }

  subscribe(symbol: string, stream: string, cb: StreamCallback): void {
    const key = `${symbol.toLowerCase()}@${stream}`;
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, []);
    }
    this.subscriptions.get(key)!.push(cb);

    // 如果已连接，热添加订阅需要重连
    if (this.isConnected) {
      this.disconnect();
      this.connect();
    }
  }

  /** 订阅K线 */
  subscribeKline(symbol: string, interval: string, cb: (kline: {
    symbol: string; time: number; open: number; high: number; low: number;
    close: number; volume: number; isFinal: boolean;
  }) => void): void {
    this.subscribe(symbol, `kline_${interval}`, (data: any) => {
      if (!data.k) return;
      cb({
        symbol: data.s,
        time: data.k.t,
        open: parseFloat(data.k.o),
        high: parseFloat(data.k.h),
        low: parseFloat(data.k.l),
        close: parseFloat(data.k.c),
        volume: parseFloat(data.k.v),
        isFinal: data.k.x,
      });
    });
  }

  /** 订阅24hr Ticker（用于实时价格） */
  subscribeTicker(symbol: string, cb: (ticker: {
    symbol: string; price: number; change: number;
  }) => void): void {
    this.subscribe(symbol, 'ticker', (data: any) => {
      cb({
        symbol: data.s,
        price: parseFloat(data.c),
        change: parseFloat(data.p),
      });
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  getStatus(): boolean {
    return this.isConnected;
  }
}

// 单例
export const binanceStream = new BinanceStreamClient();
