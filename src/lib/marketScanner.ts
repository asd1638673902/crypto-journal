/**
 * 市场扫描引擎
 * 对标 tradingview-mcp 的完整扫描套件
 */

import type { KlineData } from './exchange';
import {
  closes, highs, lows, SMA, RSI, BollingerBands, ATR, ADX, Stochastic,
} from './strategyIndicators';

// ==================== 通用类型 ====================

export interface ScanResult {
  symbol: string;
  score: number;          // 综合评分 0-10
  signals: string[];      // 信号描述
  details: Record<string, any>;
}

// ==================== 1. 布林带挤压扫描 ====================

export interface BBSqueezeResult extends ScanResult {
  bbw: number;
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  price: number;
  changePercent: number;
}

/**
 * 布林带挤压扫描 — 检测带宽极低的品种
 * BW 越低 → 挤压越紧 → 即将突破
 */
export function scanBollingerSqueeze(
  data: KlineData[],
  symbol: string,
  bbPeriod: number = 20,
  bbStd: number = 2,
  bbwThreshold: number = 0.04,
): BBSqueezeResult | null {
  const prices = closes(data);
  const bb = BollingerBands(prices, bbPeriod, bbStd);

  const lastIdx = data.length - 1;
  if (bb.upper[lastIdx] === undefined || bb.lower[lastIdx] === undefined || bb.middle[lastIdx] === undefined) {
    return null;
  }

  const upper = bb.upper[lastIdx]!;
  const lower = bb.lower[lastIdx]!;
  const middle = bb.middle[lastIdx]!;
  const bbw = middle > 0 ? (upper - lower) / middle : 0;

  if (bbw > bbwThreshold) return null;

  const price = data[lastIdx].close;
  const prevPrice = data[lastIdx - 1]?.close ?? price;
  const changePercent = ((price - prevPrice) / prevPrice) * 100;

  const signals: string[] = [];
  let score = 0;

  signals.push(`BBW=${(bbw * 100).toFixed(2)}% 挤压中`);

  // 挤压越紧评分越高
  if (bbw < bbwThreshold * 0.5) {
    score += 4;
    signals.push('🔴 极度挤压');
  } else if (bbw < bbwThreshold * 0.75) {
    score += 3;
    signals.push('⚠️ 较强挤压');
  } else {
    score += 2;
    signals.push('📊 轻度挤压');
  }

  // 价格在布林带下轨附近 = 反弹机会
  if (price <= lower * 1.01) {
    score += 2;
    signals.push('📈 触及下轨');
  }
  // 价格在上轨附近 = 突破可能
  if (price >= upper * 0.99) {
    score += 2;
    signals.push('🚀 逼近上轨');
  }

  // RSI 辅助
  const rsi = RSI(prices, 14);
  const rsiVal = rsi[lastIdx];
  if (rsiVal !== undefined) {
    if (rsiVal < 30) {
      score += 2;
      signals.push('🟢 RSI超卖');
    } else if (rsiVal > 70) {
      score += 1;
      signals.push('🔴 RSI超买');
    }
  }

  return {
    symbol,
    score: Math.min(10, score),
    signals,
    bbw,
    bbUpper: upper,
    bbLower: lower,
    bbMiddle: middle,
    price,
    changePercent,
  };
}

// ==================== 2. 成交量突破扫描 ====================

export interface VolumeBreakoutResult extends ScanResult {
  volumeRatio: number;
  priceChange: number;
  currentVolume: number;
  avgVolume: number;
}

/**
 * 成交量突破扫描 — 量价同步放大
 */
export function scanVolumeBreakout(
  data: KlineData[],
  symbol: string,
  volumeMultiplier: number = 2.0,
  priceChangeMin: number = 2.0,
): VolumeBreakoutResult | null {
  const prices = closes(data);
  const vols = data.map((k) => k.volume);
  const lastIdx = data.length - 1;

  if (lastIdx < 20) return null;

  // 计算20周期均量
  let volSum = 0;
  for (let i = lastIdx - 20; i < lastIdx; i++) {
    volSum += vols[i];
  }
  const avgVol = volSum / 20;
  const currentVol = vols[lastIdx];
  const volumeRatio = avgVol > 0 ? currentVol / avgVol : 0;

  if (volumeRatio < volumeMultiplier) return null;

  const priceChange = ((prices[lastIdx] - prices[lastIdx - 1]) / prices[lastIdx - 1]) * 100;
  if (Math.abs(priceChange) < priceChangeMin) return null;

  const signals: string[] = [];
  let score = 0;

  const volIntensity = Math.min(10, volumeRatio);
  signals.push(`💹 成交量 ${volIntensity.toFixed(1)}x 均量`);
  score += Math.min(5, volIntensity / 2);

  if (priceChange > 0) {
    signals.push('🚀 看涨放量突破');
    score += 3;
  } else {
    signals.push('📉 看跌放量下跌');
    score += 2;
  }

  // RSI 确认
  const rsi = RSI(prices, 14);
  const rsiVal = rsi[lastIdx];
  if (rsiVal !== undefined && rsiVal > 70 && priceChange > 0) {
    signals.push('⚠️ 但RSI超买');
  } else if (rsiVal !== undefined && rsiVal < 30 && priceChange < 0) {
    signals.push('⚠️ 但RSI超卖');
  }

  return {
    symbol,
    score: Math.min(10, score),
    signals,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    priceChange: Math.round(priceChange * 100) / 100,
    currentVolume: currentVol,
    avgVolume,
  };
}

