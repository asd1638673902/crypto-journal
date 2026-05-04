/**
 * 交易引擎核心 — 7×24 运行
 * 每根K线收盘时触发：分析→评分→过滤→风控→下单
 */
import { binanceStream } from './wsClient.js';
import { getAccount, openPosition, updatePositionsPrices, getPositions, closePosition, initAccount } from './account.js';
import { readTable, appendToTable } from './db.js';

// ==================== 状态 ====================

export interface EngineState {
  running: boolean;
  startedAt: string;
  processedBars: number;
  openSignals: number;
  symbols: string[];
  interval: string;
}

export interface EngineLog {
  timestamp: string;
  type: string;
  message: string;
}

let state: EngineState = {
  running: false,
  startedAt: '',
  processedBars: 0,
  openSignals: 0,
  symbols: ['btcusdt', 'ethusdt', 'solusdt'],
  interval: '5m',
};

const klineCache = new Map<string, any[]>();
const tickerPrices = new Map<string, number>();

let wsServerRef: { broadcast: (data: any) => void } | null = null;

export function setWSServer(server: { broadcast: (data: any) => void }) {
  wsServerRef = server;
}

function log(type: string, message: string) {
  const entry: EngineLog = { timestamp: new Date().toISOString(), type, message };
  appendToTable('engine_logs', entry);
  console.log(`[${type}] ${message}`);
  broadcast({ type: 'log', data: entry });
  broadcast({ type: 'state', data: getState() });
}

function broadcast(data: any) {
  if (wsServerRef) wsServerRef.broadcast(data);
}

// ==================== 指标计算 ====================

function SMA(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(0); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result.push(sum / period);
  }
  return result;
}

function RSI(values: number[], period: number = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function ATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
  if (highs.length < 2) return 0;
  let sum = 0, count = 0;
  for (let i = Math.max(1, highs.length - period); i < highs.length; i++) {
    sum += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    count++;
  }
  return count > 0 ? sum / count : 0;
}

// ==================== 核心 ====================

function processKline(symbol: string, kline: any) {
  const sym = symbol.toUpperCase();
  const { time, open, high, low, close, volume, isFinal } = kline;

  if (!klineCache.has(sym)) klineCache.set(sym, []);
  const bars = klineCache.get(sym)!;
  bars.push({ time, open, high, low, close, volume });
  if (bars.length > 200) bars.splice(0, bars.length - 200);

  updatePositionsPrices(Object.fromEntries(tickerPrices));

  if (!isFinal) return;
  state.processedBars++;
  log('BAR', `${sym} ${new Date(time).toLocaleTimeString()} 收盘 $${close}`);

  // 止损检查
  const currentPositions = getPositions().filter(p => p.symbol === sym);
  for (const pos of currentPositions) {
    let hit = false;
    if (pos.direction === 'LONG' && close <= pos.stopLoss) hit = true;
    if (pos.direction === 'SHORT' && close >= pos.stopLoss) hit = true;
    if (hit) {
      const result = closePosition(pos.id, close);
      if (result) {
        state.openSignals = Math.max(0, state.openSignals - 1);
        log('STOP', `${sym} 止损 @ ${close} PnL=${result.pnl.toFixed(2)}`);
        broadcast({ type: 'position_closed', data: { symbol: sym, pnl: result.pnl, reason: '止损' } });
      }
    }
  }

  if (bars.length < 30) return;
  runAnalysis(sym, bars);
}

function runAnalysis(symbol: string, bars: any[]) {
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume);
  const currPrice = closes[closes.length - 1];
  const n = closes.length;

  const rsi = RSI(closes);
  const sma20 = SMA(closes, 20);
  const sma50 = SMA(closes, 50);
  const atr = ATR(highs, lows, closes);

  let score = 50;
  // 趋势信号：SMA20金叉/死叉
  if (sma20[n - 1] > sma50[n - 1] && sma20[n - 2] <= sma50[n - 2]) score += 15;
  if (sma20[n - 1] < sma50[n - 1] && sma20[n - 2] >= sma50[n - 2]) score -= 10;
  // 均线排列
  if (sma20[n - 1] > sma50[n - 1]) score += 5;
  // RSI
  if (rsi < 35) { score += 20; }
  else if (rsi > 70) { score -= 10; }
  else { score += 10; }
  // 成交量
  const avgVol = volumes.slice(-10).reduce((s, v) => s + v, 0) / 10;
  if (avgVol > 0 && volumes[n - 1] > avgVol * 1.5) score += 15;
  // 波动率范围
  const atrPct = currPrice > 0 ? (atr / currPrice) * 100 : 0;
  if (atrPct >= 0.3 && atrPct <= 3) score += 10;

  const direction = score >= 60 ? 'LONG' : 'SHORT';
  const level = score >= 80 ? 'BOOST' : score >= 60 ? 'NORMAL' : 'FORBIDDEN';

  log('SIGNAL', `${symbol} 评分=${score}(${level}) RSI=${rsi.toFixed(0)}`);

  broadcast({ type: 'signal', data: {
    symbol, score, level, rsi: Math.round(rsi), direction,
    price: currPrice, time: new Date().toISOString(),
  }});

  if (score < 60) return;
  if (score < 70 && state.openSignals >= 3) return;

  // 已有同品种持仓则跳过
  if (getPositions().some(p => p.symbol === symbol)) return;

  const account = getAccount();
  const riskPct = 1;
  const riskAmount = account.currentBalance * (riskPct / 100);
  const stopDist = Math.max(atr * 1.5, currPrice * 0.005);
  const quantity = Math.max(0, riskAmount / stopDist);

  if (quantity <= 0 || stopDist <= 0) return;

  const stopLoss = direction === 'LONG' ? currPrice - stopDist : currPrice + stopDist;
  const tp1 = direction === 'LONG' ? currPrice + stopDist * 2 : currPrice - stopDist * 2;

  const result = openPosition({
    symbol, direction, entryPrice: currPrice,
    quantity, leverage: 3, stopLoss, takeProfit: [tp1],
  });

  if (result) {
    state.openSignals++;
    log('ORDER', `${symbol} ${direction} ${quantity.toFixed(4)} @ ${currPrice.toFixed(2)}`);
    broadcast({ type: 'order', data: { symbol, direction, entryPrice: currPrice, quantity, stopLoss, tp1 } });
  }
}

// ==================== 行情价格更新 ====================

export function updateTickerPrice(symbol: string, price: number) {
  tickerPrices.set(symbol, price);
}

// ==================== 启动/停止 ====================

export function startEngine() {
  if (state.running) return;

  const accounts = readTable('account');
  if (accounts.length === 0) initAccount(10000);

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.processedBars = 0;
  state.openSignals = 0;

  for (const sym of state.symbols) {
    binanceStream.subscribeKline(sym, state.interval, (kline) => processKline(sym, kline));
    binanceStream.subscribeTicker(sym, (ticker) => updateTickerPrice(ticker.symbol, ticker.price));
  }
  binanceStream.connect();
  log('ENGINE', `引擎已启动: ${state.symbols.join(',')} (${state.interval})`);
}

export function stopEngine() {
  if (!state.running) return;
  binanceStream.disconnect();
  state.running = false;
  log('ENGINE', '引擎已停止');
}

export function getState(): EngineState {
  return { ...state };
}
