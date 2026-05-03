/**
 * AI 复盘分析引擎
 * 读取交易 + 复盘数据 → 生成模式分析、错误总结、改进建议
 */

import type { Trade, TradeReview } from './types';

// ==================== 错误/情绪标签 ====================

export const ERROR_LABELS: Record<string, string> = {
  entry_logic: '开仓逻辑错误',
  stop_loss: '止损设置不合理',
  over_position: '仓位过大',
  emotional: '情绪化交易',
  premature_exit: '过早止盈',
  no_stop: '扛单不止损',
  fomo: 'FOMO 追涨杀跌',
  revenge: '报复性交易',
};

export const EMOTION_LABELS: Record<string, string> = {
  calm: '冷静', confident: '自信', fear: '恐惧',
  greed: '贪婪', fomo: '害怕错过', anxious: '焦虑',
  frustrated: '沮丧', hesitant: '犹豫',
};

// ==================== 分析结果类型 ====================

export interface MonthlyReport {
  yearMonth: string;
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgScore: number;
  luckyCount: number;
  bestTrade: { symbol: string; pnl: number } | null;
  worstTrade: { symbol: string; pnl: number } | null;
}

export interface ErrorPattern {
  errorKey: string;
  label: string;
  count: number;
  percentage: number;
}

export interface EmotionPattern {
  emotionKey: string;
  label: string;
  count: number;
  avgScore: number;
}

export interface SymbolPerformance {
  symbol: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  avgScore: number;
}

export interface ScoreTrend {
  period: string;
  avgScore: number;
}

export interface AiReviewResult {
  monthlyReports: MonthlyReport[];
  currentMonth: MonthlyReport | null;
  topErrors: ErrorPattern[];
  emotionPatterns: EmotionPattern[];
  symbolPerformance: SymbolPerformance[];
  scoreTrend: ScoreTrend[];
  improvementTips: string[];
  monthOverMonth: { pnlChange: number; winRateChange: number; scoreChange: number } | null;
  summary: string;
}

// ==================== 分析函数 ====================

