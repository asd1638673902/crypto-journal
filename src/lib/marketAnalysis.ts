/**
 * 智能市场分析引擎
 * 关键水平 · 市场结构 · 买卖信号 · 多时间框架机会
 */

import type { KlineData } from './exchange';
import type { KlineInterval } from './exchange';
import {
  closes, highs, lows,
  SMA, EMA, RSI, MACD, BollingerBands, ATR, ADX,
} from './strategyIndicators';

// ==================== 类型定义 ====================

/** 关键水平类型 */
export interface KeyLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number;      // 1-5 强度评分
  source: string;        // 来源描述（如 "近期低点"、"布林带下轨"）
  hits: number;          // 触碰次数
}

/** 市场结构 */
export interface MarketStructure {
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  strength: number;        // 0-100 趋势强度
  adx: number;
  phase: string;           // 市场阶段描述
  volatility: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
}

/** 买卖信号 */
export interface TradeSignal {
  action: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  score: number;           // -100 ~ +100
  reasons: string[];       // 信号理由
  indicators: {
    rsi: number;
    macd: 'bullish' | 'bearish' | 'neutral';
    bb: 'lower' | 'upper' | 'middle' | 'none';
    sma: 'golden_cross' | 'death_cross' | 'above' | 'below' | 'neutral';
  };
}

/** 交易机会 */
export interface TradeOpportunity {
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  confidence: number;       // 0-100
  entryZone: { low: number; high: number };
  stopLoss: number;
  takeProfit: number[];
  reason: string;
  riskReward: number;
}

/** 完整分析结果 */
export interface MarketAnalysisResult {
  symbol: string;
  interval: KlineInterval;
  currentPrice: number;
  timestamp: number;
  keyLevels: KeyLevel[];
  structure: MarketStructure;
  signal: TradeSignal;
  opportunities: TradeOpportunity[];
  summary: string;
}

// ==================== 辅助函数 ====================

/** 寻找近期极值点 */
function findExtremes(prices: number[], lookback: number): { highs: number[]; lows: number[] } {
  const pivots: number[] = [];
  const valleys: number[] = [];

  for (let i = 2; i < prices.length - 2; i++) {
    // 局部高点：中间价格高于左右各2根
    if (prices[i] > prices[i - 1] && prices[i] > prices[i - 2] &&
        prices[i] > prices[i + 1] && prices[i] > prices[i + 2]) {
      pivots.push(prices[i]);
    }
    // 局部低点：中间价格低于左右各2根
    if (prices[i] < prices[i - 1] && prices[i] < prices[i - 2] &&
        prices[i] < prices[i + 1] && prices[i] < prices[i + 2]) {
      valleys.push(prices[i]);
    }
  }

  // 只返回最近的 lookback 个
  return {
    highs: pivots.slice(-lookback),
    lows: valleys.slice(-lookback),
  };
}

/** 获取最近的触碰次数 */
function countHits(prices: number[], level: number, tolerance: number): number {
  let count = 0;
  for (const p of prices) {
    if (Math.abs(p - level) / level < tolerance) count++;
  }
  return count;
}

// ==================== 核心分析函数 ====================

