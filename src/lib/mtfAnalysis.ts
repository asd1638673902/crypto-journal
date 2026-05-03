/**
 * 多时间框架（MTF）分析引擎
 * 同时分析多个周期的趋势一致性，过滤假突破，识别高置信度交易机会
 */

import type { KlineData, KlineInterval } from './exchange';
import {
  closes, highs, lows,
  SMA, EMA, RSI, MACD, BollingerBands, ATR, ADX,
} from './strategyIndicators';
import { analyzeMarketStructure, generateTradeSignal, findKeyLevels, type MarketStructure, type TradeSignal } from './marketAnalysis';

// ==================== 类型定义 ====================

export interface TimeframeAnalysis {
  interval: KlineInterval;
  price: number;
  structure: MarketStructure;
  signal: TradeSignal;
  trendDirection: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  trendStrength: number; // 0-100
  emaAlignment: boolean; // EMA 排列是否多头排列/空头排列
  keyLevelProximity: number; // 距离最近关键水平的距离百分比
}

export interface MtfConsensus {
  alignment: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
  score: number; // -100 ~ +100
  bullishTimeframes: KlineInterval[];
  bearishTimeframes: KlineInterval[];
  neutralTimeframes: KlineInterval[];
  description: string;
}

export interface BreakoutValidation {
  isValid: boolean;
  confidence: number; // 0-100
  warnings: string[];
  confirmations: string[];
  higherTimeframeTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
}

export interface MtfTradeOpportunity {
  symbol: string;
  primaryInterval: KlineInterval;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  consensus: MtfConsensus;
  entryZone: { low: number; high: number };
  stopLoss: number;
  takeProfit: number[];
  riskReward: number;
  reason: string;
  breakoutValidation?: BreakoutValidation;
  timeframeAnalyses: TimeframeAnalysis[];
}

export interface MtfAnalysisResult {
  symbol: string;
  timestamp: number;
  consensus: MtfConsensus;
  opportunities: MtfTradeOpportunity[];
  timeframeAnalyses: TimeframeAnalysis[];
  breakoutValidation: BreakoutValidation;
  summary: string;
}

// ==================== 常量 ====================

const MTF_INTERVALS: KlineInterval[] = ['1h', '4h', '1d'];

// ==================== 核心函数 ====================

/** 分析单个时间框架 */
function analyzeTimeframe(klines: KlineData[], interval: KlineInterval): TimeframeAnalysis | null {
  const prices = closes(klines);
  const n = prices.length;
  if (n < 50) return null;

  const price = prices[n - 1];
  const structure = analyzeMarketStructure(klines);
  const signal = generateTradeSignal(klines);

  // EMA 排列
  const ema12 = EMA(prices, 12);
  const ema26 = EMA(prices, 26);
  const ema50 = EMA(prices, 50);
  const emaAlignment =
    ema12[n - 1] !== undefined && ema26[n - 1] !== undefined && ema50[n - 1] !== undefined
      ? ema12[n - 1]! > ema26[n - 1]! && ema26[n - 1]! > ema50[n - 1]!
      : false;

  // 距离关键水平
  const keyLevels = findKeyLevels(klines);
  const nearest = keyLevels
    .filter((l) => Math.abs(l.price - price) / price < 0.05)
    .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))[0];
  const keyLevelProximity = nearest ? Math.abs(nearest.price - price) / price * 100 : 100;

  return {
    interval,
    price,
    structure,
    signal,
    trendDirection: structure.trend,
    trendStrength: structure.strength,
    emaAlignment,
    keyLevelProximity,
  };
}

