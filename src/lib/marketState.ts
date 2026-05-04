/**
 * 市场状态引擎 — 判断当前市场处于哪种状态
 *
 * 3种状态：
 * ① 趋势市场 — ADX ≥ 25 + 均线发散 + 创新高/低
 * ② 震荡市场 — ADX < 20 + 布林带收窄 + 横盘
 * ③ 爆发行情 — 成交量激增 + ATR扩张 + 价格突破
 */

import type { KlineData } from './exchange';
import { closes, highs, lows, SMA, EMA, ADX, ATR, BollingerBands } from './strategyIndicators';
import type { MarketStateType } from './types';

export interface MarketStateResult {
  state: MarketStateType;
  confidence: number;     // 0-100
  adx: number;
  atrRatio: number;       // 当前ATR / 均值ATR
  volumeRatio: number;    // 当前量 / 均值量
  bbWidth: number;        // 布林带宽度百分比
  description: string;
}

/**
 * 判断当前市场状态
 */
export function determineMarketState(klines: KlineData[]): MarketStateResult {
  const prices = closes(klines);
  const n = prices.length;
  if (n < 50) {
    return {
      state: 'CONSOLIDATING',
      confidence: 0,
      adx: 0,
      atrRatio: 0,
      volumeRatio: 0,
      bbWidth: 0,
      description: `数据不足（${n}/50）`,
    };
  }

  const adxVals = ADX(klines, 14);
  const adx = adxVals.adx[n - 1] ?? adxVals.adx[n - 2] ?? 0;

  // ATR 分析
  const atrVals = ATR(klines, 14);
  const currATR = atrVals[n - 1] ?? 0;
  const atrSlice = atrVals.slice(-20).filter((v): v is number => v !== undefined && v > 0);
  const avgATR = atrSlice.length > 0 ? atrSlice.reduce((s, v) => s + v, 0) / atrSlice.length : currATR;
  const atrRatio = avgATR > 0 ? currATR / avgATR : 1;

  // 成交量分析
  const volumes = klines.map((k) => k.volume);
  const currVol = volumes[n - 1] ?? 0;
  const avgVol = volumes.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, volumes.length);
  const volumeRatio = avgVol > 0 ? currVol / avgVol : 1;

  // 布林带宽度
  const bb = BollingerBands(prices, 20, 2);
  const bbUpper = bb.upper[n - 1];
  const bbLower = bb.lower[n - 1];
  const bbMid = bb.middle[n - 1];
  const bbWidth = bbMid && bbMid > 0 ? ((bbUpper! - bbLower!) / bbMid) * 100 : 0;

  // 趋势检查：是否创新高/低
  const recentHighs = highs(klines).slice(-20);
  const recentLows = lows(klines).slice(-20);
  const currHigh = highs(klines)[n - 1] ?? 0;
  const currLow = lows(klines)[n - 1] ?? 0;
  const max20High = Math.max(...recentHighs);
  const min20Low = Math.min(...recentLows);
  const isNewHigh = currHigh >= max20High;
  const isNewLow = currLow <= min20Low;

  // === 裁决 ===

  // 爆发：成交量激增 + ATR 扩张 + 价格突破
  if (volumeRatio >= 2 && atrRatio >= 1.3 && (isNewHigh || isNewLow)) {
    const confidence = Math.min(100, Math.round(
      Math.min(volumeRatio * 15, 40) +
      Math.min(atrRatio * 20, 30) +
      (adx >= 25 ? 30 : 20)
    ));
    return {
      state: 'EXPLOSIVE',
      confidence,
      adx,
      atrRatio: Math.round(atrRatio * 100) / 100,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      bbWidth: Math.round(bbWidth * 100) / 100,
      description: `🔥 爆发行情！量${volumeRatio.toFixed(1)}x ATR${atrRatio.toFixed(1)}x ADX${adx.toFixed(1)}`,
    };
  }

  // 趋势：ADX >= 25 + 价格方向明确
  if (adx >= 25) {
    const trend = isNewHigh ? '多头' : isNewLow ? '空头' : '趋势';
    const confidence = Math.min(100, Math.round(
      Math.min(adx * 1.5, 40) +
      (isNewHigh || isNewLow ? 30 : 15) +
      (atrRatio >= 0.8 && atrRatio <= 1.5 ? 20 : 10) +
      (volumeRatio >= 1.2 ? 10 : 0)
    ));
    return {
      state: 'TRENDING',
      confidence,
      adx,
      atrRatio: Math.round(atrRatio * 100) / 100,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      bbWidth: Math.round(bbWidth * 100) / 100,
      description: `${trend}趋势 (ADX=${adx.toFixed(1)})，置信度 ${confidence}%`,
    };
  }

  // 震荡：默认
  const confidence = Math.min(100, Math.round(
    (adx < 20 ? 50 : 30) +
    (bbWidth < 5 ? 20 : 10) +
    (volumeRatio < 1.2 ? 20 : 0) +
    (atrRatio < 1.2 ? 10 : 0)
  ));
  return {
    state: 'CONSOLIDATING',
    confidence,
    adx,
    atrRatio: Math.round(atrRatio * 100) / 100,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    bbWidth: Math.round(bbWidth * 100) / 100,
    description: `震荡盘整 (ADX=${adx.toFixed(1)})，建议降低仓位或观望`,
  };
}