// ==================== 3. 智能成交量扫描 ====================

export interface SmartVolumeResult extends ScanResult {
  volumeRatio: number;
  priceChange: number;
  rsi: number | undefined;
  recommendation: string;
}

/**
 * 智能成交量扫描 — 成交量 + RSI + 交易建议
 */
export function scanSmartVolume(
  data: KlineData[],
  symbol: string,
): SmartVolumeResult | null {
  const prices = closes(data);
  const lastIdx = data.length - 1;
  if (lastIdx < 21) return null;

  // 均量
  let volSum = 0;
  for (let i = lastIdx - 20; i < lastIdx; i++) volSum += data[i].volume;
  const avgVol = volSum / 20;
  const volumeRatio = avgVol > 0 ? data[lastIdx].volume / avgVol : 0;
  if (volumeRatio < 1.2) return null;

  const rsi = RSI(prices, 14);
  const rsiVal = rsi[lastIdx];
  const priceChange = ((prices[lastIdx] - prices[lastIdx - 1]) / prices[lastIdx - 1]) * 100;

  const signals: string[] = [];
  let score = 0;
  let recommendation = '';

  if (priceChange > 0) {
    signals.push('📈 上涨');
    if (rsiVal !== undefined && rsiVal < 70) {
      recommendation = '🚀 STRONG BUY';
      score = 8;
      signals.push('🟢 RSI中性 + 放量上涨');
    } else {
      recommendation = '⚠️ OVERBOUGHT - CAUTION';
      score = 4;
      signals.push('🔴 RSI超买区，注意回调');
    }
  } else {
    signals.push('📉 下跌');
    if (rsiVal !== undefined && rsiVal > 30) {
      recommendation = '📉 STRONG SELL';
      score = 6;
      signals.push('🔴 RSI中性 + 放量下跌');
    } else {
      recommendation = '🛒 OVERSOLD - OPPORTUNITY?';
      score = 7;
      signals.push('🟢 RSI超卖，观察反弹');
    }
  }

  return {
    symbol,
    score: Math.min(10, score),
    signals,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    priceChange: Math.round(priceChange * 100) / 100,
    rsi: rsiVal !== undefined ? Math.round(rsiVal * 100) / 100 : undefined,
    recommendation,
  };
}

// ==================== 4. 连续K线形态扫描 ====================

export interface CandlePatternResult extends ScanResult {
  patternType: 'bullish' | 'bearish';
  candleCount: number;
  totalChange: number;
  avgBodyRatio: number;
  strength: number; // 1-5
}

/**
 * 连续K线形态检测
 */
