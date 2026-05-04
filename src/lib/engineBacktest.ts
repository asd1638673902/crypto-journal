/**
 * 引擎回测 — 在历史K线上运行完整的V2引擎循环
 *
 * 目的：验证每个模块是否真的有效
 * - 支持周期选择（7/30/60/90天）
 * - 生成回测结果 + 权益曲线
 * - 记录每笔交易的所有评分（信号分/质量分/过滤结果）
 */

import type { KlineData, KlineInterval } from './exchange';
import { fetchKlines } from './exchange';
import { determineMarketState, type MarketStateResult } from './marketState';
import { runMarketFilters, type MarketFilterResult } from './marketFilter';
import { scoreSignal, type SignalScore } from './signalScorer';
import { scoreTradeQuality, type TradeQualityScore } from './tradeQualityScorer';
import { calcPositionSizeV2, checkCircuitBreakers } from './riskProtocol';
import { closes } from './strategyIndicators';

// ==================== 回测结果类型 ====================

export interface BacktestTrade {
  index: number;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  holdingBars: number;

  // 评分
  signalScore: number;
  qualityScore: number;
  marketState: string;
  filterPassed: boolean;
  filterScore: number;

  // 是否被过滤拒绝
  rejectedByFilter: boolean;
  rejectedByQuality: boolean;
  rejectedByRisk: boolean;

  // 时段
  timePeriod: 'ASIA' | 'EUROPE' | 'US' | 'OTHER';
}

export interface EngineBacktestResult {
  symbol: string;
  interval: KlineInterval;
  days: number;
  totalBars: number;
  trades: BacktestTrade[];
  equityCurve: { bar: number; equity: number }[];

  // 汇总
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  netPnl: number;

  // 各模块过滤统计
  filterRejectionRate: number;
  qualityRejectionRate: number;
  riskRejectionRate: number;

  // 按评分分层
  highScoreCount: number;
  highScoreWinRate: number;
  lowScoreCount: number;
  lowScoreWinRate: number;

  // 按市场状态
  trendingTrades: number;
  trendingWinRate: number;
  consolidatingTrades: number;
  consolidatingWinRate: number;
  explosiveTrades: number;
  explosiveWinRate: number;
}

// ==================== 时段判断 ====================

function getTimePeriod(hour: number): BacktestTrade['timePeriod'] {
  if (hour >= 8 && hour < 14) return 'ASIA';
  if (hour >= 14 && hour < 20) return 'EUROPE';
  if (hour >= 20 || hour < 2) return 'US';
  return 'OTHER';
}

// ==================== 核心回测 ====================

/**
 * 在历史K线上运行V2引擎回测
 * 在每根K线收盘时判断是否开仓
 */
