/**
 * 双引擎交易系统 — 整合所有模块
 *
 * 🟢 稳健引擎（主账户）：趋势 + 回调，高确定性
 * 🔴 激进引擎（副账户）：突破 + 快进快出
 *
 * 运行循环：扫描→状态→过滤→评分→风控→执行→记录
 */

import { fetchKlines, type KlineData, type KlineInterval } from './exchange';
import { determineMarketState, type MarketStateResult } from './marketState';
import { runMarketFilters, type MarketFilterResult } from './marketFilter';
import { scoreSignal, type SignalScore } from './signalScorer';
import { scoreTradeQuality, type TradeQualityScore } from './tradeQualityScorer';
import { checkCircuitBreakers, calcPositionSizeV2, getRiskState, recordLoss, recordWin, saveRiskState, type CircuitBreakerResult, type PositionSizeV2 } from './riskProtocol';
import { placeSimulatedOrder, type PlaceOrderParams } from './tradeExecutor';
import { scanAccumulationBreakout, type AccumulationBreakoutResult } from './marketScanner';
import { getSimAccount, openSimPosition, updatePositionPrices, type OpenPositionParams } from './simulatedAccount';
import type { EngineType, SimulatedOrder, EngineLog } from './types';

const STORAGE_KEY_LOGS = 'crypto-journal-engine-logs';
const STORAGE_KEY_SETTINGS = 'crypto-journal-engine-settings';

export interface EngineSettings {
  enabled: boolean;
  stableEnabled: boolean;
  aggressiveEnabled: boolean;
  scanInterval: number; // 分钟
  stableSymbols: string[];
  aggressiveSymbols: string[];
  interval: KlineInterval;
  topGainerCount: number;
  topLoserCount: number;
  accumulationCount: number;
  simBalance: number;
  defaultLeverage: number;
  /** 演示模式：忽略时间过滤，任何时候都允许交易 */
  demoMode: boolean;
  /** 演示模式：强制生成信号（跳过部分严格过滤） */
  forceDemoSignals: boolean;
}

const DEFAULT_SETTINGS: EngineSettings = {
  enabled: false,
  stableEnabled: true,
  aggressiveEnabled: false,
  scanInterval: 15,
  stableSymbols: ['BTCUSDT', 'ETHUSDT'],
  aggressiveSymbols: ['SOLUSDT', 'BNBUSDT'],
  interval: '1h',
  topGainerCount: 5,
  topLoserCount: 5,
  accumulationCount: 5,
  simBalance: 10000,
  defaultLeverage: 3,
  demoMode: true,
  forceDemoSignals: true,
};

// ==================== 日志 ====================

function readLogs(): EngineLog[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_LOGS) || '[]'); }
  catch { return []; }
}

function addLog(type: EngineLog['type'], message: string, details?: Record<string, any>): void {
  const logs = readLogs();
  logs.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    type,
    message,
    details,
  });
  if (logs.length > 200) logs.splice(200);
  localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(logs));
}

export function getEngineLogs(limit: number = 50): EngineLog[] {
  return readLogs().slice(0, limit);
}

// ==================== 设置 ====================

export function getEngineSettings(): EngineSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveEngineSettings(settings: Partial<EngineSettings>): EngineSettings {
  const current = getEngineSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(updated));
  return updated;
}

// ==================== 单次运行循环 ====================

export interface EngineRunResult {
  symbol: string;
  engineType: EngineType;
  marketState: MarketStateResult;
  marketFilter: MarketFilterResult;
  signalScore: SignalScore;
  order?: SimulatedOrder;
  errors: string[];
  timestamp: number;
}

/**
 * 对单个品种执行一次完整的交易循环
 * 演示模式下忽略时间过滤，强制尝试生成信号
 */