export function scanConsecutiveCandles(
  data: KlineData[],
  symbol: string,
  patternType: 'bullish' | 'bearish',
  candleCount: number = 3,
  minGrowth: number = 3.0,
): CandlePatternResult | null {
  const prices = closes(data);
  const lastIdx = data.length - 1;
  if (lastIdx < candleCount) return null;

  // 检测连续 N 根同向K线
  let matchCount = 0;
  let totalChange = 0;
  let totalBodyRatio = 0;

  for (let i = 0; i < candleCount; i++) {
    const idx = lastIdx - i;
    const candle = data[idx];
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    const bodyRatio = range > 0 ? body / range : 0;
    const change = ((candle.close - candle.open) / candle.open) * 100;

    const isBullish = candle.close > candle.open;
    const isBearish = candle.close < candle.open;

    if (patternType === 'bullish' && isBullish) matchCount++;
    else if (patternType === 'bearish' && isBearish) matchCount++;
    else return null;

    totalChange += change;
    totalBodyRatio += bodyRatio;
  }

  if (matchCount < candleCount) return null;

  const avgBodyRatio = totalBodyRatio / candleCount;
  const strength = Math.min(5, Math.max(1,
    Math.floor(totalChange / minGrowth) + (avgBodyRatio > 0.6 ? 1 : 0)
  ));

  // RSI 过滤
  const rsi = RSI(prices, 14);
  const rsiVal = rsi[lastIdx];
  let score = strength;
  const signals: string[] = [];

  signals.push(`${patternType === 'bullish' ? '📈' : '📉'} 连续${candleCount}根${patternType === 'bullish' ? '上涨' : '下跌'}`);
  signals.push(`累计 ${totalChange >= 0 ? '+' : ''}${totalChange.toFixed(2)}%`);

  if (avgBodyRatio > 0.7) {
    score += 2;
    signals.push('💪 强实体');
  } else if (avgBodyRatio > 0.5) {
    score += 1;
    signals.push('👍 中等实体');
  }

  if (patternType === 'bullish' && rsiVal !== undefined && rsiVal >= 45 && rsiVal <= 80) {
    score += 1;
    signals.push('✅ RSI动量支持');
  }
  if (patternType === 'bearish' && rsiVal !== undefined && rsiVal >= 20 && rsiVal <= 55) {
    score += 1;
    signals.push('✅ RSI动量支持');
  }

  return {
    symbol,
    score: Math.min(10, score),
    signals,
    patternType,
    candleCount: matchCount,
    totalChange: Math.round(totalChange * 100) / 100,
    avgBodyRatio: Math.round(avgBodyRatio * 100) / 100,
    strength,
  };
}

// ==================== 5. 布林带评级筛选 ====================

export interface BBRatingResult extends ScanResult {
  rating: number; // -3 to +3
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  price: number;
}

/**
 * 布林带评级系统
 * rating = -3 (强烈卖出) 到 +3 (强烈买入)
 */
export function scanBBRating(
  data: KlineData[],
  symbol: string,
  targetRating?: number,
): BBRatingResult | null {
  const prices = closes(data);
  const bb = BollingerBands(prices, 20, 2);
  const lastIdx = data.length - 1;

  if (bb.upper[lastIdx] === undefined || bb.lower[lastIdx] === undefined || bb.middle[lastIdx] === undefined) {
    return null;
  }

  const upper = bb.upper[lastIdx]!;
  const middle = bb.middle[lastIdx]!;
  const lower = bb.lower[lastIdx]!;
  const price = data[lastIdx].close;

  let rating: number;
  const range = upper - lower;

  if (price >= upper) rating = 3;
  else if (price >= upper - range * 0.15) rating = 2;
  else if (price >= middle + range * 0.1) rating = 1;
  else if (price >= middle - range * 0.1) rating = 0;
  else if (price >= lower + range * 0.15) rating = -1;
  else if (price >= lower) rating = -2;
  else rating = -3;

  if (targetRating !== undefined && rating !== targetRating) return null;

  const ratingLabels: Record<number, string> = {
    3: '🚀 强烈买入（突破上轨）',
    2: '📈 买入（上轨附近）',
    1: '📊 偏多（中轨-上轨）',
    0: '➖ 中性（中轨附近）',
    [-1]: '📉 偏空（中轨-下轨）',
    [-2]: '📉 卖出（下轨附近）',
    [-3]: '🛒 强烈卖出（跌破下轨）',
  };

  const signals: string[] = [ratingLabels[rating] || `评级 ${rating}`];
  const score = rating >= 0 ? Math.min(10, rating * 3 + 3) : Math.min(10, Math.abs(rating) * 2 + 2);

  return {
    symbol,
    score: Math.max(1, score),
    signals,
    rating,
    bbUpper: upper,
    bbLower: lower,
    bbMiddle: middle,
    price,
  };
}

// ==================== 6. ADX趋势扫描 ====================

export interface TrendResult extends ScanResult {
  adx: number;
  plusDI: number;
  minusDI: number;
  trend: 'strong_trend' | 'weak_trend' | 'ranging';
}

