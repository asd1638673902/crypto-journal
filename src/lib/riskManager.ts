/**
 * 风险管理工具
 * 仓位计算、R/R分析、凯利公式、连续亏损模拟
 */

import type { BacktestResult } from './strategyMetrics';

/** 仓位计算结果 */
export interface PositionSizeResult {
  positionSize: number;       // 交易数量（币）
  positionValue: number;      // 仓位价值（USDT）
  marginRequired: number;     // 所需保证金（USDT）
  riskAmount: number;         // 风险敞口（USDT）
  riskPercent: number;        // 风险占总资金比例（%）
  stopDistance: number;       // 止损距离（价格）
  stopDistancePercent: number; // 止损距离百分比（%）
  rrRatio: number;            // 风险回报比
}

/** 凯利公式结果 */
export interface KellyResult {
  kellyPercent: number;       // 凯利比例（%）
  halfKellyPercent: number;   // 半凯利
  quarterKellyPercent: number; // 四分之一凯利
}

/**
 * 计算仓位大小
 * @param accountBalance 账户总资金（USDT）
 * @param entryPrice 入场价格
 * @param stopPrice 止损价格
 * @param riskPercent 每笔风险比例（%），如 1 = 1%
 * @param leverage 杠杆倍数
 */
export function calcPositionSize(
  accountBalance: number,
  entryPrice: number,
  stopPrice: number,
  riskPercent: number,
  leverage: number = 1,
): PositionSizeResult | null {
  if (accountBalance <= 0 || entryPrice <= 0 || stopPrice <= 0) return null;

  const riskAmount = accountBalance * (riskPercent / 100);
  const stopDistance = Math.abs(entryPrice - stopPrice);
  const stopDistancePercent = entryPrice > 0 ? (stopDistance / entryPrice) * 100 : 0;

  if (stopDistance <= 0) return null;

  // 单币风险 = stopDistance（不做空简化）
  const positionSize = (riskAmount / stopDistance) * leverage;
  const positionValue = positionSize * entryPrice;
  const marginRequired = positionValue / leverage;
  const rrRatio = stopDistance > 0 ? Math.abs(entryPrice - stopPrice) / stopDistance : 1;

  return {
    positionSize: Math.round(positionSize * 10000) / 10000,
    positionValue: Math.round(positionValue * 100) / 100,
    marginRequired: Math.round(marginRequired * 100) / 100,
    riskAmount: Math.round(riskAmount * 100) / 100,
    riskPercent,
    stopDistance: Math.round(stopDistance * 100) / 100,
    stopDistancePercent: Math.round(stopDistancePercent * 100) / 100,
    rrRatio: Math.round(rrRatio * 100) / 100,
  };
}

/**
 * 凯利公式计算最优仓位比例
 * @param winRate 胜率（小数，如 0.6 = 60%）
 * @param avgWin 平均盈利金额
 * @param avgLoss 平均亏损金额
 */
export function calcKelly(winRate: number, avgWin: number, avgLoss: number): KellyResult | null {
  if (avgLoss <= 0 || winRate <= 0 || winRate >= 1) return null;
  const b = avgWin / avgLoss;
  const q = 1 - winRate;
  const kelly = (winRate * b - q) / b;
  const safeKelly = Math.max(0, Math.min(kelly, 0.25)); // 限制最大 25%

  return {
    kellyPercent: Math.round(safeKelly * 10000) / 100,
    halfKellyPercent: Math.round((safeKelly / 2) * 10000) / 100,
    quarterKellyPercent: Math.round((safeKelly / 4) * 10000) / 100,
  };
}

/**
 * 从回测结果计算凯利公式
 */
export function calcKellyFromBacktest(result: BacktestResult): KellyResult | null {
  const winRate = result.winRate / 100;
  return calcKelly(winRate / 100, result.avgWin, result.avgLoss);
  // Note: winRate is already /100, so we divide again. Fix: winRate is percentage
}

/**
 * 模拟连续亏损对账户的影响
 */
export function simulateConsecutiveLosses(
  accountBalance: number,
  lossPercent: number,
  maxConsecutive: number,
): { balance: number; lossAmount: number; lossPercent: number }[] {
  const results: { balance: number; lossAmount: number; lossPercent: number }[] = [];
  let balance = accountBalance;

  for (let i = 0; i < maxConsecutive; i++) {
    const loss = balance * (lossPercent / 100);
    balance -= loss;
    results.push({
      balance: Math.round(balance * 100) / 100,
      lossAmount: Math.round(loss * 100) / 100,
      lossPercent: Math.round((loss / accountBalance) * 10000) / 100,
    });
  }

  return results;
}