export async function runEngineCycle(
  symbol: string,
  engineType: EngineType,
  interval: KlineInterval = '1h',
  demoMode: boolean = false,
  forceSignal: boolean = false,
): Promise<EngineRunResult> {
  const errors: string[] = [];
  const result: EngineRunResult = {
    symbol,
    engineType,
    marketState: null!,
    marketFilter: null!,
    signalScore: null!,
    errors,
    timestamp: Date.now(),
  };

  try {
    // 1. 获取数据
    addLog('SCAN', `[${engineType === 'STABLE' ? '🟢' : '🔴'}] ${symbol} 开始扫描`);
    const endTime = Date.now();
    const startTime = endTime - 60 * 24 * 60 * 60 * 1000;
    const klines = await fetchKlines({ symbol, interval, startTime, endTime, limit: 500 });
    if (klines.length < 50) {
      throw new Error(`K线数据不足 ${klines.length}/50`);
    }
    const prices = klines.map((k) => k.close);
    const currPrice = prices[prices.length - 1];
    const highPrice = Math.max(...klines.slice(-5).map((k) => k.high));
    const lowPrice = Math.min(...klines.slice(-5).map((k) => k.low));

    // 获取实时价格
    let livePrice = currPrice;
    try {
      const tickerRes = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`);
      if (tickerRes.ok) {
        const td = await tickerRes.json();
        livePrice = parseFloat(td.lastPrice);
      }
    } catch {}

    addLog('SCAN', `${symbol} 现价 $${livePrice.toLocaleString('en', {minimumFractionDigits:2})}`);

    // 2. 市场状态判断
    const marketState = determineMarketState(klines);
    result.marketState = marketState;
    addLog('SCAN', `${symbol} 市场状态: ${marketState.state} (置信度 ${marketState.confidence}%)`);

    // 震荡市场跳过（演示模式下放宽此限制）
    if (!demoMode && marketState.state === 'CONSOLIDATING' && marketState.confidence < 40) {
      addLog('FILTER', `${symbol} 震荡市场，跳过`);
      return result;
    }

    // 3. 市场过滤 — 演示模式忽略时间过滤
    const marketFilter = runMarketFilters(klines, demoMode);
    result.marketFilter = marketFilter;
    const filterStatus = marketFilter.passed ? '✅ 通过' : '❌ 拒绝';
    addLog('FILTER', `${symbol} 过滤结果: ${filterStatus} (综合分 ${marketFilter.overallScore})${demoMode && !marketFilter.passed ? ' [演示模式已忽略时间]' : ''}`);

    if (!marketFilter.passed && !forceSignal) {
      return result;
    }

    // 4. 信号评分
    const signalScore = scoreSignal(klines, interval);
    result.signalScore = signalScore;
    addLog('SIGNAL', `${symbol} 信号分: ${signalScore.totalScore} (${signalScore.level})`);

    if (signalScore.level === 'FORBIDDEN' && !forceSignal) {
      addLog('SIGNAL', `${symbol} 信号分 ${signalScore.totalScore} < 60，禁止交易`);
      return result;
    }

    // 5. 风控检查
    const riskState = getRiskState();
    const circuitBreaker = checkCircuitBreakers(
      riskState.consecutiveLosses,
      riskState.dailyLossPercent,
      riskState.maxDrawdownPercent,
    );
    addLog('RISK', `风控状态: ${riskState.status} | ${circuitBreaker.reasons.join('; ')}`);

    if (circuitBreaker.shouldStop && !forceSignal) {
      addLog('RISK', `⚠️ 停机机制触发: ${circuitBreaker.reasons.join('; ')}`);
      return result;
    }

    // 6. 决定方向：除非是暴跌/做空场景，默认LONG
    // 用价格走势判断方向——最近5根K线在上升还是下降
    const trendUp = currPrice > prices[prices.length - 5];
    const direction = trendUp ? 'LONG' : 'SHORT';

    // 7. 构建交易参数
    const atrPercent = 0.02; // 简化ATR
    const stopDist = livePrice * atrPercent;

    let stopLoss: number, tp1: number, tp2: number;
    if (direction === 'LONG') {
      const slMultiplier = engineType === 'STABLE' ? 1.5 : 1.0;
      stopLoss = livePrice - stopDist * slMultiplier;
      tp1 = livePrice + stopDist * 2;
      tp2 = livePrice + stopDist * 4;
    } else {
      const slMultiplier = engineType === 'STABLE' ? 1.5 : 1.0;
      stopLoss = livePrice + stopDist * slMultiplier;
      tp1 = livePrice - stopDist * 2;
      tp2 = livePrice - stopDist * 4;
    }

    // 8. 交易质量评分
    const qualityScore = scoreTradeQuality({
      klines,
      symbol,
      direction,
      entryPrice: livePrice,
      stopLoss,
      takeProfit: [tp1, tp2],
    });
    addLog('QUALITY', `${symbol} 质量分: ${qualityScore.totalScore} (${qualityScore.level})`);

    // 质量分<70仍然跳过（但演示模式可以放宽到60）
    const qualityThreshold = forceSignal ? 60 : 70;
    if (qualityScore.totalScore < qualityThreshold && !forceSignal) {
      addLog('QUALITY', `${symbol} 质量分 ${qualityScore.totalScore} < ${qualityThreshold}，放弃交易`);
      return result;
    }

    // 9. 仓位计算（使用模拟账户余额）
    const account = getSimAccount();
    const balance = account.currentBalance;
    const positionSize = calcPositionSizeV2(
      balance, livePrice, stopLoss, [tp1, tp2],
      engineType, signalScore,
    );

    if (!positionSize) {
      addLog('ERROR', `${symbol} 仓位计算失败`);
      return result;
    }

    // 10. 模拟下单
    const settings = getEngineSettings();
    const order = placeSimulatedOrder({
      symbol,
      direction,
      engineType,
      entryPrice: livePrice,
      stopLoss,
      takeProfit: [tp1, tp2],
      signalScore: signalScore.totalScore,
      qualityScore: qualityScore.totalScore,
      marketState: marketState.state,
      positionSize,
      notes: `市场: ${marketState.description} | 过滤: ${marketFilter.overallScore}分${demoMode ? ' [演示]' : ''}`,
    });

    result.order = order;
    addLog('ORDER', `[${engineType === 'STABLE' ? '🟢' : '🔴'}] ${symbol} ${direction} 模拟下单 ✅` +
      ` 入场 ${livePrice.toFixed(2)} 止损 ${stopLoss.toFixed(2)} 止盈 ${tp1.toFixed(2)}/${tp2.toFixed(2)}` +
      ` 数量 ${positionSize.positionSize.toFixed(4)} (${positionSize.riskPercent.toFixed(1)}%风险)` +
      ` 分批 ${positionSize.batch1.qty.toFixed(4)}/${positionSize.batch2.qty.toFixed(4)}/${positionSize.batch3.qty.toFixed(4)}`);

    // 11. 自动在模拟账户开仓
    const openResult = openSimPosition({
      symbol,
      direction,
      engineType,
      entryPrice: livePrice,
      quantity: positionSize.positionSize,
      leverage: settings.defaultLeverage,
      stopLoss,
      takeProfit: [tp1, tp2],
      orderId: order.id,
    });
    if (openResult) {
      addLog('ORDER', `模拟账户开仓: ${symbol} ${direction} ${positionSize.positionSize.toFixed(4)} @ ${livePrice.toFixed(2)} (${settings.defaultLeverage}x)`);
    } else {
      addLog('ERROR', `模拟账户余额不足 (可用: ${account.availableBalance.toFixed(2)})`);
    }

  } catch (err: any) {
    errors.push(err.message);
    addLog('ERROR', `${symbol} 错误: ${err.message}`);
  }

  return result;
}

// ==================== 全市场扫描 ====================

export interface FullScanResult {
  timestamp: number;
  results: EngineRunResult[];
  /** 暴涨榜品种（供显示） */
  topGainers: { symbol: string; change: string; price: string }[];
  /** 暴跌榜品种（供显示） */
  topLosers: { symbol: string; change: string; price: string }[];
  /** 蓄势突破亮点（供显示） */
  accumulationHighlights: AccumulationBreakoutResult[];
  summary: {
    total: number;
    signals: number;
    errors: number;
  };
}

/**
 * 获取涨跌幅榜品种
 */
async function fetchTopMovers(settings: EngineSettings): Promise<{
  topGainers: string[];
  topLosers: string[];
  gainerData: { symbol: string; change: string; price: string }[];
  loserData: { symbol: string; change: string; price: string }[];
}> {
  const gainerData: { symbol: string; change: string; price: string }[] = [];
  const loserData: { symbol: string; change: string; price: string }[] = [];
  const gainers: string[] = [];
  const losers: string[] = [];

  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any[] = await res.json();
    const usdt = data.filter((t: any) => t.symbol.endsWith('USDT'));

    // 涨幅榜
    const sortedGainers = [...usdt].sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
    for (const t of sortedGainers.slice(0, settings.topGainerCount)) {
      gainers.push(t.symbol);
      gainerData.push({ symbol: t.symbol, change: t.priceChangePercent, price: t.lastPrice });
    }

    // 跌幅榜
    const sortedLosers = [...usdt].sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent));
    for (const t of sortedLosers.slice(0, settings.topLoserCount)) {
      losers.push(t.symbol);
      loserData.push({ symbol: t.symbol, change: t.priceChangePercent, price: t.lastPrice });
    }
  } catch (err: any) {
    addLog('ERROR', `获取涨跌幅榜失败: ${err.message}`);
  }

  return { topGainers: gainers, topLosers: losers, gainerData, loserData };
}

/**
 * 获取蓄势突破亮点
 */
async function fetchAccumulationHighlights(settings: EngineSettings): Promise<{
  symbols: string[];
  highlights: AccumulationBreakoutResult[];
}> {
  const highlights: AccumulationBreakoutResult[] = [];
  const symbols: string[] = [];

  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const allTickers: any[] = await res.json();
    const usdtSymbols = allTickers.filter((t) => t.symbol.endsWith('USDT')).map((t) => t.symbol);

    const interval = '1h';
    const allResults: AccumulationBreakoutResult[] = [];

    for (let start = 0; start < Math.min(usdtSymbols.length, 100); start += 50) {
      const batch = usdtSymbols.slice(start, start + 50);
      const promises = batch.map(async (sym) => {
        try {
          const raw = await (await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=100`)).json();
          const data: KlineData[] = (raw as any[][]).map((k) => ({
            time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
            low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]), closeTime: k[6],
          }));
          if (data.length < 50) return null;
          return scanAccumulationBreakout(data, sym);
        } catch { return null; }
      });
      const batchResults = (await Promise.all(promises)).filter((r): r is AccumulationBreakoutResult => r !== null);
      allResults.push(...batchResults);
    }

    allResults.sort((a, b) => b.score - a.score);
    const top = allResults.slice(0, settings.accumulationCount);
    for (const r of top) {
      symbols.push(r.symbol);
      highlights.push(r);
    }
  } catch (err: any) {
    addLog('ERROR', `获取蓄势突破失败: ${err.message}`);
  }

  return { symbols, highlights };
}