/** 查找关键支撑/阻力位 */
export function findKeyLevels(klines: KlineData[]): KeyLevel[] {
  const prices = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const n = prices.length;
  if (n < 30) return [];

  const levels: KeyLevel[] = [];
  const tolerance = 0.005; // 0.5% 容差

  // 1. 局部极值点
  const { highs: pivotHighs, lows: pivotLows } = findExtremes(prices, 5);
  const seen = new Set<number>();

  for (const ph of pivotHighs) {
    const rounded = Math.round(ph);
    if (seen.has(rounded)) continue;
    seen.add(rounded);
    levels.push({
      price: ph,
      type: 'resistance',
      strength: Math.min(5, 2 + countHits(h, ph, tolerance)),
      source: '局部高点',
      hits: countHits(h, ph, tolerance),
    });
  }

  for (const pl of pivotLows) {
    const rounded = Math.round(pl);
    if (seen.has(rounded)) continue;
    seen.add(rounded);
    levels.push({
      price: pl,
      type: 'support',
      strength: Math.min(5, 2 + countHits(l, pl, tolerance)),
      source: '局部低点',
      hits: countHits(l, pl, tolerance),
    });
  }

  // 2. 布林带上下轨
  const bb = BollingerBands(prices, 20, 2);
  if (bb.upper[n - 1] !== undefined) {
    levels.push({
      price: bb.upper[n - 1]!,
      type: 'resistance',
      strength: 3,
      source: '布林带上轨(20,2)',
      hits: countHits(h, bb.upper[n - 1]!, tolerance),
    });
  }
  if (bb.lower[n - 1] !== undefined) {
    levels.push({
      price: bb.lower[n - 1]!,
      type: 'support',
      strength: 3,
      source: '布林带下轨(20,2)',
      hits: countHits(l, bb.lower[n - 1]!, tolerance),
    });
  }

  // 3. 均线支撑/阻力
  const sma50 = SMA(prices, 50);
  const sma200 = SMA(prices, 200);
  if (sma50[n - 1] !== undefined) {
    levels.push({
      price: sma50[n - 1]!,
      type: prices[n - 1] > sma50[n - 1]! ? 'support' : 'resistance',
      strength: 4,
      source: 'SMA(50)',
      hits: countHits(prices, sma50[n - 1]!, tolerance),
    });
  }
  if (sma200[n - 1] !== undefined) {
    levels.push({
      price: sma200[n - 1]!,
      type: prices[n - 1] > sma200[n - 1]! ? 'support' : 'resistance',
      strength: 5,
      source: 'SMA(200)',
      hits: countHits(prices, sma200[n - 1]!, tolerance),
    });
  }

  // 去重+排序
  const unique = new Map<number, KeyLevel>();
  for (const l of levels) {
    const rounded = Math.round(l.price);
    if (!unique.has(rounded) || l.strength > unique.get(rounded)!.strength) {
      unique.set(rounded, l);
    }
  }

  return [...unique.values()]
    .sort((a, b) => a.type === b.type
      ? (a.type === 'support' ? b.price - a.price : a.price - b.price)
      : (a.type === 'support' ? -1 : 1)
    )
    .slice(0, 12); // 最多12个
}

/** 分析市场结构 */
export function analyzeMarketStructure(klines: KlineData[]): MarketStructure {
  const prices = closes(klines);
  const n = prices.length;
  if (n < 50) {
    return {
      trend: 'SIDEWAYS',
      strength: 0,
      adx: 0,
      phase: `数据不足 — 当前 ${n} 根 K 线，至少需要 50 根才能计算 ADX 等指标`,
      volatility: 'LOW',
      description: `K 线数据不足（${n}/50），请增加回测天数或选择更小周期`,
    };
  }

  const adxVals = ADX(klines, 14);
  const adxVal = adxVals.adx[n - 1];
  // ADX 可能为 undefined（数据刚好够数组对齐但最后一根未计算完）
  const adx = adxVal ?? (adxVals.adx[n - 2] ?? 0);
  const sma20 = SMA(prices, 20);
  const sma50 = SMA(prices, 50);

  const price = prices[n - 1];
  const price20ago = prices[Math.max(0, n - 20)];
  const changePct = price20ago > 0 ? ((price - price20ago) / price20ago) * 100 : 0;

  // 趋势方向
  let trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  if (sma20[n - 1] !== undefined && sma50[n - 1] !== undefined) {
    if (sma20[n - 1]! > sma50[n - 1]! && price > sma20[n - 1]!) trend = 'BULLISH';
    else if (sma20[n - 1]! < sma50[n - 1]! && price < sma20[n - 1]!) trend = 'BEARISH';
    else trend = 'SIDEWAYS';
  } else {
    trend = changePct > 2 ? 'BULLISH' : changePct < -2 ? 'BEARISH' : 'SIDEWAYS';
  }

  // 趋势强度
  const strength = Math.min(100, Math.round(adx * 4)); // ADX 0-25 → 0-100

  // 波动率
  const atr = ATR(klines, 14);
  const atrVal = atr[n - 1] ?? 0;
  const volatility = atrVal / price > 0.02 ? 'HIGH' : atrVal / price > 0.01 ? 'MEDIUM' : 'LOW';

  // 市场阶段
  let phase: string;
  if (adx < 20) {
    phase = '震荡盘整 — ADX < 20，无明显趋势';
  } else if (adx < 25) {
    phase = '趋势酝酿 — ADX 在 20-25 之间';
  } else {
    if (trend === 'BULLISH') {
      phase = changePct > 15 ? '强势上涨 — 多头趋势明确' : '温和上涨 — 多头趋势形成';
    } else if (trend === 'BEARISH') {
      phase = changePct < -15 ? '强势下跌 — 空头趋势明确' : '温和下跌 — 空头趋势形成';
    } else {
      phase = trend === 'BULLISH' ? '潜在上涨 — 均线多头但趋势尚弱' : '潜在下跌 — 均线空头但趋势尚弱';
    }
  }

  let description: string;
  if (adx >= 25 && trend === 'BULLISH') {
    description = `✅ 强势多头趋势 (ADX=${adx.toFixed(1)})，建议顺势做多`;
  } else if (adx >= 25 && trend === 'BEARISH') {
    description = `🔻 强势空头趋势 (ADX=${adx.toFixed(1)})，建议顺势做空`;
  } else if (adx >= 20) {
    description = `⚠️ 趋势开始形成 (ADX=${adx.toFixed(1)})，等待确认`;
  } else {
    description = `🔄 震荡市场 (ADX=${adx.toFixed(1)})，建议区间操作或观望`;
  }

  return { trend, strength, adx, phase, volatility, description };
}