export function scanTrend(
  data: KlineData[],
  symbol: string,
): TrendResult | null {
  const prices = closes(data);
  const lastIdx = data.length - 1;
  if (lastIdx < 26) return null;

  const adxResult = ADX(data, 14);
  const adxVal = adxResult.adx[lastIdx];
  const pDI = adxResult.plusDI[lastIdx];
  const mDI = adxResult.minusDI[lastIdx];

  if (adxVal === undefined || pDI === undefined || mDI === undefined) return null;

  let trend: TrendResult['trend'];
  const signals: string[] = [];
  let score = 0;

  if (adxVal >= 25) {
    trend = 'strong_trend';
    score += 5;
    signals.push(`🔥 ADX=${adxVal.toFixed(1)} 强趋势`);
    if (pDI > mDI) {
      signals.push('📈 上升趋势');
      score += 2;
    } else {
      signals.push('📉 下降趋势');
      score += 1;
    }
  } else if (adxVal >= 20) {
    trend = 'weak_trend';
    score += 3;
    signals.push(`📊 ADX=${adxVal.toFixed(1)} 弱趋势`);
  } else {
    trend = 'ranging';
    score += 1;
    signals.push(`➖ ADX=${adxVal.toFixed(1)} 震荡盘整`);
  }

  return {
    symbol,
    score: Math.min(10, score),
    signals,
    adx: Math.round(adxVal * 100) / 100,
    plusDI: Math.round(pDI * 100) / 100,
    minusDI: Math.round(mDI * 100) / 100,
    trend,
  };
}

// ==================== 7. 多时间框架综合扫描 ====================

/**
 * 对单个品种执行全面体检
 */
export function scanFullAnalysis(
  data: KlineData[],
  symbol: string,
): {
  bbSqueeze: BBSqueezeResult | null;
  volumeBreakout: VolumeBreakoutResult | null;
  smartVolume: SmartVolumeResult | null;
  candleBullish: CandlePatternResult | null;
  candleBearish: CandlePatternResult | null;
  bbRating: BBRatingResult | null;
  trend: TrendResult | null;
  overallScore: number;
  allSignals: string[];
  recommendation: string;
} {
  const bbSqueeze = scanBollingerSqueeze(data, symbol);
  const volumeBreakout = scanVolumeBreakout(data, symbol);
  const smartVolume = scanSmartVolume(data, symbol);
  const candleBullish = scanConsecutiveCandles(data, symbol, 'bullish', 3);
  const candleBearish = scanConsecutiveCandles(data, symbol, 'bearish', 3);
  const bbRating = scanBBRating(data, symbol);
  const trend = scanTrend(data, symbol);

  const allResults = [bbSqueeze, volumeBreakout, smartVolume, candleBullish, candleBearish, bbRating, trend]
    .filter((r): r is ScanResult => r !== null);

  const overallScore = allResults.length > 0
    ? Math.round(allResults.reduce((s, r) => s + r.score, 0) / allResults.length * 10) / 10
    : 0;

  const allSignals = allResults.flatMap((r) => r.signals);

  // 综合建议
  let recommendation = '➖ 无明确信号';
  if (overallScore >= 7) {
    recommendation = '🚀 强烈信号 — 重点关注';
  } else if (overallScore >= 5) {
    recommendation = '📊 中等信号 — 可关注';
  } else if (overallScore >= 3) {
    recommendation = '👀 弱信号 — 继续观察';
  }

  return {
    bbSqueeze,
    volumeBreakout,
    smartVolume,
    candleBullish,
    candleBearish,
    bbRating,
    trend,
    overallScore,
    allSignals,
    recommendation,
  };
}

// ==================== 8. 蓄势突破扫描 ====================

export interface AccumulationBreakoutResult extends ScanResult {
  phase: 'accumulating' | 'breaking_out' | 'both' | 'neither';
  accumulationScore: number;
  breakoutScore: number;
  bbw: number;
  adx: number;
  volumeRatio: number;
  priceChange24h: number;
  price: number;
}

/**
 * 蓄势突破扫描 — 检测蓄势（BB挤压+低ADX+缩量）→ 突破（放量+ADX转强+价格突破）
 */