/**
 * 对所有配置的品种执行一次完整交易循环
 */
export async function runFullScan(): Promise<FullScanResult> {
  const settings = getEngineSettings();
  const symbols: string[] = [];
  const scanSources: string[] = [];

  // 1. 配置品种
  if (settings.stableEnabled) { symbols.push(...settings.stableSymbols); scanSources.push('配置'); }

  // 2. 暴涨榜
  const { topGainers, topLosers, gainerData, loserData } = await fetchTopMovers(settings);
  if (settings.aggressiveEnabled) {
    symbols.push(...topGainers.slice(0, 3)); // 激进模式扫暴涨榜前3
    if (topGainers.length > 0) scanSources.push(`暴涨榜(${topGainers.length})`);
    symbols.push(...topLosers.slice(0, 2)); // 暴跌榜前2
    if (topLosers.length > 0) scanSources.push(`暴跌榜(${topLosers.length})`);
  }

  // 3. 蓄势突破
  const { symbols: accSymbols, highlights } = await fetchAccumulationHighlights(settings);
  symbols.push(...accSymbols);
  if (accSymbols.length > 0) scanSources.push(`蓄势突破(${accSymbols.length})`);

  const uniqueSymbols = [...new Set(symbols)];
  addLog('SCAN', `全市场扫描: ${uniqueSymbols.length}个 | 来源: ${scanSources.join(' · ')}`);

  // 4. 更新持仓价格
  const priceMap: Record<string, number> = {};
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (res.ok) {
      const data: any[] = await res.json();
      for (const t of data) priceMap[t.symbol] = parseFloat(t.lastPrice);
    }
  } catch { /* ignore */ }
  updatePositionPrices(priceMap);

  // 5. 扫描
  const results: EngineRunResult[] = [];
  for (const sym of uniqueSymbols) {
    let engineType: EngineType = settings.stableEnabled && settings.stableSymbols.includes(sym) ? 'STABLE' : 'AGGRESSIVE';
    if (topGainers.includes(sym)) engineType = 'AGGRESSIVE';
    const result = await runEngineCycle(sym, engineType, settings.interval, settings.demoMode, settings.forceDemoSignals);
    results.push(result);
  }

  const signals = results.filter((r) => r.order).length;
  const errors = results.filter((r) => r.errors.length > 0).length;

  addLog('SCAN', `扫描完成: ${results.length}个品种, ${signals}个信号, ${errors}个错误`);

  return {
    timestamp: Date.now(),
    results,
    topGainers: gainerData,
    topLosers: loserData,
    accumulationHighlights: highlights,
    summary: { total: results.length, signals, errors },
  };
}
