/**
 * 信号评分器 — 给每个交易信号打分
 *
 * 评分维度（总分 100）：
 * - 趋势强度 (25) — ADX + EMA 排列
 * - 成交量 (20) — 当前量 vs 均量
 * - 波动率 (20) — ATR 位置
 * - 结构位置 (20) — 关键水平附近
 * - 时间窗口 (15) — 交易时段
 *
 * 规则：
 * < 60 : 禁止交易
 * 60~80 : 正常仓位
 * ≥ 80 : 允许加仓
 */

import type { KlineData } from './exchange';
import { closes, highs, lows, SMA, EMA, ADX, ATR } from './strategyIndicators';
import type { KlineInterval } from './exchange';

export interface SignalScore {
  totalScore: number;       // 0-100
  trendScore: number;       // 0-25
  volumeScore: number;      // 0-20
  volatilityScore: number;  // 0-20
  structureScore: number;   // 0-20
  timeScore: number;        // 0-15
  level: 'FORBIDDEN' | 'NORMAL' | 'BOOST';
  reasons: string[];
}

const ACTIVE_HOURS = [
  { start: 14, end: 16 },
  { start: 21, end: 24 },
];

/**
 * 对市场信号进行综合评分
 */
export function scoreSignal(klines: KlineData[], interval: KlineInterval = '1h'): SignalScore {
  const prices = closes(klines);
  const volumes = klines.map((k) => k.volume);
  const n = prices.length;
  const reasons: string[] = [];

  if (n < 30) {
    return {
      totalScore: 0, trendScore: 0, volumeScore: 0,
      volatilityScore: 0, structureScore: 0, timeScore: 0,
      level: 'FORBIDDEN', reasons: ['数据不足'],
    };
  }

  // ① 趋势强度 (25分)
  let trendScore = 0;
  const adxVals = ADX(klines, 14);
  const adx = adxVals.adx[n - 1] ?? 0;
  const sma20 = SMA(prices, 20);
  const sma50 = SMA(prices, 50);

  if (adx >= 30) { trendScore += 15; reasons.push(`ADX=${adx.toFixed(1)} 趋势强劲`); }
  else if (adx >= 25) { trendScore += 10; reasons.push(`ADX=${adx.toFixed(1)} 趋势形成`); }
  else if (adx >= 20) { trendScore += 5; reasons.push(`ADX=${adx.toFixed(1)} 趋势酝酿`); }
  else { reasons.push(`ADX=${adx.toFixed(1)} 无明显趋势`); }

  if (sma20[n - 1] !== undefined && sma50[n - 1] !== undefined) {
    if (sma20[n - 1]! > sma50[n - 1]!) { trendScore += 10; reasons.push('短期均线 > 长期均线'); }
    else { reasons.push('短期均线 < 长期均线'); }
  }

  // ② 成交量 (20分)
  let volumeScore = 0;
  const currVol = volumes[n - 1] ?? 0;
  const avgVol = volumes.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, volumes.length);
  const volumeRatio = avgVol > 0 ? currVol / avgVol : 1;

  if (volumeRatio >= 2) { volumeScore = 20; reasons.push(`量${volumeRatio.toFixed(1)}x 放量突破`); }
  else if (volumeRatio >= 1.5) { volumeScore = 15; reasons.push(`量${volumeRatio.toFixed(1)}x 温和放量`); }
  else if (volumeRatio >= 0.8) { volumeScore = 10; reasons.push(`量${volumeRatio.toFixed(1)}x 成交量正常`); }
  else { volumeScore = 5; reasons.push(`量${volumeRatio.toFixed(1)}x 缩量`); }

  // ③ 波动率 (20分)
  let volatilityScore = 0;
  const atrVals = ATR(klines, 14);
  const currATR = atrVals[n - 1] ?? 0;
  const atrSlice = atrVals.slice(-20).filter((v): v is number => v !== undefined && v > 0);
  const avgATR = atrSlice.length > 0 ? atrSlice.reduce((s, v) => s + v, 0) / atrSlice.length : currATR;
  const atrRatio = avgATR > 0 ? currATR / avgATR : 1;
  const atrPercent = prices[n - 1] > 0 ? (currATR / prices[n - 1]) * 100 : 0;

  if (atrRatio >= 0.5 && atrRatio <= 1.5) {
    volatilityScore = 20;
    reasons.push(`ATR适中 ${atrPercent.toFixed(2)}%`);
  } else if (atrRatio < 0.5) {
    volatilityScore = 5;
    reasons.push(`ATR过低 ${atrPercent.toFixed(2)}% 波动不足`);
  } else {
    volatilityScore = 10;
    reasons.push(`ATR偏高 ${atrPercent.toFixed(2)}%`);
  }

  // ④ 结构位置 (20分)
  let structureScore = 0;
  const recentHigh = Math.max(...highs(klines).slice(-10));
  const recentLow = Math.min(...lows(klines).slice(-10));
  const currPrice = prices[n - 1];
  const range = recentHigh - recentLow;

  if (range > 0) {
    const positionInRange = (currPrice - recentLow) / range;
    if (positionInRange > 0.7 || positionInRange < 0.3) {
      structureScore = 20;
      reasons.push(positionInRange > 0.7 ? '价格在区间上沿' : '价格在区间下沿');
    } else if (positionInRange > 0.6 || positionInRange < 0.4) {
      structureScore = 15;
      reasons.push('价格在区间边缘');
    } else {
      structureScore = 10;
      reasons.push('价格在区间中部');
    }
  }

  // ⑤ 时间窗口 (15分)
  let timeScore = 0;
  const now = new Date();
  const hour = now.getHours();
  const minutes = hour * 60 + now.getMinutes();

  for (const s of ACTIVE_HOURS) {
    if (minutes >= s.start * 60 && minutes < s.end * 60) {
      timeScore = 15;
      reasons.push('活跃交易时段');
      break;
    }
  }
  if (timeScore === 0) {
    timeScore = hour >= 8 && hour < 14 ? 5 : 0;
    reasons.push(timeScore > 0 ? '亚洲盘时间' : '非活跃时段');
  }

  const totalScore = trendScore + volumeScore + volatilityScore + structureScore + timeScore;
  let level: SignalScore['level'];
  if (totalScore < 60) level = 'FORBIDDEN';
  else if (totalScore >= 80) level = 'BOOST';
  else level = 'NORMAL';

  return {
    totalScore,
    trendScore,
    volumeScore,
    volatilityScore,
    structureScore,
    timeScore,
    level,
    reasons,
  };
}

/** 简版检查 */
export function quickScoreCheck(klines: KlineData[]): { allowed: boolean; score: number; level: string; reason: string } {
  const result = scoreSignal(klines);
  return {
    allowed: result.totalScore >= 60,
    score: result.totalScore,
    level: result.level === 'FORBIDDEN' ? '禁止' : result.level === 'BOOST' ? '加仓' : '正常',
    reason: result.reasons.join(' | '),
  };
}