/** 计算多时间框架一致性 */
function computeConsensus(analyses: TimeframeAnalysis[]): MtfConsensus {
  const bullish = analyses.filter((a) => a.trendDirection === 'BULLISH');
  const bearish = analyses.filter((a) => a.trendDirection === 'BEARISH');
  const neutral = analyses.filter((a) => a.trendDirection === 'SIDEWAYS');

  const bullishIntervals = bullish.map((a) => a.interval);
  const bearishIntervals = bearish.map((a) => a.interval);
  const neutralIntervals = neutral.map((a) => a.interval);

  // 计算综合得分
  let score = 0;
  for (const a of analyses) {
    if (a.trendDirection === 'BULLISH') score += a.trendStrength * (a.emaAlignment ? 1.5 : 1);
    else if (a.trendDirection === 'BEARISH') score -= a.trendStrength * (a.emaAlignment ? 1.5 : 1);
  }
  score = Math.max(-100, Math.min(100, score / analyses.length));

  let alignment: MtfConsensus['alignment'];
  let description: string;

  if (bullish.length >= 2 && bearish.length === 0) {
    alignment = score >= 60 ? 'STRONG_BULLISH' : 'BULLISH';
    description = `${bullishIntervals.join('+')} 多头共振，趋势一致向上`;
  } else if (bearish.length >= 2 && bullish.length === 0) {
    alignment = score <= -60 ? 'STRONG_BEARISH' : 'BEARISH';
    description = `${bearishIntervals.join('+')} 空头共振，趋势一致向下`;
  } else if (bullish.length > bearish.length) {
    alignment = 'BULLISH';
    description = `偏多格局，${bullishIntervals.join('+')} 向上，${bearishIntervals.join('+')} 尚未确认`;
  } else if (bearish.length > bullish.length) {
    alignment = 'BEARISH';
    description = `偏空格局，${bearishIntervals.join('+')} 向下，${bullishIntervals.join('+')} 尚未确认`;
  } else {
    alignment = 'NEUTRAL';
    description = '各周期方向不一致，建议观望等待信号统一';
  }

  return {
    alignment,
    score,
    bullishTimeframes: bullishIntervals,
    bearishTimeframes: bearishIntervals,
    neutralTimeframes: neutralIntervals,
    description,
  };
}

/** 验证突破有效性（过滤假突破） */
function validateBreakout(
  analyses: TimeframeAnalysis[],
  primaryInterval: KlineInterval,
): BreakoutValidation {
  const primary = analyses.find((a) => a.interval === primaryInterval);
  const higher = analyses.find((a) => {
    const order = ['15m', '1h', '4h', '1d'];
    return order.indexOf(a.interval) > order.indexOf(primaryInterval);
  });

  const warnings: string[] = [];
  const confirmations: string[] = [];

  if (!primary) {
    return { isValid: false, confidence: 0, warnings: ['主周期数据不足'], confirmations: [], higherTimeframeTrend: 'SIDEWAYS' };
  }

  const htTrend = higher?.trendDirection ?? 'SIDEWAYS';

  // 1. 大周期趋势确认
  if (htTrend === primary.trendDirection) {
    confirmations.push(`${higher?.interval ?? '大周期'} 趋势一致，突破有趋势支撑`);
  } else if (htTrend !== 'SIDEWAYS') {
    warnings.push(`${higher?.interval ?? '大周期'} 趋势相反，可能是逆势突破`);
  } else {
    warnings.push('大周期处于震荡，突破持续性存疑');
  }

  // 2. ADX 确认
  if (primary.structure.adx >= 25) {
    confirmations.push(`ADX=${primary.structure.adx.toFixed(1)} 趋势力量充足`);
  } else if (primary.structure.adx < 20) {
    warnings.push(`ADX=${primary.structure.adx.toFixed(1)} 趋势力量弱，可能假突破`);
  }

  // 3. 成交量确认（需要外部传入 volume 数据，这里用价格动量近似）
  if (primary.trendStrength >= 60) {
    confirmations.push('趋势强度较高');
  } else {
    warnings.push('趋势强度偏低');
  }

  // 4. EMA 排列
  if (primary.emaAlignment) {
    confirmations.push('EMA 多头排列/空头排列成立');
  } else {
    warnings.push('EMA 排列尚未形成，趋势可能不稳固');
  }

  // 置信度计算
  const confBase = 50;
  const confDelta = confirmations.length * 15 - warnings.length * 15;
  const confidence = Math.max(0, Math.min(100, confBase + confDelta));

  return {
    isValid: warnings.length <= 1 && confidence >= 50,
    confidence,
    warnings,
    confirmations,
    higherTimeframeTrend: htTrend,
  };
}

