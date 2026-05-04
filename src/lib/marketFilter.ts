/**
 * 市场过滤器 — 三个硬过滤条件
 * 
 * 只有全部通过才允许交易：
 * ① 趋势强度：EMA 斜率 + 价格结构
 * ② 波动率：ATR 适中
 * ③ 时间窗口：活跃交易时段
 */

import type { KlineData } from './exchange';
import { closes, EMA, ATR, SMA } from './strategyIndicators';
import type { MarketFilterResult } from './types';

// ==================== 常量 ====================

/** 活跃交易时段（UTC+8） */
const ACTIVE_HOURS = [
  { start: 14, end: 16, name: '亚洲尾盘波动段' },
  { start: 21, end: 24, name: '美盘开盘' },
];

const STORAGE_KEY = 'crypto-journal-market-filter-logs';

// ==================== ① 趋势强度过滤 ====================

interface TrendStrengthResult {
  passed: boolean;
  score: number;    // 0-100
  reason: string;
}

/**
 * 计算 EMA 斜率
 * 斜率 = (EMA[n-1] - EMA[n-10]) / EMA[n-10] * 100
 * 正值 = 向上，负值 = 向下
 */
function calcEmaSlope(emaValues: (number | undefined)[], period: number = 10): number {
  const n = emaValues.length;
  if (n < period + 1) return 0;
  const current = emaValues[n - 1];
  const past = emaValues[n - period];
  if (current === undefined || past === undefined || past === 0) return 0;
  return ((current - past) / past) * 100;
}

/**
 * 检测价格是否连续创 N 日新高/低
 */
function detectConsecutiveBreakouts(prices: number[], lookback: number = 20): {
  highBreakouts: number;
  lowBreakouts: number;
} {
  const n = prices.length;
  if (n < lookback + 5) return { highBreakouts: 0, lowBreakouts: 0 };

  let highBreakouts = 0;
  let lowBreakouts = 0;

  // 检查最近5根K线
  for (let i = n - 5; i < n; i++) {
    if (i < 0) continue;
    const window = prices.slice(i - lookback, i);
    const maxInWindow = Math.max(...window);
    const minInWindow = Math.min(...window);

    if (prices[i] > maxInWindow) highBreakouts++;
    if (prices[i] < minInWindow) lowBreakouts++;
  }

  return { highBreakouts, lowBreakouts };
}

function checkTrendStrength(klines: KlineData[]): TrendStrengthResult {
  const prices = closes(klines);
  const n = prices.length;
  if (n < 30) return { passed: false, score: 0, reason: '数据不足' };

  let score = 0;
  const reasons: string[] = [];

  // 1. EMA 斜率检查 (权重 60%)
  const ema20 = EMA(prices, 20);
  const slope = calcEmaSlope(ema20);
  const absSlope = Math.abs(slope);

  if (absSlope > 0.5) {
    score += 60;
    reasons.push(`EMA(20)斜率 ${slope.toFixed(2)}%${slope > 0 ? ' ↗' : ' ↘'}`);
  } else if (absSlope > 0.2) {
    score += 30;
    reasons.push(`EMA(20)斜率偏弱 ${slope.toFixed(2)}%`);
  } else {
    reasons.push(`EMA(20)斜率过平 ${slope.toFixed(2)}%，趋势不明`);
  }

  // 2. 价格结构检查（是否连续突破）(权重 40%)
  const { highBreakouts, lowBreakouts } = detectConsecutiveBreakouts(prices);
  const breakouts = Math.max(highBreakouts, lowBreakouts);

  if (breakouts >= 3) {
    score += 40;
    reasons.push(`连续 ${breakouts} 次创N日新高/低，趋势强劲`);
  } else if (breakouts >= 1) {
    score += 20;
    reasons.push(`有 ${breakouts} 次突破，趋势初步形成`);
  } else {
    reasons.push('未出现创新高/低，结构不清晰');
  }

  const passed = score >= 40;
  return {
    passed,
    score: Math.min(100, score),
    reason: reasons.join('；'),
  };
}

// ==================== ② 波动率过滤 ====================

interface VolatilityResult {
  passed: boolean;
  atrRatio: number;   // 当前ATR / ATR均值
  reason: string;
}