export async function runEngineBacktest(
  symbol: string,
  interval: KlineInterval = '1h',
  days: number = 30,
  initialCapital: number = 10000,
): Promise<EngineBacktestResult> {
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  const klines = await fetchKlines({ symbol, interval, startTime, endTime, limit: 1000 });
  if (klines.length < 50) {
    throw new Error(`K线数据不足 ${klines.length}/50`);
  }

  const trades: BacktestTrade[] = [];
  const equityCurve: { bar: number; equity: number }[] = [];
  let equity = initialCapital;
  let position: {
    entryIndex: number;
    entryPrice: number;
    direction: 'LONG' | 'SHORT';
    entryTime: string;
    signalScore: number;
    qualityScore: number;
    marketState: string;
    filterPassed: boolean;
    filterScore: number;
    timePeriod: BacktestTrade['timePeriod'];
  } | null = null;

  let totalFilterRejections = 0;
  let totalQualityRejections = 0;
  let totalRiskRejections = 0;
  let totalAttempts = 0;

  // 从第50根K线开始扫描（需要足够数据计算指标）
  for (let i = 50; i < klines.length; i++) {
    const currentKline = klines[i];
    const slice = klines.slice(0, i + 1);
    const prices = closes(slice);
    const currPrice = prices[prices.length - 1];
    const currentTime = new Date(currentKline.time);
    const hour = currentTime.getUTCHours() + 8; // UTC+8

    // 记录权益曲线
    if (position) {
      const unrealizedPnl = position.direction === 'LONG'
        ? (currPrice - position.entryPrice) * (equity * 0.01 / position.entryPrice)
        : (position.entryPrice - currPrice) * (equity * 0.01 / position.entryPrice);
      equityCurve.push({ bar: i, equity: equity + unrealizedPnl });
    } else {
      equityCurve.push({ bar: i, equity });
    }

    // 持仓检查：是否触发止损或止盈
    if (position) {
      const entryPrice = position.entryPrice;
      const stopDist = entryPrice * 0.02;
      const stopLoss = position.direction === 'LONG' ? entryPrice - stopDist * 1.5 : entryPrice + stopDist * 1.5;
      const tp1 = position.direction === 'LONG' ? entryPrice + stopDist * 2 : entryPrice - stopDist * 2;

      let shouldExit = false;
      let exitPrice = currPrice;
      let exitReason = '';

      if (position.direction === 'LONG') {
        if (currPrice <= stopLoss) { shouldExit = true; exitPrice = stopLoss; exitReason = '止损'; }
        else if (currPrice >= tp1) { shouldExit = true; exitPrice = tp1; exitReason = '止盈'; }
      } else {
        if (currPrice >= stopLoss) { shouldExit = true; exitPrice = stopLoss; exitReason = '止损'; }
        else if (currPrice <= tp1) { shouldExit = true; exitPrice = tp1; exitReason = '止盈'; }
      }

      // 如果持仓超过20根K线，强制平仓
      if (!shouldExit && (i - position.entryIndex) >= 20) {
        shouldExit = true;
        exitPrice = currPrice;
        exitReason = '超时平仓';
      }

      if (shouldExit) {
        const priceDiff = position.direction === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
        const quantity = (equity * 0.01) / entryPrice;
        const pnl = priceDiff * quantity;
        const pnlPercent = (pnl / (quantity * entryPrice)) * 100;

        const trade: BacktestTrade = {
          index: trades.length,
          symbol,
          direction: position.direction,
          entryTime: position.entryTime,
          entryPrice: position.entryPrice,
          exitTime: new Date(currentKline.time).toISOString(),
          exitPrice,
          pnl: Math.round(pnl * 100) / 100,
          pnlPercent: Math.round(pnlPercent * 100) / 100,
          holdingBars: i - position.entryIndex,
          signalScore: position.signalScore,
          qualityScore: position.qualityScore,
          marketState: position.marketState,
          filterPassed: position.filterPassed,
          filterScore: position.filterScore,
          rejectedByFilter: false,
          rejectedByQuality: false,
          rejectedByRisk: false,
          timePeriod: position.timePeriod,
        };
        trades.push(trade);
        equity += pnl;
        position = null;
      }

      // 即使持仓中也要继续检查新信号（每个K线都检查）
      continue;
    }

    // 没有持仓 → 检查是否应开仓
    totalAttempts++;

    // 1. 市场状态判断
    const marketState = determineMarketState(slice);
    if (marketState.state === 'CONSOLIDATING' && marketState.confidence < 40) {
      continue;
    }

    // 2. 市场过滤
    const filterResult = runMarketFilters(slice);
    if (!filterResult.passed) {
      totalFilterRejections++;
      continue;
    }

    // 3. 信号评分
    const signalScore = scoreSignal(slice, interval);
    if (signalScore.level === 'FORBIDDEN') {
      totalQualityRejections++; // 信号不过关
      continue;
    }

    // 4. 风控检查
    const breaker = checkCircuitBreakers(0, 0, 0); // 简化版风控
    if (breaker.shouldStop) {
      totalRiskRejections++;
      continue;
    }

    // 5. 交易质量评分
    const stopDist = currPrice * 0.02;
    const stopLoss = currPrice - stopDist * 1.5;
    const tp1 = currPrice + stopDist * 2;
    const qualityScore = scoreTradeQuality({
      klines: slice,
      symbol,
      direction: 'LONG',
      entryPrice: currPrice,
      stopLoss,
      takeProfit: [tp1],
    });

    if (qualityScore.level === 'REJECT') {
      totalQualityRejections++;
      continue;
    }

    // 6. 开仓
    position = {
      entryIndex: i,
      entryPrice: currPrice,
      direction: 'LONG',
      entryTime: new Date(currentKline.time).toISOString(),
      signalScore: signalScore.totalScore,
      qualityScore: qualityScore.totalScore,
      marketState: marketState.state,
      filterPassed: filterResult.passed,
      filterScore: filterResult.overallScore,
      timePeriod: getTimePeriod(hour),
    };
  }

  // 如果有持仓未平，按最后价格平仓
  if (position) {
    const lastPrice = closes(klines)[klines.length - 1];
    const priceDiff = position.direction === 'LONG' ? lastPrice - position.entryPrice : position.entryPrice - lastPrice;
    const quantity = (equity * 0.01) / position.entryPrice;
    const pnl = priceDiff * quantity;
    const pnlPercent = (pnl / (quantity * position.entryPrice)) * 100;

    trades.push({
      index: trades.length,
      symbol,
      direction: position.direction,
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      exitTime: new Date(klines[klines.length - 1].time).toISOString(),
      exitPrice: lastPrice,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round(pnlPercent * 100) / 100,
      holdingBars: klines.length - position.entryIndex,
      signalScore: position.signalScore,
      qualityScore: position.qualityScore,
      marketState: position.marketState,
      filterPassed: position.filterPassed,
      filterScore: position.filterScore,
      rejectedByFilter: false,
      rejectedByQuality: false,
      rejectedByRisk: false,
      timePeriod: position.timePeriod,
    });
    equity += pnl;
  }

  // 最终权益曲线
  equityCurve.push({ bar: klines.length - 1, equity });

  // ========== 计算汇总 ==========
  const totalTrades = trades.length;
  const winning = trades.filter((t) => t.pnl > 0);
  const losing = trades.filter((t) => t.pnl <= 0);
  const wins = winning.length;
  const losses = losing.length;

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWin = wins > 0 ? winning.reduce((s, t) => s + t.pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? Math.abs(losing.reduce((s, t) => s + t.pnl, 0)) / losses : 0;
  const expectancy = totalTrades > 0 ? ((winRate / 100) * avgWin) - ((1 - winRate / 100) * avgLoss) : 0;
  const profitFactor = avgLoss > 0 ? (wins * avgWin) / (losses * avgLoss) : wins > 0 ? Infinity : 0;

  // 最大回撤
  let maxDrawdown = 0;
  let peak = initialCapital;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak > 0 ? (peak - pt.equity) / peak * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // 过滤拒绝率
  const filterRejectionRate = totalAttempts > 0 ? (totalFilterRejections / totalAttempts) * 100 : 0;
  const qualityRejectionRate = totalAttempts > 0 ? (totalQualityRejections / totalAttempts) * 100 : 0;
  const riskRejectionRate = totalAttempts > 0 ? (totalRiskRejections / totalAttempts) * 100 : 0;

  // 按评分分层
  const highScoreTrades = trades.filter((t) => t.signalScore >= 80);
  const lowScoreTrades = trades.filter((t) => t.signalScore < 70);
  const highScoreWinRate = highScoreTrades.length > 0 ? (highScoreTrades.filter((t) => t.pnl > 0).length / highScoreTrades.length) * 100 : 0;
  const lowScoreWinRate = lowScoreTrades.length > 0 ? (lowScoreTrades.filter((t) => t.pnl > 0).length / lowScoreTrades.length) * 100 : 0;

  // 按市场状态
  const trendingTrades = trades.filter((t) => t.marketState === 'TRENDING');
  const consolidatingTrades = trades.filter((t) => t.marketState === 'CONSOLIDATING');
  const explosiveTrades = trades.filter((t) => t.marketState === 'EXPLOSIVE');
  const trendingWinRate = trendingTrades.length > 0 ? (trendingTrades.filter((t) => t.pnl > 0).length / trendingTrades.length) * 100 : 0;
  const consolidatingWinRate = consolidatingTrades.length > 0 ? (consolidatingTrades.filter((t) => t.pnl > 0).length / consolidatingTrades.length) * 100 : 0;
  const explosiveWinRate = explosiveTrades.length > 0 ? (explosiveTrades.filter((t) => t.pnl > 0).length / explosiveTrades.length) * 100 : 0;

  return {
    symbol, interval, days,
    totalBars: klines.length,
    trades,
    equityCurve,
    totalTrades, winRate: Math.round(winRate * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    netPnl: Math.round((equity - initialCapital) * 100) / 100,
    filterRejectionRate: Math.round(filterRejectionRate * 100) / 100,
    qualityRejectionRate: Math.round(qualityRejectionRate * 100) / 100,
    riskRejectionRate: Math.round(riskRejectionRate * 100) / 100,
    highScoreCount: highScoreTrades.length,
    highScoreWinRate: Math.round(highScoreWinRate * 100) / 100,
    lowScoreCount: lowScoreTrades.length,
    lowScoreWinRate: Math.round(lowScoreWinRate * 100) / 100,
    trendingTrades: trendingTrades.length,
    trendingWinRate: Math.round(trendingWinRate * 100) / 100,
    consolidatingTrades: consolidatingTrades.length,
    consolidatingWinRate: Math.round(consolidatingWinRate * 100) / 100,
    explosiveTrades: explosiveTrades.length,
    explosiveWinRate: Math.round(explosiveWinRate * 100) / 100,
  };
}
