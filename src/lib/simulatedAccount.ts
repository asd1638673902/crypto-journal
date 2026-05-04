/**
 * 模拟账户 — 余额管理、手续费、杠杆、持仓跟踪、盈亏计算
 *
 * 模拟真实交易所的账户行为，包含：
 * - 初始余额 / 当前权益
 * - Maker/Taker 手续费
 * - 杠杆设置
 * - 持仓跟踪
 * - 盈亏计算（含手续费）
 * - 账户历史记录
 */

import type { EngineType } from './types';

const STORAGE_KEY_ACCOUNT = 'crypto-journal-sim-account';
const STORAGE_KEY_HISTORY = 'crypto-journal-sim-history';

export const MAKER_FEE = 0.0002; // 0.02%
export const TAKER_FEE = 0.0004; // 0.04%

// ==================== 账户状态 ====================

export interface SimAccount {
  initialBalance: number;     // 初始余额 USDT
  currentBalance: number;     // 当前余额 USDT（含未实现盈亏）
  availableBalance: number;   // 可用余额 USDT（扣除保证金）
  usedMargin: number;         // 已用保证金 USDT
  unrealizedPnl: number;      // 未实现盈亏 USDT
  totalFeesPaid: number;      // 累计手续费 USDT
  totalPnl: number;           // 累计已实现盈亏 USDT
  totalTrades: number;        // 总交易次数
  winCount: number;
  lossCount: number;
  updatedAt: string;
}

export interface AccountPosition {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  engineType: EngineType;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  leverage: number;
  margin: number;           // 保证金
  liquidationPrice: number; // 强平价格
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  stopLoss: number;
  takeProfit: number[];
  openTime: string;
  orderId: string;         // 关联订单ID
}

export interface AccountEntry {
  timestamp: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'FEE' | 'REALIZED_PNL' | 'TRADE_OPEN' | 'TRADE_CLOSE' | 'LIQUIDATION';
  amount: number;
  balanceAfter: number;
  description: string;
}

const DEFAULT_ACCOUNT: SimAccount = {
  initialBalance: 10000,
  currentBalance: 10000,
  availableBalance: 10000,
  usedMargin: 0,
  unrealizedPnl: 0,
  totalFeesPaid: 0,
  totalPnl: 0,
  totalTrades: 0,
  winCount: 0,
  lossCount: 0,
  updatedAt: new Date().toISOString(),
};

// ==================== 存储 ====================

export function getSimAccount(): SimAccount {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACCOUNT);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { ...DEFAULT_ACCOUNT };
}

function saveSimAccount(account: SimAccount): void {
  localStorage.setItem(STORAGE_KEY_ACCOUNT, JSON.stringify({ ...account, updatedAt: new Date().toISOString() }));
}

export function getAccountPositions(): AccountPosition[] {
  try {
    return JSON.parse(localStorage.getItem('crypto-journal-sim-positions') || '[]');
  } catch { return []; }
}

function saveAccountPositions(positions: AccountPosition[]): void {
  localStorage.setItem('crypto-journal-sim-positions', JSON.stringify(positions));
}

export function getAccountHistory(): AccountEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '[]');
  } catch { return []; }
}

function addAccountEntry(entry: Omit<AccountEntry, 'timestamp'>): void {
  const history = getAccountHistory();
  history.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (history.length > 500) history.splice(500);
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
}

// ==================== 初始化 ====================

export function initSimAccount(initialBalance: number = 10000): SimAccount {
  const account = { ...DEFAULT_ACCOUNT, initialBalance, currentBalance: initialBalance, availableBalance: initialBalance };
  saveSimAccount(account);
  saveAccountPositions([]);
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify([]));
  addAccountEntry({ type: 'DEPOSIT', amount: initialBalance, balanceAfter: initialBalance, description: `初始入金 ${initialBalance} USDT` });
  return account;
}

// ==================== 开仓 ====================

export interface OpenPositionParams {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  engineType: EngineType;
  entryPrice: number;
  quantity: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number[];
  orderId: string;
}

