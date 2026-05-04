/**
 * 交易质量评分器 — 评估每笔潜在交易的质量
 *
 * 5个维度，每个 0-20 分，总分 0-100：
 * ① 回踩干净 — 价格是否回踩均线/支撑后再启动
 * ② 结构清晰 — K线形态是否完整
 * ③ 止损合理 — 止损距离合理
 * ④ 风险收益比 — R:R ≥ 1:2
 * ⑤ 时间窗口 — 当前在活跃交易时段
 *
 * 行为规则：
 * < 70 : 不做（放弃）
 * 70~85 : 正常仓位
 * ≥ 85 : 允许加仓
 */

import type { KlineData } from './exchange';
import { closes, lows, highs, SMA, EMA, BollingerBands, ATR } from './strategyIndicators';
import type { TradeQualityScore } from './types';

// ==================== 活跃时段 ====================

const ACTIVE_HOURS = [
  { start: 14, end: 16, name: '亚洲尾盘' },
  { start: 21, end: 24, name: '美盘开盘' },
];

// ==================== ① 回踩干净评分 ====================

function scorePullbackClean(klines: KlineData[], direction: 'LONG' | 'SHORT'): { score: number; reason: string } {
  const prices = closes(klines);
  const cls = closes(klines);
  const n = prices.length;
  if (n < 30) return { score: 0, reason: '数据不足' };

  const sma20 = SMA(prices, 20);
  const sma50 = SMA(prices, 50);
  const currPrice = prices[n - 1];

  let score = 0;
  const reasons: string[] = [];

  if (direction === 'LONG') {
    // 检查是否回踩了 SMA(20) 或 SMA(50)
    const sma20Val = sma20[n - 1];
    const sma50Val = sma50[n - 1];

    if (sma20Val !== undefined && Math.abs(currPrice - sma20Val) / sma20Val < 0.01) {
      score += 10;
      reasons.push('精准回踩SMA(20)');
    } else if (sma50Val !== undefined && Math.abs(currPrice - sma50Val) / sma50Val < 0.01) {
      score += 8;
      reasons.push('回踩SMA(50)附近');
    } else if (sma20Val !== undefined && currPrice > sma20Val && (currPrice - sma20Val) / sma20Val < 0.03) {
      score += 6;
      reasons.push('在SMA(20)上方附近');
    }

    // 检查是否在前低支撑附近
    const recentLows = lows(klines).slice(-10);
    const minLow = Math.min(...recentLows);
    if (currPrice > minLow && (currPrice - minLow) / currPrice < 0.02) {
      score += 10;
      reasons.push('接近近期低点支撑');
    }
  } else {
    const sma20Val = sma20[n - 1];
    const sma50Val = sma50[n - 1];

    if (sma20Val !== undefined && Math.abs(currPrice - sma20Val) / sma20Val < 0.01) {
      score += 10;
      reasons.push('精准反抽SMA(20)');
    } else if (sma50Val !== undefined && Math.abs(currPrice - sma50Val) / sma50Val < 0.01) {
      score += 8;
      reasons.push('反抽SMA(50)附近');
    }

    const recentHighs = highs(klines).slice(-10);
    const maxHigh = Math.max(...recentHighs);
    if (currPrice < maxHigh && (maxHigh - currPrice) / currPrice < 0.02) {
      score += 10;
      reasons.push('接近近期高点阻力');
    }
  }

  return {
    score: Math.min(20, score),
    reason: reasons.length > 0 ? reasons.join('；') : '无明显回踩形态',
  };
}

// ==================== ② 结构清晰评分 ====================

function scoreStructure(klines: KlineData[], direction: 'LONG' | 'SHORT'): { score: number; reason: string } {
  const prices = closes(klines);
  const n = prices.length;
  if (n < 20) return { score: 0, reason: '数据不足' };

  let score = 0;
  const reasons: string[] = [];

  // 检查布林带上下轨是否清晰
  const bb = BollingerBands(prices, 20, 2);
  const bbWidth = bb.upper[n - 1] !== undefined && bb.lower[n - 1] !== undefined
    ? ((bb.upper[n - 1]! - bb.lower[n - 1]!) / bb.middle[n - 1]!) * 100
    : 0;

  if (bbWidth > 0 && bbWidth < 10) {
    score += 10;
    reasons.push('布林带宽度适中，结构清晰');
  } else if (bbWidth >= 10) {
    score += 5;
    reasons.push('布林带偏宽，波动较大');
  }

  // 均线排列检查
  const sma10 = SMA(prices, 10);
  const sma30 = SMA(prices, 30);
  if (sma10[n - 1] !== undefined && sma30[n - 1] !== undefined) {
    if (direction === 'LONG' && sma10[n - 1]! > sma30[n - 1]!) {
      score += 10;
      reasons.push('均线多头排列');
    } else if (direction === 'SHORT' && sma10[n - 1]! < sma30[n - 1]!) {
      score += 10;
      reasons.push('均线空头排列');
    } else {
      reasons.push('均线排列不清晰');
    }
  }

  return {
    score: Math.min(20, score),
    reason: reasons.length > 0 ? reasons.join('；') : '结构不够清晰',
  };
}

// ==================== ③ 止损合理评分 ====================

