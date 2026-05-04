/**
 * 自进化系统 — 每日/每周自动分析性能，优化策略参数
 *
 * 日输出：胜率、盈亏比、最大回撤、策略表现
 * 周执行：淘汰低效策略，强化稳定策略
 */

import type { Trade } from './types';
import { getTrades } from './db';
import { calcEdgeByStrategy, type EdgeVerifierResult } from './edgeVerifier';
import { getSimulatedOrders, getSimulatedStats } from './tradeExecutor';

const STORAGE_KEY = 'crypto-journal-evolution-data';

// ==================== 每日报告 ====================

export interface DailyReport {
  date: string;
  realTrades: {
    total: number;
    winning: number;
    losing: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
  };
  simulatedOrders: {
    total: number;
    winRate: number;
    totalPnl: number;
  };
  strategyEdges: EdgeVerifierResult[];
  topStrategy: string;
  worstStrategy: string;
  recommendations: string[];
}

/**
 * 生成每日交易报告
 */
export function generateDailyReport(): DailyReport {
  const trades = getTrades();
  const closedTrades = trades.filter((t) => t.status === 'CLOSED');
  const today = new Date().toISOString().split('T')[0];

  // 今日交易
  const todayTrades = closedTrades.filter((t) =>
    t.exitTime?.startsWith(today)
  );
  const winning = todayTrades.filter((t) => (t.pnl ?? 0) > 0);
  const losing = todayTrades.filter((t) => (t.pnl ?? 0) <= 0);

  // 策略 Edge
  const strategyEdges = calcEdgeByStrategy(closedTrades);
  const sortedEdges = [...strategyEdges].sort((a, b) => b.expectancy - a.expectancy);

  // 模拟订单统计
  const simStats = getSimulatedStats();

  // 建议
  const recommendations: string[] = [];
  for (const edge of strategyEdges) {
    if (!edge.isAlive && edge.totalTrades >= 5) {
      recommendations.push(`❌ 淘汰策略「${edge.strategyName}」: 期望值 ${edge.expectancy}`);
    }
    if (edge.isAlive && edge.expectancy > 0.5 && edge.totalTrades >= 5) {
      recommendations.push(`✅ 强化策略「${edge.strategyName}」: 期望值 ${edge.expectancy}`);
    }
  }

  return {
    date: today,
    realTrades: {
      total: todayTrades.length,
      winning: winning.length,
      losing: losing.length,
      winRate: todayTrades.length > 0 ? Math.round((winning.length / todayTrades.length) * 100) : 0,
      totalPnl: todayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0),
      avgPnl: todayTrades.length > 0
        ? Math.round(todayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0) / todayTrades.length * 100) / 100
        : 0,
    },
    simulatedOrders: {
      total: simStats.totalOrders,
      winRate: simStats.winRate,
      totalPnl: simStats.totalPnl,
    },
    strategyEdges,
    topStrategy: sortedEdges[0]?.strategyName ?? '无',
    worstStrategy: sortedEdges[sortedEdges.length - 1]?.strategyName ?? '无',
    recommendations,
  };
}

// ==================== 每周优化 ====================

export interface WeeklyOptimization {
  weekStart: string;
  weekEnd: string;
  eliminatedStrategies: EdgeVerifierResult[];
  strengthenedStrategies: EdgeVerifierResult[];
  actions: string[];
}

/**
 * 执行每周策略优化
 */
export function runWeeklyOptimization(): WeeklyOptimization {
  const trades = getTrades();
  const closedTrades = trades.filter((t) => t.status === 'CLOSED');
  const edges = calcEdgeByStrategy(closedTrades);

  const eliminated: EdgeVerifierResult[] = [];
  const strengthened: EdgeVerifierResult[] = [];
  const actions: string[] = [];

  for (const edge of edges) {
    if (!edge.isAlive && edge.totalTrades >= 5) {
      eliminated.push(edge);
      actions.push(`淘汰「${edge.strategyName}」— 期望值 ${edge.expectancy}`);
    }
    if (edge.isAlive && edge.expectancy > 0.5 && edge.totalTrades >= 3) {
      strengthened.push(edge);
      actions.push(`强化「${edge.strategyName}」— 期望值 ${edge.expectancy}`);
    }
  }

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const result: WeeklyOptimization = {
    weekStart: weekStart.toISOString().split('T')[0],
    weekEnd: weekEnd.toISOString().split('T')[0],
    eliminatedStrategies: eliminated,
    strengthenedStrategies: strengthened,
    actions,
  };

  // 保存
  saveEvolutionData(result);
  return result;
}

// ==================== 存储 ====================

function saveEvolutionData(data: WeeklyOptimization): void {
  try {
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    history.push(data);
    if (history.length > 52) history.splice(0, history.length - 52);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch { /* ignore */ }
}

export function getEvolutionHistory(): WeeklyOptimization[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}