/** 生成交易机会 */
function generateMtfOpportunities(
  analyses: TimeframeAnalysis[],
  symbol: string,
  consensus: MtfConsensus,
  livePrice?: number, // 外部实时价覆盖
): MtfTradeOpportunity[] {
  const ops: MtfTradeOpportunity[] = [];

  // 寻找最小周期作为入场参考
  const primary = analyses.reduce((min, a) => {
    const order = ['1d', '4h', '1h', '30m', '15m'];
    return order.indexOf(a.interval) > order.indexOf(min.interval) ? a : min;
  }, analyses[0]);

  if (!primary) return ops;

  const { interval, price: candlePrice, structure } = primary;
  // 使用实时价（若提供）覆盖 K线收盘价
  const price = livePrice ?? candlePrice;
  const atrApprox = price * 0.02;

  const breakout = validateBreakout(analyses, interval);

  // LONG 机会
  if (consensus.alignment === 'STRONG_BULLISH' || consensus.alignment === 'BULLISH') {
    const sl = price - atrApprox * 1.5;
    const tp1 = price + atrApprox * 2;
    const tp2 = price + atrApprox * 4;
    const rr = (tp1 - price) / (price - sl);

    ops.push({
      symbol,
      primaryInterval: interval,
      direction: 'LONG',
      confidence: breakout.confidence,
      consensus,
      entryZone: { low: price - atrApprox * 0.3, high: price + atrApprox * 0.2 },
      stopLoss: Math.round(sl * 100) / 100,
      takeProfit: [Math.round(tp1 * 100) / 100, Math.round(tp2 * 100) / 100],
      riskReward: Math.round(rr * 10) / 10,
      reason: `${consensus.description}。${breakout.confirmations.slice(0, 2).join('；')}`,
      breakoutValidation: breakout,
      timeframeAnalyses: analyses,
    });
  }

  // SHORT 机会
  if (consensus.alignment === 'STRONG_BEARISH' || consensus.alignment === 'BEARISH') {
    const sl = price + atrApprox * 1.5;
    const tp1 = price - atrApprox * 2;
    const tp2 = price - atrApprox * 4;
    const rr = (price - tp1) / (sl - price);

    ops.push({
      symbol,
      primaryInterval: interval,
      direction: 'SHORT',
      confidence: breakout.confidence,
      consensus,
      entryZone: { low: price - atrApprox * 0.2, high: price + atrApprox * 0.3 },
      stopLoss: Math.round(sl * 100) / 100,
      takeProfit: [Math.round(tp1 * 100) / 100, Math.round(tp2 * 100) / 100],
      riskReward: Math.round(rr * 10) / 10,
      reason: `${consensus.description}。${breakout.confirmations.slice(0, 2).join('；')}`,
      breakoutValidation: breakout,
      timeframeAnalyses: analyses,
    });
  }

  return ops;
}

// ==================== 公共 API ====================

/** 执行多时间框架分析（需要传入各周期K线数据） */
export function analyzeMultiTimeframe(
  dataMap: Map<KlineInterval, KlineData[]>,
  symbol: string,
  livePrice?: number, // 外部实时价覆盖（summary + 交易机会用）
): MtfAnalysisResult {
  const analyses: TimeframeAnalysis[] = [];

  for (const interval of MTF_INTERVALS) {
    const klines = dataMap.get(interval);
    if (!klines || klines.length < 50) continue;
    const analysis = analyzeTimeframe(klines, interval);
    if (analysis) analyses.push(analysis);
  }

  if (analyses.length === 0) {
    return {
      symbol,
      timestamp: Date.now(),
      consensus: {
        alignment: 'NEUTRAL',
        score: 0,
        bullishTimeframes: [],
        bearishTimeframes: [],
        neutralTimeframes: [],
        description: '数据不足，无法进行分析',
      },
      opportunities: [],
      timeframeAnalyses: [],
      breakoutValidation: { isValid: false, confidence: 0, warnings: ['数据不足'], confirmations: [], higherTimeframeTrend: 'SIDEWAYS' },
      summary: '各周期数据不足，请检查数据获取',
    };
  }

  const consensus = computeConsensus(analyses);
  const opportunities = generateMtfOpportunities(analyses, symbol, consensus, livePrice);
  const breakoutValidation = validateBreakout(analyses, '1h');

  // 摘要 — 使用实时价（若提供）
  const displayPrice = livePrice ?? (analyses[0]?.price ?? 0);
  const summary = `${symbol} 现价 ${displayPrice.toFixed(2)}${livePrice ? ' (实时)' : ''}。${consensus.description}。` +
    `${breakoutValidation.isValid ? '✅ 突破有效' : '⚠️ 突破存疑'} (置信度 ${breakoutValidation.confidence}%)。` +
    `${opportunities.length > 0 ? `发现 ${opportunities.length} 个交易机会。` : '暂无明确交易机会。'}`;

  return {
    symbol,
    timestamp: Date.now(),
    consensus,
    opportunities,
    timeframeAnalyses: analyses,
    breakoutValidation,
    summary,
  };
}

/** 简化版 MTF 分析 —— 只返回一致性评分和方向 */
export function quickMtfScore(
  dataMap: Map<KlineInterval, KlineData[]>,
): { score: number; alignment: MtfConsensus['alignment']; description: string } {
  const result = analyzeMultiTimeframe(dataMap, '');
  return {
    score: result.consensus.score,
    alignment: result.consensus.alignment,
    description: result.consensus.description,
  };
}
