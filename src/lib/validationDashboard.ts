/**
 * 验证仪表盘 — 系统体检核心
 *
 * 5组对比，证明每个模块是否真的有用：
 * ① 策略对比（趋势 vs 突破）
 * ② 市场状态对比（趋势/震荡/爆发）
 * ③ 评分分层（高分 vs 低分）
 * ④ 过滤前后（有过滤 vs 无过滤）
 * ⑤ 时间段（亚洲/欧盘/美盘）
 */

import type { EngineBacktestResult, BacktestTrade } from './engineBacktest';

// ==================== 对比结果类型 ====================

export interface ComparisonRow {
  label: string;
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  netPnl: number;
}

export interface ValidationReport {
  // ① 策略对比
  strategyComparison: {
    title: string;
    rows: ComparisonRow[];
  };
  // ② 市场状态对比
  marketStateComparison: {
    title: string;
    rows: ComparisonRow[];
  };
  // ③ 评分分层
  scoreComparison: {
    title: string;
    rows: ComparisonRow[];
  };
  // ④ 过滤前后
  filterComparison: {
    title: string;
    rows: ComparisonRow[];
  };
  // ⑤ 时段对比
  timePeriodComparison: {
    title: string;
    rows: ComparisonRow[];
  };
  // 策略说明
  strategyDescription: string;
}

// ==================== 辅助函数 ====================