function scoreStopLoss(entryPrice: number, stopLoss: number): { score: number; reason: string } {
  if (stopLoss <= 0 || entryPrice <= 0) return { score: 0, reason: '未设置止损' };

  const stopDistPercent = Math.abs(entryPrice - stopLoss) / entryPrice * 100;

  let score = 0;
  let reason: string;

  if (stopDistPercent < 0.3) {
    score = 5;
    reason = `止损过近 ${stopDistPercent.toFixed(2)}%，容易被扫`;
  } else if (stopDistPercent < 0.5) {
    score = 10;
    reason = `止损偏近 ${stopDistPercent.toFixed(2)}%`;
  } else if (stopDistPercent <= 3) {
    score = 20;
    reason = `止损合理 ${stopDistPercent.toFixed(2)}%`;
  } else if (stopDistPercent <= 5) {
    score = 15;
    reason = `止损偏宽 ${stopDistPercent.toFixed(2)}%，风险稍大`;
  } else {
    score = 5;
    reason = `止损过宽 ${stopDistPercent.toFixed(2)}%，风险太大`;
  }

  return { score, reason };
}

// ==================== ④ 风险收益比评分 ====================

function scoreRR(entryPrice: number, stopLoss: number, takeProfit: number[]): { score: number; reason: string } {
  if (stopLoss <= 0 || entryPrice <= 0 || takeProfit.length === 0) {
    return { score: 0, reason: '未设置止损或止盈' };
  }

  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit[0] - entryPrice);
  const rr = risk > 0 ? reward / risk : 0;

  let score = 0;
  let reason: string;

  if (rr >= 3) {
    score = 20;
    reason = `风险收益比极好 1:${rr.toFixed(1)}`;
  } else if (rr >= 2) {
    score = 20;
    reason = `风险收益比良好 1:${rr.toFixed(1)}`;
  } else if (rr >= 1.5) {
    score = 15;
    reason = `风险收益比一般 1:${rr.toFixed(1)}`;
  } else if (rr >= 1) {
    score = 10;
    reason = `风险收益比偏低 1:${rr.toFixed(1)}`;
  } else {
    score = 0;
    reason = `风险收益比差 1:${rr.toFixed(1)}，不做`;
  }

  return { score, reason };
}

// ==================== ⑤ 时间窗口评分 ====================

function scoreTimeWindow(): { score: number; reason: string } {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentMinutes = hour * 60 + minute;

  for (const session of ACTIVE_HOURS) {
    const startMin = session.start * 60;
    const endMin = session.end * 60;
    if (currentMinutes >= startMin && currentMinutes < endMin) {
      return { score: 20, reason: `✅ ${session.name} (${session.start}:00~${session.end}:00)` };
    }
  }

  // 非活跃时段但靠近活跃时段也给部分分
  if (hour >= 8 && hour < 14) {
    return { score: 8, reason: '亚洲盘时间，流动性一般' };
  }
  if (hour >= 0 && hour < 8) {
    return { score: 3, reason: '凌晨时段，流动性差' };
  }

  return { score: 0, reason: '非活跃时段，不建议交易' };
}

// ==================== 综合评分 ====================

/**
 * 对一笔潜在交易进行质量评分
 */
export function scoreTradeQuality(params: {
  klines: KlineData[];
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number[];
}): TradeQualityScore {
  const { klines, symbol, direction, entryPrice, stopLoss, takeProfit } = params;

  const pullbackResult = scorePullbackClean(klines, direction);
  const structureResult = scoreStructure(klines, direction);
  const stopResult = scoreStopLoss(entryPrice, stopLoss);
  const rrResult = scoreRR(entryPrice, stopLoss, takeProfit);
  const timeResult = scoreTimeWindow();

  const totalScore = pullbackResult.score + structureResult.score + stopResult.score + rrResult.score + timeResult.score;

  let level: TradeQualityScore['level'];
  if (totalScore < 70) level = 'REJECT';
  else if (totalScore >= 85) level = 'BOOST';
  else level = 'NORMAL';

  const reasons: string[] = [];
  if (pullbackResult.reason) reasons.push(`回踩: ${pullbackResult.reason}`);
  if (structureResult.reason) reasons.push(`结构: ${structureResult.reason}`);
  if (stopResult.reason) reasons.push(`止损: ${stopResult.reason}`);
  if (rrResult.reason) reasons.push(`RR比: ${rrResult.reason}`);
  if (timeResult.reason) reasons.push(`时间: ${timeResult.reason}`);

  return {
    symbol,
    direction,
    timestamp: Date.now(),
    pullbackCleanScore: pullbackResult.score,
    structureScore: structureResult.score,
    stopLossScore: stopResult.score,
    rrScore: rrResult.score,
    timeScore: timeResult.score,
    totalScore,
    level,
    reasons,
  };
}

/**
 * 快速判断 — 是否值得做这笔交易
 */
export function quickQualityCheck(params: {
  klines: KlineData[];
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number[];
}): { doable: boolean; score: number; level: string; reason: string } {
  const result = scoreTradeQuality(params);
  return {
    doable: result.totalScore >= 70,
    score: result.totalScore,
    level: result.level === 'REJECT' ? '放弃' : result.level === 'BOOST' ? '加仓' : '正常',
    reason: result.reasons.join(' | '),
  };
}