/** 生成综合买卖信号 */
export function generateTradeSignal(klines: KlineData[]): TradeSignal {
  const prices = closes(klines);
  const n = prices.length;
  if (n < 50) {
    return { action: 'NEUTRAL', score: 0, reasons: [`数据不足（${n}/50）`], indicators: { rsi: 50, macd: 'neutral', bb: 'none', sma: 'neutral' } };
  }

  const reasons: string[] = [];
  let score = 0; // -100 ~ +100

  // 1. RSI
  const rsiVal = RSI(prices, 14)[n - 1] ?? 50;
  if (rsiVal < 30) { score += 30; reasons.push(`RSI(${rsiVal.toFixed(1)}) 超卖区 — 买入信号`); }
  else if (rsiVal < 40) { score += 15; reasons.push(`RSI(${rsiVal.toFixed(1)}) 接近超卖`); }
  else if (rsiVal > 70) { score -= 30; reasons.push(`RSI(${rsiVal.toFixed(1)}) 超买区 — 卖出信号`); }
  else if (rsiVal > 60) { score -= 15; reasons.push(`RSI(${rsiVal.toFixed(1)}) 接近超买`); }
  else { reasons.push(`RSI(${rsiVal.toFixed(1)}) 中性`); }

  // 2. MACD
  const macd = MACD(prices, 12, 26, 9);
  const hist = macd.histogram[n - 1] ?? 0;
  const prevHist = macd.histogram[n - 2] ?? 0;
  let macdSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';

  if (hist > 0 && prevHist <= 0) { score += 25; macdSignal = 'bullish'; reasons.push('MACD 柱翻正 — 金叉信号'); }
  else if (hist < 0 && prevHist >= 0) { score -= 25; macdSignal = 'bearish'; reasons.push('MACD 柱翻负 — 死叉信号'); }
  else if (hist > 0) { score += 10; macdSignal = 'bullish'; reasons.push('MACD 柱为正 — 多头排列'); }
  else if (hist < 0) { score -= 10; macdSignal = 'bearish'; reasons.push('MACD 柱为负 — 空头排列'); }

  // 3. 布林带
  const bb = BollingerBands(prices, 20, 2);
  const currPrice = prices[n - 1];
  let bbSignal: 'lower' | 'upper' | 'middle' | 'none' = 'none';
  if (bb.lower[n - 1] !== undefined && currPrice <= bb.lower[n - 1]!) {
    score += 20; bbSignal = 'lower';
    reasons.push('价格触及布林带下轨 — 超卖反弹信号');
  } else if (bb.upper[n - 1] !== undefined && currPrice >= bb.upper[n - 1]!) {
    score -= 20; bbSignal = 'upper';
    reasons.push('价格触及布林带上轨 — 超买回调信号');
  } else if (bb.middle[n - 1] !== undefined) {
    bbSignal = 'middle';
  }

  // 4. SMA 交叉
  const smaFast = SMA(prices, 10);
  const smaSlow = SMA(prices, 30);
  let smaSignal: 'golden_cross' | 'death_cross' | 'above' | 'below' | 'neutral' = 'neutral';

  if (smaFast[n - 1] !== undefined && smaSlow[n - 1] !== undefined &&
      smaFast[n - 2] !== undefined && smaSlow[n - 2] !== undefined) {
    if (smaFast[n - 2]! <= smaSlow[n - 2]! && smaFast[n - 1]! > smaSlow[n - 1]!) {
      score += 25; smaSignal = 'golden_cross';
      reasons.push('SMA 金叉 (10/30) — 看多信号');
    } else if (smaFast[n - 2]! >= smaSlow[n - 2]! && smaFast[n - 1]! < smaSlow[n - 1]!) {
      score -= 25; smaSignal = 'death_cross';
      reasons.push('SMA 死叉 (10/30) — 看空信号');
    } else if (smaFast[n - 1]! > smaSlow[n - 1]!) {
      score += 5; smaSignal = 'above';
    } else {
      score -= 5; smaSignal = 'below';
    }
  }

  // 确定最终行动
  score = Math.max(-100, Math.min(100, score));
  let action: TradeSignal['action'];
  if (score >= 50) action = 'STRONG_BUY';
  else if (score >= 20) action = 'BUY';
  else if (score <= -50) action = 'STRONG_SELL';
  else if (score <= -20) action = 'SELL';
  else action = 'NEUTRAL';

  return {
    action,
    score,
    reasons: reasons.length > 0 ? reasons : ['无明显信号'],
    indicators: {
      rsi: rsiVal,
      macd: macdSignal,
      bb: bbSignal,
      sma: smaSignal,
    },
  };
}