function calcStats(trades: BacktestTrade[]): ComparisonRow {
  const total = trades.length;
  if (total === 0) {
    return { label: '', totalTrades: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, expectancy: 0, netPnl: 0 };
  }

  const winning = trades.filter((t) => t.pnl > 0);
  const losing = trades.filter((t) => t.pnl <= 0);
  const wins = winning.length;
  const losses = losing.length;

  const winRate = (wins / total) * 100;
  const avgWin = wins > 0 ? winning.reduce((s, t) => s + t.pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? Math.abs(losing.reduce((s, t) => s + t.pnl, 0)) / losses : 0;
  const profitFactor = avgLoss > 0 ? (wins * avgWin) / (losses * avgLoss) : wins > 0 ? Infinity : 0;
  const lossRate = (total - wins) / total;
  const expectancy = (winRate / 100 * avgWin) - (lossRate * avgLoss);
  const netPnl = trades.reduce((s, t) => s + t.pnl, 0);

  return {
    label: '',
    totalTrades: total,
    winRate: Math.round(winRate * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    netPnl: Math.round(netPnl * 100) / 100,
  };
}

// ==================== 生成验证报告 ====================

export function generateValidationReport(backtestResults: EngineBacktestResult[]): ValidationReport {
  const allTrades = backtestResults.flatMap((r) => r.trades);

  // ① 策略对比 — 按信号评分区分（≥80=高确定性；<80=普通）
  const highSignalTrades = allTrades.filter((t) => t.signalScore >= 80);
  const lowSignalTrades = allTrades.filter((t) => t.signalScore < 80 && t.signalScore >= 60);
  const allComparison = calcStats(allTrades);

  const strategyComparison = {
    title: '① 策略对比 — 高确定性信号 vs 普通信号',
    rows: [
      { label: '高确定性（评分≥80）', ...calcStats(highSignalTrades) },
      { label: '普通信号（评分60~79）', ...calcStats(lowSignalTrades) },
      { label: '全部交易', ...allComparison },
    ],
  };

  // ② 市场状态对比
  const trending = allTrades.filter((t) => t.marketState === 'TRENDING');
  const consolidating = allTrades.filter((t) => t.marketState === 'CONSOLIDATING');
  const explosive = allTrades.filter((t) => t.marketState === 'EXPLOSIVE');

  const marketStateComparison = {
    title: '② 市场状态对比 — 不同市场下的表现',
    rows: [
      { label: '📈 趋势市场', ...calcStats(trending) },
      { label: '➡️ 震荡市场', ...calcStats(consolidating) },
      { label: '🔥 爆发行情', ...calcStats(explosive) },
    ],
  };

  // ③ 评分分层
  const score80plus = allTrades.filter((t) => t.qualityScore >= 80);
  const score70to80 = allTrades.filter((t) => t.qualityScore >= 70 && t.qualityScore < 80);
  const scoreUnder70 = allTrades.filter((t) => t.qualityScore < 70);

  const scoreComparison = {
    title: '③ 评分分层 — 高分交易 vs 低分交易',
    rows: [
      { label: '⭐ 高分（质量分≥80）', ...calcStats(score80plus) },
      { label: '中等（质量分70~79）', ...calcStats(score70to80) },
      { label: '低分（质量分<70）', ...calcStats(scoreUnder70) },
    ],
  };

  // ④ 过滤前后 — 对比有过滤的交易 vs 所有可能交易（用评分数据近似）
  const filteredTrades = allTrades.filter((t) => t.filterPassed);
  const unfiltered = allTrades; // 实际所有交易都已经过过滤

  // 收集被过滤拒绝的交易（从原始数据）
  const filterRejected: BacktestTrade[] = allTrades.filter((t) => t.rejectedByFilter);
  const qualityRejected: BacktestTrade[] = allTrades.filter((t) => t.rejectedByQuality);

  const filterComparison = {
    title: '④ 过滤前后 — 有过滤 vs 无过滤',
    rows: [
      { label: '✅ 通过过滤的交易', ...calcStats(filteredTrades) },
      { label: '⚠️ 被过滤拒绝', totalTrades: filterRejected.length + qualityRejected.length, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, expectancy: 0, netPnl: 0 },
      { label: '📊 过滤通过率', ...calcStats(filteredTrades) },
    ],
  };

  // ⑤ 时段对比
  const asia = allTrades.filter((t) => t.timePeriod === 'ASIA');
  const europe = allTrades.filter((t) => t.timePeriod === 'EUROPE');
  const us = allTrades.filter((t) => t.timePeriod === 'US');
  const other = allTrades.filter((t) => t.timePeriod === 'OTHER');

  const timePeriodComparison = {
    title: '⑤ 时段对比 — 不同时间段的表现',
    rows: [
      { label: '🌏 亚洲盘（8~14点）', ...calcStats(asia) },
      { label: '🌍 欧盘（14~20点）', ...calcStats(europe) },
      { label: '🌎 美盘（20~2点）', ...calcStats(us) },
      { label: '🌙 其他时段', ...calcStats(other) },
    ],
  };

  // 策略说明
  const strategyDescription = [
    '=== 开仓策略说明 ===',
    '',
    '【信号触发流程】每根K线收盘时执行：',
    '',
    '① 市场状态判断',
    '   → ADX + ATR + 成交量判断趋势/震荡/爆发',
    '   → 震荡且置信度<40% → 跳过',
    '',
    '② 市场过滤（三硬条件）',
    '   → 趋势强度：EMA(20)斜率 + 价格突破结构',
    '   → 波动率：ATR在均值50%~200%之间',
    '   → 时间窗口：美盘(21~24)或亚盘尾(14~16)',
    '   → 三项全过 → 继续；否则 → 跳过',
    '',
    '③ 信号评分（5维度100分）',
    '   → 趋势强度(25) + 成交量(20) + 波动率(20) + 结构位置(20) + 时间窗口(15)',
    '   → < 60分 → 禁止交易（跳过）',
    '   → 60~79分 → 正常仓位',
    '   → ≥ 80分 → 允许加仓',
    '',
    '④ 风控检查',
    '   → 连亏≥3停、日亏≥5%停、回撤≥15%降仓',
    '',
    '⑤ 交易质量评分（5维度100分）',
    '   → 回踩干净(20) + 结构清晰(20) + 止损合理(20) + RR比(20) + 时间(20)',
    '   → < 70分 → 放弃',
    '   → 70~84分 → 正常仓位',
    '   → ≥ 85分 → 加仓',
    '',
    '⑥ 仓位计算',
    '   → 基于模拟账户余额',
    '   → 稳健模式风险1%，激进模式风险2%',
    '   → 评分≥80可乘1.2倍修正',
    '',
    '【出场规则】',
    '→ 止损：入场价 - 1.5×ATR（约3%）',
    '→ 止盈1：入场价 + 2×ATR（50%仓位）',
    '→ 超时：持仓超过20根K线自动平仓',
  ].join('\n');

  return {
    strategyComparison,
    marketStateComparison,
    scoreComparison,
    filterComparison,
    timePeriodComparison,
    strategyDescription,
  };
}
