/**
 * 币安 API 连接层
 * 直接使用 REST API + Web Crypto HMAC-SHA256 签名（浏览器兼容）
 * 支持币安 USDT-M 合约（fapi）
 */

import { detectLuckyTrade, calcExecutionScore } from './calculations';
import type { Trade } from './types';

// ==================== 密钥管理 ====================

const STORAGE_KEY_API_KEY = 'crypto-journal-binance-api-key';
const STORAGE_KEY_SECRET = 'crypto-journal-binance-api-secret';

export function saveApiKey(apiKey: string, apiSecret: string): void {
  localStorage.setItem(STORAGE_KEY_API_KEY, apiKey.trim());
  localStorage.setItem(STORAGE_KEY_SECRET, apiSecret.trim());
}

export function getApiKey(): { apiKey: string; apiSecret: string } | null {
  const apiKey = localStorage.getItem(STORAGE_KEY_API_KEY);
  const apiSecret = localStorage.getItem(STORAGE_KEY_SECRET);
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

export function clearApiKey(): void {
  localStorage.removeItem(STORAGE_KEY_API_KEY);
  localStorage.removeItem(STORAGE_KEY_SECRET);
}

// ==================== 签名 ====================

async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ==================== HTTP 请求 ====================

const BASE_URL = 'https://fapi.binance.com';

interface BinanceRequestParams {
  method?: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  signed?: boolean;
}

async function request<T>(params: BinanceRequestParams): Promise<T> {
  const { method = 'GET', path, query = {}, signed = false } = params;
  const creds = getApiKey();
  if (!creds) throw new Error('未配置币安 API 密钥');

  // 过滤掉 undefined 的参数
  const filteredQuery: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') filteredQuery[k] = String(v);
  }

  // 如果需要签名
  if (signed) {
    filteredQuery.timestamp = String(Date.now());
    filteredQuery.recvWindow = '10000';
    const queryString = new URLSearchParams(filteredQuery).toString();
    filteredQuery.signature = await hmacSha256(creds.apiSecret, queryString);
  }

  const queryString = new URLSearchParams(filteredQuery).toString();
  const url = `${BASE_URL}${path}${queryString ? '?' + queryString : ''}`;

  const res = await fetch(url, {
    method,
    headers: {
      'X-MBX-APIKEY': creds.apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    let msg = `HTTP ${res.status}`;
    try {
      const err = JSON.parse(body);
      msg = err.msg || msg;
    } catch {}
    throw new Error(`币安 API 错误: ${msg}`);
  }

  return res.json();
}

// ==================== 类型定义（币安原始响应）====================

interface BinanceAccountInfo {
  canTrade: boolean;
  canWithdraw: boolean;
  accountType: string;
  assets: { asset: string; walletBalance: string; unrealizedProfit: string }[];
  positions: { symbol: string; positionAmt: string; entryPrice: string; unrealizedProfit: string; leverage: string }[];
}

interface BinanceUserTrade {
  symbol: string;
  id: number;
  orderId: number;
  side: 'BUY' | 'SELL';
  positionSide: 'BOTH' | 'LONG' | 'SHORT';
  price: string;
  qty: string;
  realizedPnl: string;
  quoteQty: string;
  commission: string;
  time: number;
  buyer: boolean;
  maker: boolean;
}

// ==================== API 方法 ====================

/** 测试连接：获取账户信息 */
export async function testConnection(): Promise<{
  success: boolean;
  message: string;
  canTrade?: boolean;
  balances?: { asset: string; balance: number }[];
  positions?: { symbol: string; size: number; entryPrice: number }[];
}> {
  try {
    const account = await request<BinanceAccountInfo>({
      path: '/fapi/v2/account',
      signed: true,
    });
    const balances = account.assets
      .filter((a) => parseFloat(a.walletBalance) > 0 || parseFloat(a.unrealizedProfit) !== 0)
      .map((a) => ({ asset: a.asset, balance: parseFloat(a.walletBalance) + parseFloat(a.unrealizedProfit) }));
    const positions = account.positions
      .filter((p) => parseFloat(p.positionAmt) !== 0)
      .map((p) => ({
        symbol: p.symbol,
        size: parseFloat(p.positionAmt),
        entryPrice: parseFloat(p.entryPrice),
      }));
    return {
      success: true,
      message: `连接成功！账户可交易: ${account.canTrade}`,
      canTrade: account.canTrade,
      balances,
      positions,
    };
  } catch (err: any) {
    return { success: false, message: err.message || '连接失败' };
  }
}

/** 获取成交明细（userTrades） */
export async function fetchUserTrades(options: {
  symbol?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
} = {}): Promise<BinanceUserTrade[]> {
  return request<BinanceUserTrade[]>({
    path: '/fapi/v1/userTrades',
    query: {
      symbol: options.symbol,
      startTime: options.startTime,
      endTime: options.endTime,
      limit: options.limit ?? 1000,
    },
    signed: true,
  });
}

/** 获取所有可交易合约信息 */
export async function fetchExchangeInfo(): Promise<{ symbols: string[] }> {
  const data = await request<{ symbols: { symbol: string; status: string }[] }>({
    path: '/fapi/v1/exchangeInfo',
  });
  return {
    symbols: data.symbols.filter((s) => s.status === 'TRADING').map((s) => s.symbol),
  };
}

// ==================== K线数据（公开接口，无需 API Key）====================

/** K线数据点 */
export interface KlineData {
  time: number;       // 开盘时间戳 (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

/** 支持的K线周期 */
export type KlineInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d';

/**
 * 获取历史K线数据
 * 公开接口，不需要 API Key / 签名
 */
export async function fetchKlines(options: {
  symbol: string;
  interval: KlineInterval;
  startTime?: number;
  endTime?: number;
  limit?: number;
}): Promise<KlineData[]> {
  const { symbol, interval, startTime, endTime, limit = 500 } = options;

  // 手动拼接查询字符串，避免 URLSearchParams 改变参数名大小写
  const params: string[] = [`symbol=${symbol}`, `interval=${interval}`, `limit=${limit}`];
  if (startTime !== undefined && startTime > 0) params.push(`startTime=${startTime}`);
  if (endTime !== undefined && endTime > 0) params.push(`endTime=${endTime}`);

  const url = `${BASE_URL}/fapi/v1/klines?${params.join('&')}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`K线获取失败: HTTP ${res.status} ${body}`);
  }

  const raw: unknown[][] = await res.json();
  return raw.map((k) => ({
    time: Number(k[0]),
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
    closeTime: Number(k[6]),
  }));
}

// ==================== 数据映射 ====================

/** 将币安成交记录转换为交易复盘系统中的 Trade 对象列表 */
export function mapTradesToJournal(binanceTrades: BinanceUserTrade[]): Trade[] {
  // 按 (symbol, positionSide) 分组并按时间排序
  const groups = new Map<string, BinanceUserTrade[]>();

  for (const trade of binanceTrades) {
    const key = `${trade.symbol}::${trade.positionSide || 'BOTH'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(trade);
  }

  const result: Trade[] = [];

  for (const [key, trades] of groups) {
    const [symbol, positionSide] = key.split('::') as [string, 'LONG' | 'SHORT' | 'BOTH'];

    // 按时间排序
    trades.sort((a, b) => a.time - b.time);

    let openQty = 0;
    let openCost = 0; // 开仓总花费（用于计算均价）
    let openFills: BinanceUserTrade[] = [];
    let closeQty = 0;
    let closeIncome = 0; // 平仓总收入（用于计算均价）
    let closeFills: BinanceUserTrade[] = [];
    let totalRealizedPnl = 0;
    let tradeStartTime = 0;
    let tradeEndTime = 0;

    function flushTrade() {
      if (openFills.length === 0 && closeFills.length === 0) return;

      // 判断方向
      let direction: 'LONG' | 'SHORT';
      let entryPrice: number;
      let exitPrice: number;
      let quantity: number;
      let pnl: number;

      if (positionSide === 'LONG' || positionSide === 'BOTH') {
        // 默认假设多数情况下是 LONG
        // 实际开仓方向由 opening 交易的 side 决定
        direction = 'LONG';
        // 对于 LONG: opening 是 BUY, closing 是 SELL
        const openBuyFills = openFills.filter((f) => f.side === 'BUY');
        const closeSellFills = closeFills.filter((f) => f.side === 'SELL');

        if (openBuyFills.length > 0) {
          const totalQty = openBuyFills.reduce((s, f) => s + parseFloat(f.qty), 0);
          const totalQuote = openBuyFills.reduce((s, f) => s + parseFloat(f.quoteQty), 0);
          entryPrice = totalQty > 0 ? totalQuote / totalQty : 0;
          quantity = totalQty;
        } else {
          // fallback: 所有非 closing 的 fill
          const totalQty = openFills.reduce((s, f) => s + parseFloat(f.qty), 0);
          const totalQuote = openFills.reduce((s, f) => s + parseFloat(f.quoteQty), 0);
          entryPrice = totalQty > 0 ? totalQuote / totalQty : 0;
          quantity = totalQty;
        }

        if (closeSellFills.length > 0) {
          const totalQty = closeSellFills.reduce((s, f) => s + parseFloat(f.qty), 0);
          const totalQuote = closeSellFills.reduce((s, f) => s + parseFloat(f.quoteQty), 0);
          exitPrice = totalQty > 0 ? totalQuote / totalQty : 0;
        } else {
          exitPrice = entryPrice;
        }
      } else {
        direction = 'SHORT';
        const openSellFills = openFills.filter((f) => f.side === 'SELL');
        const closeBuyFills = closeFills.filter((f) => f.side === 'BUY');

        if (openSellFills.length > 0) {
          const totalQty = openSellFills.reduce((s, f) => s + parseFloat(f.qty), 0);
          const totalQuote = openSellFills.reduce((s, f) => s + parseFloat(f.quoteQty), 0);
          entryPrice = totalQty > 0 ? totalQuote / totalQty : 0;
          quantity = totalQty;
        } else {
          const totalQty = openFills.reduce((s, f) => s + parseFloat(f.qty), 0);
          const totalQuote = openFills.reduce((s, f) => s + parseFloat(f.quoteQty), 0);
          entryPrice = totalQty > 0 ? totalQuote / totalQty : 0;
          quantity = totalQty;
        }

        if (closeBuyFills.length > 0) {
          const totalQty = closeBuyFills.reduce((s, f) => s + parseFloat(f.qty), 0);
          const totalQuote = closeBuyFills.reduce((s, f) => s + parseFloat(f.quoteQty), 0);
          exitPrice = totalQty > 0 ? totalQuote / totalQty : 0;
        } else {
          exitPrice = entryPrice;
        }
      }

      // 计算盈亏百分比（基于保证金）
      // 简单假设 1x 杠杆，用户可以在导入后修改
      const leverage = 1;
      const margin = (entryPrice * quantity) / leverage;
      const pnlPercent = margin > 0 ? (totalRealizedPnl / margin) * 100 : 0;

      // 总佣金
      const totalCommission = [...openFills, ...closeFills].reduce(
        (s, f) => s + parseFloat(f.commission),
        0,
      );

      // 检测侥幸交易（使用 MAE 近似）
      // 这里用最大不利价格变动来近似 MAE
      // 由于我们没有 kline 数据，先用简单规则
      const luckyResult = detectLuckyTrade({
        pnl: totalRealizedPnl,
        direction,
        entryPrice,
        stopLoss: undefined, // 暂无止损数据
        maePercent: undefined,
      });

      // 计算执行分
      const executionScore = calcExecutionScore({
        trade: {
          stopLoss: undefined,
          leverage,
          isLuckyTrade: luckyResult.isLucky,
        },
      });

      const trade: Trade = {
        id: '', // 调用 addTrade/batchImport 时会生成
        createdAt: '',
        updatedAt: '',
        exchange: 'binance',
        orderId: `${symbol}-${tradeStartTime}`,
        symbol,
        direction,
        leverage,
        entryPrice,
        exitPrice,
        stopLoss: undefined,
        takeProfit: undefined,
        positionSize: quantity,
        margin,
        fee: totalCommission,
        entryTime: new Date(tradeStartTime).toISOString(),
        exitTime: tradeEndTime > 0 ? new Date(tradeEndTime).toISOString() : undefined,
        pnl: totalRealizedPnl,
        pnlPercent,
        mae: undefined,
        maePercent: undefined,
        mfe: undefined,
        mfePercent: undefined,
        holdingSeconds: tradeEndTime > 0 ? Math.floor((tradeEndTime - tradeStartTime) / 1000) : undefined,
        executionScore,
        isLuckyTrade: luckyResult.isLucky,
        luckyReason: luckyResult.reason,
        status: 'CLOSED',
        notes: syncNotes(trades, totalRealizedPnl),
      };

      result.push(trade);
    }

    // 遍历成交记录，识别开仓和平仓
    for (const t of trades) {
      const qty = parseFloat(t.qty);
      const rPnl = parseFloat(t.realizedPnl);

      // 判断这笔成交是否用于平仓：realizedPnl !== 0 或 side 与持仓方向相反
      const isClosingOrder = positionSide === 'LONG'
        ? t.side === 'SELL'
        : positionSide === 'SHORT'
          ? t.side === 'BUY'
          : Math.abs(rPnl) > 0.0001;

      // 如果 realizedPnl !== 0，累积盈亏
      if (Math.abs(rPnl) > 0.0001) {
        totalRealizedPnl += rPnl;
      }

      if (isClosingOrder) {
        // 平仓成交
        closeFills.push(t);
        closeQty += qty;
        if (tradeEndTime === 0 || t.time > tradeEndTime) tradeEndTime = t.time;
      } else {
        // 开仓成交
        openFills.push(t);
        openQty += qty;
        if (tradeStartTime === 0 || t.time < tradeStartTime) tradeStartTime = t.time;
      }

      // 当开仓量 ≈ 平仓量，完成一笔交易
      // 允许少量误差（浮点数问题）
      if (Math.abs(openQty - closeQty) < 0.0001 && openQty > 0) {
        if (tradeEndTime === 0) tradeEndTime = t.time;
        flushTrade();
        // 重置
        openQty = 0;
        openCost = 0;
        openFills = [];
        closeQty = 0;
        closeIncome = 0;
        closeFills = [];
        totalRealizedPnl = 0;
        tradeStartTime = 0;
        tradeEndTime = 0;
      }
    }

    // 处理未匹配完的（仍在持仓中）
    if (openFills.length > 0 || closeFills.length > 0) {
      const remainingQty = openQty - closeQty;
      // 如果还有持仓未平，暂不创建交易记录
      // 或者如果只有开仓/平仓不匹配，当作异常忽略
    }
  }

  return result;
}

/** 生成同步备注 */
function syncNotes(trades: BinanceUserTrade[], pnl: number): string {
  const count = trades.length;
  const totalQty = trades.reduce((s, t) => s + parseFloat(t.qty), 0);
  const orderIds = [...new Set(trades.map((t) => t.orderId))];
  return `币安同步 | ${count}次成交 | ${orderIds.length}个订单 | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`;
}

/** 一键同步：获取最近 N 天的成交明细并转换为交易记录 */
export async function syncFromBinance(days: number = 7): Promise<{
  trades: Trade[];
  message: string;
}> {
  const now = Date.now();
  const startTime = now - days * 24 * 60 * 60 * 1000;

  const allTrades = await fetchUserTrades({
    startTime,
    endTime: now,
    limit: 1000,
  });

  if (allTrades.length === 0) {
    return { trades: [], message: `过去 ${days} 天没有找到成交记录` };
  }

  const mapped = mapTradesToJournal(allTrades);

  return {
    trades: mapped,
    message: `共获取 ${allTrades.length} 条成交记录，合并为 ${mapped.length} 笔交易`,
  };
}
