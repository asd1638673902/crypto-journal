/**
 * Edge 验证系统 — 策略有效性验证
 * 
 * 每天输出每个策略的存活证据：
 * 胜率 · 盈亏比 · 期望值
 * 
 * 期望值 = (WinRate × AvgWin) − (LossRate × AvgLoss)
 * > 0 : 策略有效 ✅
 * < 0 : 策略无效 ❌ 淘汰
 */

import type { Trade } from './types';
import type { EdgeVerifierResult, EdgeReport } from './types';

const STORAGE_KEY = 'crypto-journal-edge-records';

// ==================== 存储 ====================

function readRecords(): EdgeVerifierResult[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveRecords(records: EdgeVerifierResult[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

// ==================== 核心计算 ====================

/** 从交易数据中计算单个策略的 Edge 指标 */
export function calcEdge(trades: Trade[], strategyName: string = '默认策略'): EdgeVerifierResult {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      strategyName,
      totalTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      expectancy: 0,
      isAlive: false,
      updatedAt: new Date().toISOString(),
    };
  }

  const winning = trades.filter((t) => (t.pnl ?? 0) > 0);
  const losing = trades.filter((t) => (t.pnl ?? 0) <= 0);
  const wins = winning.length;
  const losses = losing.length;

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWin = wins > 0 ? winning.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins : 0;
  const avgLoss = losses > 0 ? Math.abs(losing.reduce((s, t) => s + (t.pnl ?? 0), 0)) / losses : 0;

  // 期望值 = (WinRate × AvgWin) − (LossRate × AvgLoss)
  const lossRate = (totalTrades - wins) / totalTrades;
  const expectancy = (winRate / 100 * avgWin) - (lossRate * avgLoss);

  // 盈亏比
  const profitFactor = avgLoss > 0 ? (wins * avgWin) / (losses * avgLoss) : wins > 0 ? Infinity : 0;

  return {
    strategyName,
    totalTrades,
    winRate: Math.round(winRate * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    isAlive: expectancy > 0,
    updatedAt: new Date().toISOString(),
  };
}

/** 按策略分组计算 Edge */
export function calcEdgeByStrategy(trades: Trade[]): EdgeVerifierResult[] {
  // 按策略分组
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = t.strategyId || '未归类';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const results: EdgeVerifierResult[] = [];
  for (const [strategyId, groupTrades] of groups) {
    results.push(calcEdge(groupTrades, strategyId));
  }

  // 再算一个所有交易的总体边缘
  if (trades.length > 0) {
    results.push(calcEdge(trades, '全部交易'));
  }

  return results.sort((a, b) => b.expectancy - a.expectancy);
}

/** 生成每日 Edge 报告 */
export function generateEdgeReport(trades: Trade[]): EdgeReport {
  const results = calcEdgeByStrategy(trades);
  const alive = results.filter((r) => r.isAlive);
  const eliminated = results.filter((r) => !r.isAlive);

  const sortedByExpectancy = [...results].sort((a, b) => b.expectancy - a.expectancy);

  return {
    date: new Date().toISOString().split('T')[0],
    results,
    summary: {
      aliveCount: alive.length,
      eliminatedCount: eliminated.length,
      bestStrategy: sortedByExpectancy[0]?.strategyName ?? '无',
      worstStrategy: sortedByExpectancy[sortedByExpectancy.length - 1]?.strategyName ?? '无',
    },
  };
}

/** 保存 Edge 记录并返回报告 */
export function runEdgeCheck(trades: Trade[]): EdgeReport {
  const report = generateEdgeReport(trades);
  saveRecords(report.results);
  return report;
}

/** 获取历史 Edge 记录 */
export function getEdgeHistory(): EdgeVerifierResult[] {
  return readRecords();
}

/** 格式化 Edge 结果为可读字符串 */
export function formatEdgeResult(result: EdgeVerifierResult): string {
  const status = result.isAlive ? '✅' : '❌';
  return `${status} ${result.strategyName}: ` +
    `胜率 ${result.winRate.toFixed(1)}% · ` +
    `盈亏比 ${result.profitFactor.toFixed(2)} · ` +
    `期望值 ${result.expectancy >= 0 ? '+' : ''}${result.expectancy.toFixed(2)}` +
    (result.totalTrades > 0 ? ` (${result.totalTrades}笔)` : ' (无数据)');
}

/** 获取应淘汰的策略 */
export function getEliminatedStrategies(): EdgeVerifierResult[] {
  return readRecords().filter((r) => !r.isAlive && r.totalTrades > 0);
}

/** 获取有效策略 */
export function getAliveStrategies(): EdgeVerifierResult[] {
  return readRecords().filter((r) => r.isAlive);
}
