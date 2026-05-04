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
  /** 额外扫描：暴涨榜数量 */
  topGainerCount: number;
  /** 额外扫描：暴跌榜数量 */
  topLoserCount: number;
  /** 额外扫描：蓄势突破数量 */
  accumulationCount: number;
  /** 模拟账户余额 */
  simBalance: number;
  /** 默认杠杆 */
  defaultLeverage: number;
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
 */
export async function runEngineCycle(
  symbol: string,
  engineType: EngineType,
  interval: KlineInterval = '1h',
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

    // 2. 市场状态判断
    const marketState = determineMarketState(klines);
    result.marketState = marketState;
    addLog('SCAN', `${symbol} 市场状态: ${marketState.state} (置信度 ${marketState.confidence}%)`);

    // 震荡市场下降低交易频率
    if (marketState.state === 'CONSOLIDATING' && marketState.confidence < 40) {
      addLog('FILTER', `${symbol} 震荡市场，跳过`);
      return result;
    }

    // 3. 市场过滤
    const marketFilter = runMarketFilters(klines);
    result.marketFilter = marketFilter;
    addLog('FILTER', `${symbol} 过滤结果: ${marketFilter.passed ? '✅ 通过' : '❌ 拒绝'} (综合分 ${marketFilter.overallScore})`);

    if (!marketFilter.passed) {
      return result;
    }

    // 4. 信号评分
    const signalScore = scoreSignal(klines, interval);
    result.signalScore = signalScore;
    addLog('SIGNAL', `${symbol} 信号分: ${signalScore.totalScore} (${signalScore.level})`);

    if (signalScore.level === 'FORBIDDEN') {
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

    if (circuitBreaker.shouldStop) {
      addLog('RISK', `⚠️ 停机机制触发: ${circuitBreaker.reasons.join('; ')}`);
      return result;
    }

    // 6. 构建交易参数
    const prices = klines.map((k) => k.close);
    const currPrice = prices[prices.length - 1];
    const atrValues = klines.map(() => 0); // simplified
    const stopDist = currPrice * 0.02; // 2% ATR estimate

    const stopLoss = engineType === 'STABLE'
      ? currPrice - stopDist * 1.5
      : currPrice - stopDist;
    const tp1 = currPrice + stopDist * 2;
    const tp2 = currPrice + stopDist * 4;

    // 7. 交易质量评分
    const qualityScore = scoreTradeQuality({
      klines,
      symbol,
      direction: 'LONG',
      entryPrice: currPrice,
      stopLoss,
      takeProfit: [tp1, tp2],
    });
    addLog('QUALITY', `${symbol} 质量分: ${qualityScore.totalScore} (${qualityScore.level})`);

    if (qualityScore.level === 'REJECT') {
      addLog('QUALITY', `${symbol} 质量分 ${qualityScore.totalScore} < 70，放弃交易`);
      return result;
    }

    // 8. 仓位计算（使用模拟账户余额）
    const account = getSimAccount();
    const balance = account.currentBalance;
    const positionSize = calcPositionSizeV2(
      balance,
      currPrice,
      stopLoss,
      [tp1, tp2],
      engineType,
      signalScore,
    );

    if (!positionSize) {
      addLog('ERROR', `${symbol} 仓位计算失败`);
      return result;
    }

    // 9. 模拟下单
    const order = placeSimulatedOrder({
      symbol,
      direction: 'LONG',
      engineType,
      entryPrice: currPrice,
      stopLoss,
      takeProfit: [tp1, tp2],
      signalScore: signalScore.totalScore,
      qualityScore: qualityScore.totalScore,
      marketState: marketState.state,
      positionSize,
      notes: `市场: ${marketState.description} | 过滤: ${marketFilter.overallScore}分`,
    });

    result.order = order;
    addLog('ORDER', `[${engineType === 'STABLE' ? '🟢' : '🔴'}] ${symbol} 模拟下单 ✅` +
      ` 入场 ${currPrice.toFixed(2)} 止损 ${stopLoss.toFixed(2)} 止盈 ${tp1.toFixed(2)}/${tp2.toFixed(2)}` +
      ` 仓位 ${positionSize.positionSize} (${positionSize.riskPercent}%风险)`);

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
    // 暴涨榜品种用激进引擎
    if (topGainers.includes(sym)) engineType = 'AGGRESSIVE';
    const result = await runEngineCycle(sym, engineType, settings.interval);
    results.push(result);
  }

  // 6. 模拟开仓：如果有新订单，打开模拟持仓
  for (const r of results) {
    if (r.order && r.order.status === 'SIGNALED') {
      const o = r.order;
      const result = openSimPosition({
        symbol: o.symbol,
        direction: o.direction,
        engineType: o.engineType,
        entryPrice: o.entryPrice,
        quantity: o.positionSize,
        leverage: settings.defaultLeverage,
        stopLoss: o.stopLoss,
        takeProfit: o.takeProfit,
        orderId: o.id,
      });
      if (result) {
        addLog('ORDER', `模拟账户开仓: ${o.symbol} ${o.direction} ${o.positionSize} @ ${o.entryPrice} (${settings.defaultLeverage}x)`);
      } else {
        addLog('ERROR', `模拟账户开仓失败: ${o.symbol} — 余额不足?`);
      }
    }
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