export function scanAccumulationBreakout(
  data: KlineData[],
  symbol: string,
  priceChange24h: number = 0,
): AccumulationBreakoutResult | null {
  const prices = closes(data);
  const n = data.length;
  if (n < 50) return null;

  const lastIdx = n - 1;
  const price = prices[lastIdx];

  // 1. 布林带宽度
  const bb = BollingerBands(prices, 20, 2);
  if (bb.upper[lastIdx] === undefined || bb.lower[lastIdx] === undefined || bb.middle[lastIdx] === undefined) return null;
  const bbw = (bb.upper[lastIdx]! - bb.lower[lastIdx]!) / bb.middle[lastIdx]!;

  // 2. ADX
  const adxResult = ADX(data, 14);
  const adxVal = adxResult.adx[lastIdx] ?? 0;
  const adxPrev = adxResult.adx[Math.max(0, lastIdx - 5)] ?? 0;
  const adxRising = adxVal > adxPrev;

  // 3. 成交量
  let volSum = 0;
  for (let i = lastIdx - 20; i < lastIdx; i++) volSum += data[i].volume;
  const avgVol = volSum / 20;
  const volumeRatio = avgVol > 0 ? data[lastIdx].volume / avgVol : 0;

  // 4. 价格相对BB位置
  const priceAtUpper = price >= bb.upper[lastIdx]! * 0.99;
  const priceAtLower = price <= bb.lower[lastIdx]! * 1.01;

  // 5. 近期价格变化
  const tenBarChange = n > 10 ? ((price - prices[lastIdx - 10]) / prices[lastIdx - 10]) * 100 : 0;

  // ---- 蓄势评分 ----
  let accScore = 0;
  const accSignals: string[] = [];

  if (bbw < 0.03) { accScore += 4; accSignals.push('🔴 极度挤压'); }
  else if (bbw < 0.05) { accScore += 3; accSignals.push('⚠️ 明显挤压'); }
  else if (bbw < 0.08) { accScore += 1.5; accSignals.push('📊 轻度挤压'); }

  if (adxVal < 18) { accScore += 2; accSignals.push('🔄 ADX极低'); }
  else if (adxVal < 23) { accScore += 1; accSignals.push('🌀 ADX偏低'); }

  if (volumeRatio < 0.6) { accScore += 1.5; accSignals.push('🔇 缩量'); }
  else if (volumeRatio < 0.85) { accScore += 0.5; }

  const recentHigh = Math.max(...prices.slice(-20));
  const recentLow = Math.min(...prices.slice(-20));
  const rangePct = recentLow > 0 ? ((recentHigh - recentLow) / recentLow) * 100 : 0;
  if (rangePct < 5) { accScore += 1; accSignals.push('📐 区间收窄'); }

  // ---- 突破评分 ----
  let brkScore = 0;
  const brkSignals: string[] = [];

  if (volumeRatio > 3) { brkScore += 3; brkSignals.push('💥 巨量'); }
  else if (volumeRatio > 2) { brkScore += 2; brkSignals.push('💹 放量'); }
  else if (volumeRatio > 1.3) { brkScore += 1; brkSignals.push('📈 量增'); }

  if (priceAtUpper && tenBarChange > 3) { brkScore += 2.5; brkSignals.push('🚀 突破上轨'); }
  else if (priceAtUpper) { brkScore += 1; brkSignals.push('📤 触及上轨'); }
  if (priceAtLower && tenBarChange < -3) { brkScore += 2; brkSignals.push('📉 跌破下轨'); }

  if (adxVal > 25 && adxRising) { brkScore += 2.5; brkSignals.push('⚡ ADX转强'); }
  else if (adxVal > 20 && adxRising) { brkScore += 1; }

  if (Math.abs(tenBarChange) > 5) { brkScore += 1.5; }
  else if (Math.abs(tenBarChange) > 3) { brkScore += 0.5; }

  // ---- 阶段判定 ----
  let phase: AccumulationBreakoutResult['phase'];
  if (accScore >= 5 && brkScore >= 4) phase = 'both';
  else if (accScore >= 4) phase = 'accumulating';
  else if (brkScore >= 4) phase = 'breaking_out';
  else phase = 'neither';

  // ---- 综合 ----
  const totalScore = Math.min(10, Math.round((accScore + brkScore) * 10) / 10);
  const signals: string[] = [];

  if (accScore >= 4) signals.push(`📦 蓄势 ${accScore.toFixed(1)}/10`);
  if (brkScore >= 4) signals.push(`💥 突破 ${brkScore.toFixed(1)}/10`);

  if (phase === 'both') signals.unshift('🔥🔥 蓄势突破 — 最佳机会');
  else if (phase === 'accumulating') signals.unshift('⏳ 蓄势中 — 即将爆发');
  else if (phase === 'breaking_out') signals.unshift('🚀 突破中 — 顺势跟进');
  else signals.unshift('➖ 无明显信号');

  if (bbw < 0.05) signals.push(`BBW=${(bbw * 100).toFixed(2)}%`);
  if (adxVal > 0) signals.push(`ADX=${adxVal.toFixed(1)}`);
  if (volumeRatio > 1.5) signals.push(`量×${volumeRatio.toFixed(1)}`);

  return {
    symbol,
    score: totalScore,
    signals,
    phase,
    accumulationScore: Math.min(10, Math.round(accScore * 10) / 10),
    breakoutScore: Math.min(10, Math.round(brkScore * 10) / 10),
    bbw: Math.round(bbw * 10000) / 100,
    adx: Math.round(adxVal * 10) / 10,
    volumeRatio: Math.round(volumeRatio * 10) / 10,
    priceChange24h,
    price,
  };
}
