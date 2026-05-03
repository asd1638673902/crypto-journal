/**
 * 交易计划数据层
 * 支持交易计划的创建、管理、关联实际交易、计划 vs 实际对比
 */

import { generateId } from './db';

// ==================== 类型定义 ====================

// ==================== 类型定义 ====================

export type TradePlanStatus = 'PLANNED' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
export type SetupType = 'BREAKOUT' | 'PULLBACK' | 'TREND_FOLLOW' | 'REVERSAL' | 'RANGE' | 'MTF_CONFLUENCE' | 'OTHER';

export interface TradePlan {
  id: string;
  createdAt: string;
  updatedAt: string;

  // 基本信息
  symbol: string;
  direction: 'LONG' | 'SHORT';
  setupType: SetupType;
  status: TradePlanStatus;

  // 计划价格
  plannedEntry: number;
  plannedStopLoss: number;
  plannedTakeProfit: number[];
  plannedPositionSize?: number;
  plannedRiskPercent?: number;
  plannedLeverage?: number;

  // 触发条件
  triggerConditions: string[];
  invalidationConditions: string[]; // 计划失效条件

  // 分析来源
  sourceScanType?: string; // 哪个扫描发现的: 'breakout' | 'trend' | 'mtf' 等
  sourceInterval?: string; // 分析周期
  mtfScore?: number; // 多时间框架一致性评分

  // 笔记
  rationale: string; // 交易理由/逻辑
  notes?: string;
  emotions?: string; // 制定计划时的情绪状态

  // 关联实际交易
  relatedTradeId?: string; // 关联的 Trade.id
  actualEntry?: number;
  actualExit?: number;
  actualPnl?: number;
  actualPnlPercent?: number;

  // 计划 vs 实际对比（复盘时自动计算）
  executionDeviation?: {
    entryDeviationPercent: number; // 入场偏离百分比
    stopDeviationPercent: number; // 止损偏离
    tpDeviationPercent: number; // 止盈偏离
    sizeDeviationPercent: number; // 仓位偏离
    planFollowed: boolean; // 是否按计划执行
    deviations: string[]; // 具体偏差描述
  };
}

// ==================== 存储键 ====================

const STORAGE_KEY = 'crypto-journal-trade-plans';