/** 生成交易机会（多时间框架） */
export function generateOpportunities(
  klines: KlineData[],
  symbol: string,
  interval: KlineInterval,
): TradeOpportunity[] {
  const prices = closes(klines);
  const n = prices.length;
  if (n < 30) return [];

  const opportunities: TradeOpportunity[] = [];
  const currPrice = prices[n - 1];
  const atr = ATR(klines, 14);
  const atrVal = atr[n - 1] ?? 0;
  const signal = generateTradeSignal(klines);
  const structure = analyzeMarketStructure(klines);

  // 根据时间周期确定风险系数
  const riskMultiplier: Record<string, number> = {
    '15m': 0.5, '30m': 0.5, '1h': 1, '2h': 1.5, '4h': 2, '1d': 3,
  };
  const mult = riskMultiplier[interval] ?? 1;

  const stopDist = atrVal * mult;

  if (signal.action === 'STRONG_BUY' || signal.action === 'BUY') {
    const entryLow = currPrice - atrVal * 0.3;
    const entryHigh = currPrice + atrVal * 0.3;
    const sl = currPrice - stopDist;
    const tp1 = currPrice + stopDist * 1.5;
    const tp2 = currPrice + stopDist * 3;
    const rr = (tp1 - currPrice) / (currPrice - sl);

    opportunities.push({
      timeframe: interval,
      direction: 'LONG',
      confidence: signal.action === 'STRONG_BUY' ? 80 : 60,
      entryZone: { low: Math.round(entryLow * 100) / 100, high: Math.round(entryHigh * 100) / 100 },
      stopLoss: Math.round(sl * 100) / 100,
      takeProfit: [Math.round(tp1 * 100) / 100, Math.round(tp2 * 100) / 100],
      reason: `趋势${structure.trend === 'BULLISH' ? '向上' : '不明'}，${signal.reasons.slice(0, 2).join('；')}`,
      riskReward: Math.round(rr * 10) / 10,
    });
  }

  if (signal.action === 'STRONG_SELL' || signal.action === 'SELL') {
    const entryLow = currPrice - atrVal * 0.3;
    const entryHigh = currPrice + atrVal * 0.3;
    const sl = currPrice + stopDist;
    const tp1 = currPrice - stopDist * 1.5;
    const tp2 = currPrice - stopDist * 3;
    const rr = (currPrice - tp1) / (sl - currPrice);

    opportunities.push({
      timeframe: interval,
      direction: 'SHORT',
      confidence: signal.action === 'STRONG_SELL' ? 80 : 60,
      entryZone: { low: Math.round(entryLow * 100) / 100, high: Math.round(entryHigh * 100) / 100 },
      stopLoss: Math.round(sl * 100) / 100,
      takeProfit: [Math.round(tp1 * 100) / 100, Math.round(tp2 * 100) / 100],
      reason: `趋势${structure.trend === 'BEARISH' ? '向下' : '不明'}，${signal.reasons.slice(0, 2).join('；')}`,
      riskReward: Math.round(rr * 10) / 10,
    });
  }

  return opportunities;
}

