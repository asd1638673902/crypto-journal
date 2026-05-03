// 交易计算工具函数
// 所有价格单位：USDT，所有百分比单位：%

/** 根据方向计算盈亏 */
export function calcPnl(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  exitPrice: number,
  quantity: number,
): number {
  if (direction === 'LONG') return (exitPrice - entryPrice) * quantity;
  return (entryPrice - exitPrice) * quantity;
}

/** 计算盈亏百分比（基于保证金）*/
export function calcPnlPercent(
  pnl: number,
  entryPrice: number,
  quantity: number,
  leverage: number,
): number {
  const margin = (entryPrice * quantity) / leverage;
  if (margin === 0) return 0;
  return (pnl / margin) * 100;
}

/** 格式化价格显示 */
export function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

/** 盈亏颜色（中国惯例：涨红跌绿）*/
export function getPnlColor(pnl: number): string {
  if (pnl > 0) return '#ef4444';
  if (pnl < 0) return '#22c55e';
  return '#888';
}

/** 执行分颜色 */
export function getScoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

/** 检测是否为"侥幸交易" */
export function detectLuckyTrade(params: {
  pnl: number | undefined;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number | undefined;
  maePercent: number | undefined;
}): { isLucky: boolean; reason: string } {
  const { pnl, direction, entryPrice, stopLoss, maePercent } = params;
  if (!pnl || pnl <= 0 || !maePercent) {
    return { isLucky: false, reason: '' };
  }
  let stopPercent: number;
  if (stopLoss) {
    stopPercent = direction === 'LONG'
      ? ((entryPrice - stopLoss) / entryPrice) * 100
      : ((stopLoss - entryPrice) / entryPrice) * 100;
  } else {
    stopPercent = 5;
  }
  if (maePercent > stopPercent * 2) {
    return {
      isLucky: true,
      reason: `MAE 达 ${maePercent.toFixed(2)}%，远超合理止损幅度（${stopPercent.toFixed(2)}%），盈利纯属运气`,
    };
  }
  return { isLucky: false, reason: '' };
}

/**
 * 计算执行分（0-100）
 * review 支持 TradeReview 对象或 null/undefined
 */
export function calcExecutionScore(params: {
  trade: { stopLoss?: number; leverage: number; isLuckyTrade: boolean };
  review?: { entryScore?: number; exitScore?: number; positionScore?: number; emotionScore?: number } | null;
}): number {
  const { trade, review } = params;
  let score = 0;

  // 入场质量（30分）
  const entryScore = review?.entryScore ?? (trade.stopLoss ? 4 : 2);
  score += (entryScore / 5) * 30;

  // 止损纪律（25分）
  const slBonus = trade.stopLoss ? 20 : 0;
  const exitBonus = review?.exitScore ? (review.exitScore / 5) * 5 : 0;
  score += slBonus + exitBonus;

  // 仓位管理（20分）
  const posScore = review?.positionScore ?? (trade.leverage <= 5 ? 4 : trade.leverage <= 10 ? 3 : 2);
  score += (posScore / 5) * 20;

  // 非侥幸加分（15分）
  if (!trade.isLuckyTrade) score += 15;

  // 情绪控制（10分）
  const emoScore = review?.emotionScore ?? 3;
  score += (emoScore / 5) * 10;

  return Math.min(100, Math.max(0, Math.round(score)));
}