/** 获取指定月份的复盘数据 */
function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${y}年${parseInt(m)}月`;
}

/** 计算执行分 */
function calcScore(trade: Trade, review: TradeReview | null): number {
  if (!review) return 0;
  let score = 0;
  score += ((review.entryScore ?? 3) / 5) * 30;
  score += trade.stopLoss ? 20 : 0;
  score += ((review.exitScore ?? 3) / 5) * 5;
  score += ((review.positionScore ?? 3) / 5) * 20;
  if (!trade.isLuckyTrade) score += 15;
  score += ((review.emotionScore ?? 3) / 5) * 10;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** 运行完整分析 */
export function analyzeTrades(trades: Trade[], reviews: TradeReview[]): AiReviewResult {
  const closed = trades.filter(t => t.status === 'CLOSED' && t.pnl !== undefined);
  const reviewMap = new Map(reviews.map(r => [r.tradeId, r]));

  // ---- 月度报告 ----
  const months = new Map<string, Trade[]>();
  for (const t of closed) {
    const key = getMonthKey(t.exitTime || t.entryTime);
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(t);
  }

  const monthlyReports: MonthlyReport[] = [];
  for (const [key, monthTrades] of months) {
    const wins = monthTrades.filter(t => (t.pnl || 0) > 0);
    const losses = monthTrades.filter(t => (t.pnl || 0) < 0);
    const totalPnl = monthTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const scores = monthTrades.map(t => calcScore(t, reviewMap.get(t.id) ?? null)).filter(s => s > 0);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    const sortedByPnl = [...monthTrades].sort((a, b) => (b.pnl || 0) - (a.pnl || 0));

    monthlyReports.push({
      yearMonth: key,
      label: getMonthLabel(key),
      totalTrades: monthTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: monthTrades.length > 0 ? Math.round((wins.length / monthTrades.length) * 100) : 0,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgScore,
      luckyCount: monthTrades.filter(t => t.isLuckyTrade).length,
      bestTrade: sortedByPnl[0] ? { symbol: sortedByPnl[0].symbol, pnl: Math.round(sortedByPnl[0].pnl! * 100) / 100 } : null,
      worstTrade: sortedByPnl[sortedByPnl.length - 1]?.pnl! < 0
        ? { symbol: sortedByPnl[sortedByPnl.length - 1].symbol, pnl: Math.round(sortedByPnl[sortedByPnl.length - 1].pnl! * 100) / 100 }
        : null,
    });
  }

  monthlyReports.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const currentMonth = monthlyReports.length > 0 ? monthlyReports[monthlyReports.length - 1] : null;

  // ---- 月度环比 ----
  let monthOverMonth: AiReviewResult['monthOverMonth'] = null;
  if (monthlyReports.length >= 2) {
    const last = monthlyReports[monthlyReports.length - 1];
    const prev = monthlyReports[monthlyReports.length - 2];
    monthOverMonth = {
      pnlChange: prev.totalPnl !== 0 ? Math.round(((last.totalPnl - prev.totalPnl) / Math.abs(prev.totalPnl)) * 100) : 0,
      winRateChange: last.winRate - prev.winRate,
      scoreChange: last.avgScore - prev.avgScore,
    };
  }

  // ---- 错误模式 ----
  const errorCount = new Map<string, number>();
  for (const r of reviews) {
    for (const err of r.errors || []) {
      errorCount.set(err, (errorCount.get(err) || 0) + 1);
    }
  }
  const totalErrors = [...errorCount.values()].reduce((a, b) => a + b, 0);
  const topErrors: ErrorPattern[] = [...errorCount.entries()]
    .map(([key, count]) => ({
      errorKey: key,
      label: ERROR_LABELS[key] || key,
      count,
      percentage: totalErrors > 0 ? Math.round((count / totalErrors) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // ---- 情绪模式 ----
  const emotionStats = new Map<string, { count: number; totalScore: number }>();
  for (const r of reviews) {
    for (const em of r.emotions || []) {
      if (!emotionStats.has(em)) emotionStats.set(em, { count: 0, totalScore: 0 });
      const s = emotionStats.get(em)!;
      s.count++;
      s.totalScore += r.emotionScore ?? 3;
    }
  }
  const emotionPatterns: EmotionPattern[] = [...emotionStats.entries()]
    .map(([key, data]) => ({
      emotionKey: key,
      label: EMOTION_LABELS[key] || key,
      count: data.count,
      avgScore: Math.round((data.totalScore / data.count) * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  // ---- 品种表现 ----
  const symMap = new Map<string, { trades: Trade[] }>();
  for (const t of closed) {
    const sym = t.symbol;
    if (!symMap.has(sym)) symMap.set(sym, { trades: [] });
    symMap.get(sym)!.trades.push(t);
  }
  const symbolPerformance: SymbolPerformance[] = [...symMap.entries()]
    .map(([symbol, data]) => {
      const wins = data.trades.filter(t => (t.pnl || 0) > 0);
      const totalPnl = data.trades.reduce((s, t) => s + (t.pnl || 0), 0);
      const scores = data.trades.map(t => calcScore(t, reviewMap.get(t.id) ?? null)).filter(s => s > 0);
      return {
        symbol: symbol.replace('USDT', ''),
        trades: data.trades.length,
        wins: wins.length,
        winRate: Math.round((wins.length / data.trades.length) * 100),
        totalPnl: Math.round(totalPnl * 100) / 100,
        avgScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      };
    })
    .sort((a, b) => b.trades - a.trades);

  // ---- 评分趋势 ----
  const scoreTrend: ScoreTrend[] = monthlyReports
    .filter(m => m.avgScore > 0)
    .map(m => ({ period: m.label, avgScore: m.avgScore }));

  // ---- 改进建议（基于数据生成） ----
  const improvementTips: string[] = [];

  if (topErrors.length > 0) {
    const topErr = topErrors[0];
    improvementTips.push(`**首要问题**：${topErr.label} 出现 ${topErr.count} 次（占${topErr.percentage}%），建议制定专项改进计划。`);
  }

  const fomoCount = errorCount.get('fomo') ?? 0;
  const revengeCount = errorCount.get('revenge') ?? 0;
  if (fomoCount > 0 || revengeCount > 0) {
    improvementTips.push(`**情绪管控**：FOMO（${fomoCount}次）+ 报复交易（${revengeCount}次），建议严格执行交易计划，设置冷静期规则。`);
  }

  const noStopCount = errorCount.get('no_stop') ?? 0;
  if (noStopCount > 0) {
    improvementTips.push(`**风控纪律**：扛单不止损出现 ${noStopCount} 次，每笔交易必须预设止损，建议使用 OCO 订单自动执行。`);
  }

  const emotionEntries = [...emotionStats.entries()].sort((a, b) => b[1].count - a[1].count);
  if (emotionEntries.length > 0) {
    const topEmotion = emotionEntries[0];
    improvementTips.push(`**情绪倾向**：最常见的情绪是「${EMOTION_LABELS[topEmotion[0]] || topEmotion[0]}」（${topEmotion[1].count}次），建议交易前进行情绪检查清单。`);
  }

  if (currentMonth && currentMonth.luckyCount > 0) {
    improvementTips.push(`**侥幸交易**：本月有 ${currentMonth.luckyCount} 笔侥幸盈利交易，这些交易的利润不可持续，需重点关注 MAE 控制。`);
  }

  if (improvementTips.length === 0) {
    improvementTips.push('暂无足够数据生成建议，请先完成交易复盘填写。');
  }

  // ---- 综合摘要 ----
  let summary = '';
  if (currentMonth) {
    const pnlStr = currentMonth.totalPnl >= 0 ? `盈利 $${currentMonth.totalPnl}` : `亏损 $${Math.abs(currentMonth.totalPnl)}`;
    summary = `${currentMonth.label}共交易 ${currentMonth.totalTrades} 笔，` +
      `胜率 ${currentMonth.winRate}%，${pnlStr}。` +
      `平均执行分 ${currentMonth.avgScore} 分。` +
      (currentMonth.luckyCount > 0 ? `含 ${currentMonth.luckyCount} 笔侥幸交易。` : '') +
      (topErrors.length > 0 ? `最常犯的错误：${topErrors.slice(0, 2).map(e => e.label).join('、')}。` : '') +
      (monthOverMonth
        ? `环比上月：盈亏${monthOverMonth.pnlChange >= 0 ? '↑' : '↓'}${Math.abs(monthOverMonth.pnlChange)}%，` +
          `胜率${monthOverMonth.winRateChange >= 0 ? '↑' : '↓'}${Math.abs(monthOverMonth.winRateChange)}个百分点。`
        : '');
  } else {
    summary = '暂无已平仓交易数据，请先同步或录入交易。';
  }

  return {
    monthlyReports,
    currentMonth,
    topErrors,
    emotionPatterns,
    symbolPerformance,
    scoreTrend,
    improvementTips,
    monthOverMonth,
    summary,
  };
}