function readPlans(): TradePlan[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function writePlans(plans: TradePlan[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

// ==================== CRUD ====================

export function getTradePlans(): TradePlan[] {
  return readPlans();
}

export function getTradePlan(id: string): TradePlan | undefined {
  return readPlans().find((p) => p.id === id);
}

export function addTradePlan(plan: Omit<TradePlan, 'id' | 'createdAt' | 'updatedAt'>): TradePlan {
  const plans = readPlans();
  const now = new Date().toISOString();
  const newPlan: TradePlan = {
    ...plan,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  plans.push(newPlan);
  writePlans(plans);
  return newPlan;
}

export function updateTradePlan(id: string, updates: Partial<TradePlan>): TradePlan | null {
  const plans = readPlans();
  const idx = plans.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  plans[idx] = { ...plans[idx], ...updates, updatedAt: new Date().toISOString() };
  writePlans(plans);
  return plans[idx];
}

export function deleteTradePlan(id: string): boolean {
  const plans = readPlans();
  const filtered = plans.filter((p) => p.id !== id);
  if (filtered.length === plans.length) return false;
  writePlans(filtered);
  return true;
}

// ==================== 状态流转 ====================

export function activatePlan(id: string): TradePlan | null {
  return updateTradePlan(id, { status: 'ACTIVE' });
}

export function closePlan(id: string, actualData: {
  actualEntry: number;
  actualExit: number;
  actualPnl: number;
  actualPnlPercent: number;
  relatedTradeId?: string;
}): TradePlan | null {
  const plan = getTradePlan(id);
  if (!plan) return null;

  // 自动计算计划 vs 实际偏差
  const deviations: string[] = [];

  const entryDeviationPercent = ((actualData.actualEntry - plan.plannedEntry) / plan.plannedEntry) * 100;
  if (Math.abs(entryDeviationPercent) > 1) {
    deviations.push(`入场偏离 ${entryDeviationPercent > 0 ? '+' : ''}${entryDeviationPercent.toFixed(2)}%`);
  }

  const stopDeviationPercent = plan.plannedStopLoss
    ? ((actualData.actualExit - plan.plannedStopLoss) / plan.plannedStopLoss) * 100
    : 0;

  let tpDeviationPercent = 0;
  if (plan.plannedTakeProfit.length > 0 && actualData.actualPnl > 0) {
    tpDeviationPercent = ((actualData.actualExit - plan.plannedTakeProfit[0]) / plan.plannedTakeProfit[0]) * 100;
  }

  const planFollowed = deviations.length === 0 && Math.abs(entryDeviationPercent) <= 0.5;

  return updateTradePlan(id, {
    status: 'CLOSED',
    ...actualData,
    executionDeviation: {
      entryDeviationPercent,
      stopDeviationPercent,
      tpDeviationPercent,
      sizeDeviationPercent: 0,
      planFollowed,
      deviations,
    },
  });
}

export function cancelPlan(id: string, reason?: string): TradePlan | null {
  const plan = getTradePlan(id);
  if (!plan) return null;
  return updateTradePlan(id, {
    status: 'CANCELLED',
    notes: plan.notes ? `${plan.notes}\n[取消原因] ${reason || ''}` : `[取消原因] ${reason || ''}`,
  });
}

// ==================== 查询 ====================

export function getPlansByStatus(status: TradePlanStatus): TradePlan[] {
  return readPlans().filter((p) => p.status === status);
}

export function getPlansBySymbol(symbol: string): TradePlan[] {
  return readPlans().filter((p) => p.symbol === symbol);
}

export function getActivePlans(): TradePlan[] {
  return readPlans().filter((p) => p.status === 'ACTIVE' || p.status === 'PLANNED');
}

/** 获取与交易关联的计划 */
export function getPlanByTradeId(tradeId: string): TradePlan | undefined {
  return readPlans().find((p) => p.relatedTradeId === tradeId);
}

// ==================== 统计 ====================

export interface PlanStats {
  total: number;
  planned: number;
  active: number;
  closed: number;
  cancelled: number;
  avgPlannedRR: number;
  planFollowedRate: number; // 按计划执行的比例
  avgDeviation: number; // 平均入场偏离
}

export function getPlanStats(): PlanStats {
  const plans = readPlans();
  const closed = plans.filter((p) => p.status === 'CLOSED');
  const withDeviation = closed.filter((p) => p.executionDeviation);

  const avgPlannedRR = plans.length > 0
    ? plans.reduce((sum, p) => {
        const risk = Math.abs(p.plannedEntry - p.plannedStopLoss);
        const reward = p.plannedTakeProfit.length > 0 ? Math.abs(p.plannedTakeProfit[0] - p.plannedEntry) : 0;
        return sum + (risk > 0 ? reward / risk : 0);
      }, 0) / plans.length
    : 0;

  const planFollowedRate = withDeviation.length > 0
    ? withDeviation.filter((p) => p.executionDeviation!.planFollowed).length / withDeviation.length * 100
    : 0;

  const avgDeviation = withDeviation.length > 0
    ? withDeviation.reduce((sum, p) => sum + Math.abs(p.executionDeviation!.entryDeviationPercent), 0) / withDeviation.length
    : 0;

  return {
    total: plans.length,
    planned: plans.filter((p) => p.status === 'PLANNED').length,
    active: plans.filter((p) => p.status === 'ACTIVE').length,
    closed: closed.length,
    cancelled: plans.filter((p) => p.status === 'CANCELLED').length,
    avgPlannedRR,
    planFollowedRate,
    avgDeviation,
  };
}

// ==================== 从扫描结果快速创建计划 ====================

export function createPlanFromSignal(params: {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryZone: { low: number; high: number };
  stopLoss: number;
  takeProfit: number[];
  setupType?: SetupType;
  sourceScanType?: string;
  sourceInterval?: string;
  mtfScore?: number;
  rationale?: string;
}): TradePlan {
  const plan: Omit<TradePlan, 'id' | 'createdAt' | 'updatedAt'> = {
    symbol: params.symbol,
    direction: params.direction,
    setupType: params.setupType ?? 'OTHER',
    status: 'PLANNED',
    plannedEntry: (params.entryZone.low + params.entryZone.high) / 2,
    plannedStopLoss: params.stopLoss,
    plannedTakeProfit: params.takeProfit,
    triggerConditions: [],
    invalidationConditions: [],
    sourceScanType: params.sourceScanType,
    sourceInterval: params.sourceInterval,
    mtfScore: params.mtfScore,
    rationale: params.rationale ?? '',
  };
  return addTradePlan(plan);
}