export function openSimPosition(params: OpenPositionParams): { account: SimAccount; position: AccountPosition; fee: number } | null {
  const account = getSimAccount();
  const positionValue = params.entryPrice * params.quantity;
  const margin = positionValue / params.leverage;
  const fee = positionValue * TAKER_FEE;
  const totalCost = margin + fee;

  if (account.availableBalance < totalCost) {
    return null; // 余额不足
  }

  // 计算强平价格
  const liquidationPrice = params.direction === 'LONG'
    ? params.entryPrice * (1 - 1 / params.leverage + 0.005)
    : params.entryPrice * (1 + 1 / params.leverage - 0.005);

  const position: AccountPosition = {
    id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol: params.symbol,
    direction: params.direction,
    engineType: params.engineType,
    entryPrice: params.entryPrice,
    currentPrice: params.entryPrice,
    quantity: params.quantity,
    leverage: params.leverage,
    margin: Math.round(margin * 100) / 100,
    liquidationPrice: Math.round(liquidationPrice * 100) / 100,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    stopLoss: params.stopLoss,
    takeProfit: params.takeProfit,
    openTime: new Date().toISOString(),
    orderId: params.orderId,
  };

  const positions = getAccountPositions();
  positions.push(position);
  saveAccountPositions(positions);

  account.usedMargin += margin;
  account.availableBalance -= totalCost;
  account.totalFeesPaid += fee;
  account.totalTrades++;
  saveSimAccount(account);

  addAccountEntry({
    type: 'FEE',
    amount: -fee,
    balanceAfter: account.availableBalance + account.usedMargin + account.unrealizedPnl,
    description: `[${params.direction === 'LONG' ? '做多' : '做空'}] ${params.symbol} 开仓手续费 ${fee.toFixed(4)} USDT`,
  });
  addAccountEntry({
    type: 'TRADE_OPEN',
    amount: -margin,
    balanceAfter: account.availableBalance + account.usedMargin + account.unrealizedPnl,
    description: `开仓 ${params.symbol} ${params.direction} 数量 ${params.quantity} @ ${params.entryPrice} (${params.leverage}x)`,
  });

  return { account: getSimAccount(), position, fee: Math.round(fee * 10000) / 10000 };
}

// ==================== 平仓 ====================

export function closeSimPosition(positionId: string, exitPrice: number): {
  account: SimAccount; pnl: number; pnlPercent: number; fee: number; isWin: boolean;
} | null {
  const positions = getAccountPositions();
  const idx = positions.findIndex((p) => p.id === positionId);
  if (idx === -1) return null;

  const pos = positions[idx];
  const positionValue = exitPrice * pos.quantity;
  const fee = positionValue * TAKER_FEE;

  const priceDiff = pos.direction === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
  const pnl = priceDiff * pos.quantity - fee;
  const pnlPercent = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;

  // 更新账户
  const account = getSimAccount();
  account.usedMargin -= pos.margin;
  account.currentBalance += pnl;
  account.totalPnl += pnl;
  account.totalFeesPaid += fee;
  if (pnl > 0) account.winCount++;
  else account.lossCount++;

  // 释放保证金 + 盈亏
  account.availableBalance = account.currentBalance - account.usedMargin;

  // 移除持仓
  positions.splice(idx, 1);
  saveAccountPositions(positions);
  saveSimAccount(account);

  addAccountEntry({
    type: 'REALIZED_PNL',
    amount: pnl,
    balanceAfter: account.availableBalance + account.usedMargin + account.unrealizedPnl,
    description: `平仓 ${pos.symbol} ${pos.direction} @ ${exitPrice} 盈亏 ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
  });
  addAccountEntry({
    type: 'FEE',
    amount: -fee,
    balanceAfter: account.availableBalance + account.usedMargin + account.unrealizedPnl,
    description: `平仓手续费 ${fee.toFixed(4)} USDT`,
  });

  return {
    account: getSimAccount(),
    pnl: Math.round(pnl * 100) / 100,
    pnlPercent: Math.round(pnlPercent * 100) / 100,
    fee: Math.round(fee * 10000) / 10000,
    isWin: pnl > 0,
  };
}

// ==================== 更新持仓价格 ====================

export function updatePositionPrices(prices: Record<string, number>): void {
  const positions = getAccountPositions();
  if (positions.length === 0) return;

  for (const pos of positions) {
    const currPrice = prices[pos.symbol];
    if (!currPrice) continue;
    pos.currentPrice = currPrice;
    const priceDiff = pos.direction === 'LONG' ? currPrice - pos.entryPrice : pos.entryPrice - currPrice;
    pos.unrealizedPnl = Math.round(priceDiff * pos.quantity * 100) / 100;
    pos.unrealizedPnlPercent = pos.margin > 0 ? Math.round((pos.unrealizedPnl / pos.margin) * 10000) / 100 : 0;
  }

  saveAccountPositions(positions);

  // 更新账户权益
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const account = getSimAccount();
  account.unrealizedPnl = totalUnrealized;
  account.currentBalance = account.initialBalance + account.totalPnl + totalUnrealized;
  account.availableBalance = account.currentBalance - account.usedMargin;
  saveSimAccount(account);
}

// ==================== 重置 ====================

export function resetSimAccount(): SimAccount {
  return initSimAccount(10000);
}

// ==================== 格式化 ====================

export function formatAccount(account: SimAccount): string {
  const totalEquity = account.currentBalance;
  const pnl = account.totalPnl;
  const pnlPct = account.initialBalance > 0 ? (pnl / account.initialBalance) * 100 : 0;

  return [
    `💰 账户总权益: ${totalEquity.toFixed(2)} USDT`,
    `可用: ${account.availableBalance.toFixed(2)} | 保证金: ${account.usedMargin.toFixed(2)}`,
    `累计盈亏: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`,
    `手续费: ${account.totalFeesPaid.toFixed(4)} USDT`,
    `交易次数: ${account.totalTrades} (胜 ${account.winCount} / 负 ${account.lossCount})`,
  ].join('\n');
}
