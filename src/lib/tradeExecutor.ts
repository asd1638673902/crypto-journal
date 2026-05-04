/**
 * 模拟订单执行器 — 模拟下单、持仓管理、平仓（不实际连接交易所）
 *
 * 所有操作记录到 localStorage，可复盘
 */

import type { SimulatedOrder, EngineType, TradeQualityScore } from './types';
import { calcPositionSizeV2, type PositionSizeV2 } from './riskProtocol';

const STORAGE_KEY = 'crypto-journal-simulated-orders';

let _idCounter = 0;
function genId(): string {
  _idCounter++;
  return `sim-${Date.now().toString(36)}-${_idCounter}`;
}

// ==================== 存储 ====================

function readOrders(): SimulatedOrder[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveOrders(orders: SimulatedOrder[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

// ==================== 模拟下单 ====================

export interface PlaceOrderParams {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  engineType: EngineType;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number[];
  signalScore: number;
  qualityScore: number;
  marketState: string;
  positionSize: PositionSizeV2;
  notes?: string;
}

/**
 * 创建模拟订单
 */
export function placeSimulatedOrder(params: PlaceOrderParams): SimulatedOrder {
  const now = new Date().toISOString();
  const order: SimulatedOrder = {
    id: genId(),
    createdAt: now,
    symbol: params.symbol,
    direction: params.direction,
    engineType: params.engineType,
    signalScore: params.signalScore,
    qualityScore: params.qualityScore,
    marketState: params.marketState as any,
    entryPrice: params.entryPrice,
    stopLoss: params.stopLoss,
    takeProfit: params.takeProfit,
    positionSize: params.positionSize.positionSize,
    positionValue: params.positionSize.positionValue,
    riskAmount: params.positionSize.riskAmount,
    riskPercent: params.positionSize.riskPercent,
    batch1Qty: params.positionSize.batch1.qty,
    batch2Qty: params.positionSize.batch2.qty,
    batch3Qty: params.positionSize.batch3.qty,
    status: 'SIGNALED',
    notes: params.notes,
  };

  const orders = readOrders();
  orders.push(order);
  saveOrders(orders);
  return order;
}

/**
 * 执行订单（模拟成交）
 */
export function executeOrder(orderId: string, filledPrice?: number): SimulatedOrder | null {
  const orders = readOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return null;

  orders[idx] = {
    ...orders[idx],
    status: 'EXECUTED',
    executedAt: new Date().toISOString(),
    filledPrice: filledPrice || orders[idx].entryPrice,
  };
  saveOrders(orders);
  return orders[idx];
}

/**
 * 关闭订单（模拟平仓）
 */
export function closeOrder(orderId: string, exitPrice: number): { order: SimulatedOrder | null; pnl: number } {
  const orders = readOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return { order: null, pnl: 0 };

  const o = orders[idx];
  const entry = o.filledPrice || o.entryPrice;
  const direction = o.direction === 'LONG' ? 1 : -1;
  const pnl = (exitPrice - entry) * direction * o.positionSize;

  orders[idx] = {
    ...o,
    status: 'CLOSED',
    exitPrice,
    pnl: Math.round(pnl * 100) / 100,
  };
  saveOrders(orders);
  return { order: orders[idx], pnl: orders[idx].pnl ?? 0 };
}

/**
 * 取消订单
 */
export function cancelOrder(orderId: string): SimulatedOrder | null {
  const orders = readOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], status: 'CANCELLED' };
  saveOrders(orders);
  return orders[idx];
}

// ==================== 查询 ====================

export function getSimulatedOrders(): SimulatedOrder[] {
  return readOrders().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getOpenOrders(): SimulatedOrder[] {
  return readOrders().filter((o) => o.status === 'SIGNALED' || o.status === 'EXECUTED');
}

export function getClosedOrders(): SimulatedOrder[] {
  return readOrders().filter((o) => o.status === 'CLOSED');
}

export function getOrdersByEngine(engineType: EngineType): SimulatedOrder[] {
  return readOrders().filter((o) => o.engineType === engineType);
}

// ==================== 统计 ====================

export interface SimulatedStats {
  totalOrders: number;
  openOrders: number;
  closedOrders: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  avgScore: number;
}

export function getSimulatedStats(): SimulatedStats {
  const orders = readOrders();
  const closed = orders.filter((o) => o.status === 'CLOSED');
  const winning = closed.filter((o) => (o.pnl ?? 0) > 0);

  return {
    totalOrders: orders.length,
    openOrders: orders.filter((o) => o.status === 'SIGNALED' || o.status === 'EXECUTED').length,
    closedOrders: closed.length,
    winRate: closed.length > 0 ? Math.round((winning.length / closed.length) * 100) : 0,
    totalPnl: closed.reduce((s, o) => s + (o.pnl ?? 0), 0),
    avgPnl: closed.length > 0 ? Math.round(closed.reduce((s, o) => s + (o.pnl ?? 0), 0) / closed.length * 100) / 100 : 0,
    avgScore: orders.length > 0 ? Math.round(orders.reduce((s, o) => s + o.signalScore, 0) / orders.length) : 0,
  };
}

/** 清除所有模拟订单 */
export function clearAllSimulatedOrders(): void {
  localStorage.removeItem(STORAGE_KEY);
}