/** 生成分析摘要 */
function generateSummary(
  price: number,
  signal: TradeSignal,
  structure: MarketStructure,
  levels: KeyLevel[],
): string {
  const nearestSupport = levels.filter(l => l.type === 'support' && l.price < price)
    .sort((a, b) => b.price - a.price)[0];
  const nearestResistance = levels.filter(l => l.type === 'resistance' && l.price > price)
    .sort((a, b) => a.price - b.price)[0];

  let summary = `现价 ${price.toFixed(2)} USDT。`;
  summary += `${structure.description} `;

  if (signal.action === 'STRONG_BUY' || signal.action === 'BUY') {
    summary += `综合信号偏多 (${signal.score}/100)。`;
  } else if (signal.action === 'STRONG_SELL' || signal.action === 'SELL') {
    summary += `综合信号偏空 (${signal.score}/100)。`;
  } else {
    summary += `综合信号中性。`;
  }

  if (nearestSupport) summary += ` 最近支撑: ${nearestSupport.price.toFixed(2)}`;
  if (nearestResistance) summary += `，最近阻力: ${nearestResistance.price.toFixed(2)}。`;

  summary += ` 波动率: ${structure.volatility === 'HIGH' ? '高' : structure.volatility === 'MEDIUM' ? '中' : '低'}。`;

  return summary;
}

/** 执行完整市场分析 */
export function analyzeMarket(
  klines: KlineData[],
  symbol: string,
  interval: KlineInterval,
): MarketAnalysisResult {
  const prices = closes(klines);
  const currentPrice = prices[prices.length - 1];

  const keyLevels = findKeyLevels(klines);
  const structure = analyzeMarketStructure(klines);
  const signal = generateTradeSignal(klines);
  const opportunities = generateOpportunities(klines, symbol, interval);

  return {
    symbol,
    interval,
    currentPrice,
    timestamp: Date.now(),
    keyLevels,
    structure,
    signal,
    opportunities,
    summary: generateSummary(currentPrice, signal, structure, keyLevels),
  };
}

// ==================== 多品种推荐 ====================

/** 单个品种的推荐评分 */
export interface SymbolRecommendation {
  symbol: string;
  price: number;
  signal: TradeSignal;
  structure: MarketStructure;
  score: number;           // -100 ~ +100（同 signal.score）
  label: string;           // 信号标签
}

/** 按信号强度排序推荐 */
export function rankRecommendations(analyses: Map<string, MarketAnalysisResult>): {
  topBuys: SymbolRecommendation[];
  topSells: SymbolRecommendation[];
} {
  const all: SymbolRecommendation[] = [];

  for (const [symbol, result] of analyses) {
    if (result.structure.phase.includes('数据不足')) continue;
    all.push({
      symbol,
      price: result.currentPrice,
      signal: result.signal,
      structure: result.structure,
      score: result.signal.score,
      label: result.signal.action,
    });
  }

  const sorted = [...all].sort((a, b) => b.score - a.score);

  return {
    topBuys: sorted.filter((r) => r.score > 0).slice(0, 5),
    topSells: sorted.filter((r) => r.score < 0).reverse().slice(0, 5),
  };
}