function checkVolatility(klines: KlineData[]): VolatilityResult {
  const prices = closes(klines);
  const n = prices.length;
  if (n < 30) return { passed: false, atrRatio: 0, reason: '数据不足' };

  const atrValues = ATR(klines, 14);
  const currentATR = atrValues[n - 1] ?? 0;

  // 计算过去20根ATR的均值
  const atrSlice = atrValues.slice(-20).filter((v): v is number => v !== undefined && v > 0);
  const avgATR = atrSlice.length > 0 ? atrSlice.reduce((s, v) => s + v, 0) / atrSlice.length : currentATR;

  const ratio = avgATR > 0 ? currentATR / avgATR : 1;
  const currentPrice = prices[n - 1];
  const atrPercent = currentPrice > 0 ? (currentATR / currentPrice) * 100 : 0;

  let passed = false;
  let reason: string;

  if (ratio < 0.5) {
    reason = `ATR过低 ${atrPercent.toFixed(2)}%（均值比 ${ratio.toFixed(2)}）— 没空间，不交易`;
  } else if (ratio > 2.0) {
    reason = `ATR过高 ${atrPercent.toFixed(2)}%（均值比 ${ratio.toFixed(2)}）— 波动过大，降仓`;
    // 过高时我们也允许交易但要降仓
    passed = true;
  } else {
    reason = `ATR适中 ${atrPercent.toFixed(2)}%（均值比 ${ratio.toFixed(2)}）— 正常交易`;
    passed = true;
  }

  return { passed, atrRatio: Math.round(ratio * 100) / 100, reason };
}

// ==================== ③ 时间过滤 ====================

interface TimeWindowResult {
  passed: boolean;
  currentHour: number;
  reason: string;
}

function checkTimeWindow(): TimeWindowResult {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentMinutes = hour * 60 + minute;

  // 检查是否在活跃时段
  for (const session of ACTIVE_HOURS) {
    const startMin = session.start * 60;
    const endMin = session.end * 60;
    if (currentMinutes >= startMin && currentMinutes < endMin) {
      return {
        passed: true,
        currentHour: hour + minute / 60,
        reason: `当前在活跃时段：${session.name} (${session.start}:00~${session.end}:00)`,
      };
    }
  }

  return {
    passed: false,
    currentHour: hour + minute / 60,
    reason: `当前 ${hour}:${String(minute).padStart(2, '0')} 不在活跃交易时段`,
  };
}

// ==================== 综合过滤 ====================

/** 运行全部三个过滤，返回综合结果 */
export function runMarketFilters(klines: KlineData[], ignoreTimeFilter: boolean = false): MarketFilterResult {
  const trendResult = checkTrendStrength(klines);
  const volatilityResult = checkVolatility(klines);
  const timeResult = ignoreTimeFilter
    ? { passed: true, currentHour: new Date().getHours(), reason: '演示模式 — 忽略时间过滤' }
    : checkTimeWindow();

  // 综合评分：趋势强度(40) + 波动率(30) + 时间窗口(30)
  const trendScore = trendResult.passed ? Math.min(40, trendResult.score * 0.4) : 0;
  const volScore = volatilityResult.passed ? (volatilityResult.atrRatio >= 0.5 && volatilityResult.atrRatio <= 2.0 ? 30 : 20) : 0;
  const timeScore = timeResult.passed ? 30 : 0;

  const overallScore = trendScore + volScore + timeScore;

  // 全部通过才允许交易
  const passed = trendResult.passed && volatilityResult.passed && timeResult.passed;

  return {
    passed,
    trendStrength: trendResult,
    volatility: volatilityResult,
    timeWindow: timeResult,
    overallScore: Math.round(overallScore),
  };
}

/** 简版过滤 — 快速检查是否允许交易 */
export function quickFilter(klines: KlineData[], ignoreTimeFilter: boolean = false): { allowed: boolean; reason: string } {
  const result = runMarketFilters(klines, ignoreTimeFilter);
  if (!result.passed) {
    const reasons: string[] = [];
    if (!result.trendStrength.passed) reasons.push(`趋势: ${result.trendStrength.reason}`);
    if (!result.volatility.passed) reasons.push(`波动: ${result.volatility.reason}`);
    if (!result.timeWindow.passed) reasons.push(`时间: ${result.timeWindow.reason}`);
    return { allowed: false, reason: reasons.join(' | ') };
  }
  return { allowed: true, reason: `过滤通过（综合分 ${result.overallScore}）` };
}

// ==================== 存储 ====================

export function saveFilterLog(result: MarketFilterResult): void {
  try {
    const logs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    logs.push({ ...result, timestamp: new Date().toISOString() });
    if (logs.length > 100) logs.splice(0, logs.length - 100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch { /* ignore */ }
}

export function getFilterLogs(): MarketFilterResult[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}
