/**
 * 风控协议 — 全局风控状态 + 仓位计算 + 停机机制
 *
 * 铁律：
 * - 单笔风险：稳健 ≤ 1%，激进 ≤ 2%
 * - 连亏 ≥ 3 → 停止交易
 * - 日亏 ≥ 5% → 强制停止
 * - 最大回撤 ≥ 15% → 降低仓位
 */

import type { RiskState, EngineType, SignalScore } from './types';
import type { KlineData } from './exchange';

const STORAGE_KEY_RISK = 'crypto-journal-risk-state';

// ==================== 仓位计算 ====================

export interface PositionSizeV2 {
  positionSize: number;
  positionValue: number;
  marginRequired: number;
  riskAmount: number;
  riskPercent: number;
  stopDistance: number;
  rrRatio: number;

  // 分批
  batch1: { qty: number; value: number };  // 30% 试仓
  batch2: { qty: number; value: number };  // 30% 确认
  batch3: { qty: number; value: number };  // 40% 趋势
}

/**
 * V2 仓位计算（带评分修正 + 风控模式）
 */
export function calcPositionSizeV2(
  equity: number,
  entryPrice: number,
  stopPrice: number,
  takeProfit: number[],
  engineType: EngineType,
  signalScore?: SignalScore,
): PositionSizeV2 | null {
  if (equity <= 0 || entryPrice <= 0 || stopPrice <= 0) return null;

  // 基础风险比例
  const baseRiskPct = engineType === 'AGGRESSIVE' ? 2 : 1;

  // 信号评分修正：高分可以略微提高风险
  let riskModifier = 1;
  if (signalScore) {
    if (signalScore.totalScore >= 80) riskModifier = 1.2;
    else if (signalScore.totalScore < 60) return null; // 禁止交易
  }

  const riskPct = baseRiskPct * riskModifier;
  const riskAmount = equity * (riskPct / 100);
  const stopDistance = Math.abs(entryPrice - stopPrice);

  if (stopDistance <= 0) return null;

  const positionSize = riskAmount / stopDistance;
  const positionValue = positionSize * entryPrice;
  const marginRequired = positionValue; // 假设 1x

  const reward = takeProfit.length > 0 ? Math.abs(takeProfit[0] - entryPrice) : 0;
  const rrRatio = stopDistance > 0 ? reward / stopDistance : 0;

  // 分批仓位
  const batch1Qty = positionSize * 0.3;
  const batch2Qty = positionSize * 0.3;
  const batch3Qty = positionSize * 0.4;

  return {
    positionSize: Math.round(positionSize * 10000) / 10000,
    positionValue: Math.round(positionValue * 100) / 100,
    marginRequired: Math.round(marginRequired * 100) / 100,
    riskAmount: Math.round(riskAmount * 100) / 100,
    riskPercent: Math.round(riskPct * 100) / 100,
    stopDistance: Math.round(stopDistance * 100) / 100,
    rrRatio: Math.round(rrRatio * 100) / 100,
    batch1: { qty: Math.round(batch1Qty * 10000) / 10000, value: Math.round(batch1Qty * entryPrice * 100) / 100 },
    batch2: { qty: Math.round(batch2Qty * 10000) / 10000, value: Math.round(batch2Qty * entryPrice * 100) / 100 },
    batch3: { qty: Math.round(batch3Qty * 10000) / 10000, value: Math.round(batch3Qty * entryPrice * 100) / 100 },
  };
}

// ==================== 停机机制 ====================

export interface CircuitBreakerResult {
  shouldStop: boolean;
  reasons: string[];
  recommendedAction: 'STOP' | 'REDUCE' | 'CONTINUE' | 'STOP_ALL';
}

/**
 * 检查停机条件
 */
export function checkCircuitBreakers(
  consecutiveLosses: number,
  dailyLossPercent: number,
  maxDrawdownPercent: number,
): CircuitBreakerResult {
  const reasons: string[] = [];
  let shouldStop = false;
  let recommendedAction: CircuitBreakerResult['recommendedAction'] = 'CONTINUE';

  // 连亏 ≥ 3 → 停止
  if (consecutiveLosses >= 3) {
    reasons.push(`连亏 ${consecutiveLosses} 次 ≥ 3，触发停机`);
    shouldStop = true;
  }

  // 日亏 ≥ 5% → 强制停止
  if (dailyLossPercent >= 5) {
    reasons.push(`日亏 ${dailyLossPercent.toFixed(1)}% ≥ 5%，强制停止`);
    shouldStop = true;
  }

  // 最大回撤 ≥ 15% → 降低仓位
  if (maxDrawdownPercent >= 15) {
    reasons.push(`最大回撤 ${maxDrawdownPercent.toFixed(1)}% ≥ 15%，降低仓位`);
    shouldStop = false; // 降仓不停止
    recommendedAction = 'REDUCE';
  }

  if (shouldStop) {
    recommendedAction = consecutiveLosses >= 3 ? 'STOP' : 'STOP_ALL';
  }

  return { shouldStop, reasons, recommendedAction };
}

// ==================== 风控状态管理 ====================

/** 获取当前风控状态 */
export function getRiskState(): RiskState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RISK);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { status: 'NORMAL', consecutiveLosses: 0, dailyLossPercent: 0, maxDrawdownPercent: 0 };
}

/** 保存风控状态 */
export function saveRiskState(state: Partial<RiskState>): void {
  const current = getRiskState();
  const updated = { ...current, ...state };
  localStorage.setItem(STORAGE_KEY_RISK, JSON.stringify(updated));
}

/** 重置风控状态 */
export function resetRiskState(): void {
  localStorage.setItem(STORAGE_KEY_RISK, JSON.stringify({
    status: 'NORMAL', consecutiveLosses: 0, dailyLossPercent: 0, maxDrawdownPercent: 0,
  }));
}

/** 记录一次亏损 */
export function recordLoss(lossPercent: number): CircuitBreakerResult {
  const state = getRiskState();
  const newLosses = state.consecutiveLosses + 1;
  const newDailyLoss = state.dailyLossPercent + Math.abs(lossPercent);
  const newDrawdown = Math.max(state.maxDrawdownPercent, newDailyLoss);
  saveRiskState({
    consecutiveLosses: newLosses,
    dailyLossPercent: newDailyLoss,
    maxDrawdownPercent: newDrawdown,
  });
  return checkCircuitBreakers(newLosses, newDailyLoss, newDrawdown);
}

/** 记录一次盈利（重置连亏计数） */
export function recordWin(): void {
  const state = getRiskState();
  saveRiskState({
    consecutiveLosses: 0,
    dailyLossPercent: state.dailyLossPercent,
    maxDrawdownPercent: state.maxDrawdownPercent,
    status: 'NORMAL',
  });
}
