/**
 * 从交易记录动态生成图表数据
 */

import type { Trade } from './types';

/** 月度盈亏数据点 */
export interface MonthlyPnL {
  month: string;
  pnl: number;
  winCount: number;
  lossCount: number;
  totalCount: number;
}

/** 权益曲线数据点 */
export interface EquityPoint {
  day: string;
  equity: number;
  tradeLabel?: string;
}

/**
 * 从已平仓交易生成月度盈亏数据
 */
export function generateMonthlyPnL(trades: Trade[], startEquity: number = 0): MonthlyPnL[] {
  const closed = trades.filter((t) => t.status === 'CLOSED' && t.exitTime && t.pnl !== undefined);

  // 按月份分组
  const monthMap = new Map<string, { pnl: number; win: number; loss: number; total: number }>();

  for (const t of closed) {
    const date = new Date(t.exitTime!);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthMap.has(key)) monthMap.set(key, { pnl: 0, win: 0, loss: 0, total: 0 });
    const entry = monthMap.get(key)!;
    entry.pnl += t.pnl!;
    entry.total++;
    if (t.pnl! > 0) entry.win++;
    else if (t.pnl! < 0) entry.loss++;
  }

  // 转换为数组并排序
  const sorted = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  // 取最近 12 个月
  const recent = sorted.slice(-12);

  return recent.map(([key, val]) => ({
    month: key,
    pnl: val.pnl,
    winCount: val.win,
    lossCount: val.loss,
    totalCount: val.total,
  }));
}

/**
 * 从已平仓交易生成权益曲线数据
 *
 * 按时间排序交易，累积盈亏作为权益变化。
 * startEquity 为初始资金（默认 10000），用于设定 Y 轴起点。
 */
export function generateEquityCurve(
  trades: Trade[],
  startEquity: number = 10000,
): EquityPoint[] {
  const closed = trades
    .filter((t) => t.status === 'CLOSED' && t.exitTime && t.pnl !== undefined)
    .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime());

  if (closed.length === 0) {
    return [{ day: '开始', equity: startEquity }];
  }

  const points: EquityPoint[] = [];
  let equity = startEquity;

  // 添加起点
  const firstDate = new Date(closed[0].exitTime!);
  points.push({
    day: `${firstDate.getMonth() + 1}/${firstDate.getDate()}`,
    equity,
  });

  for (const t of closed) {
    equity += t.pnl!;
    const date = new Date(t.exitTime!);
    const dayLabel = `${date.getMonth() + 1}/${date.getDate()}`;
    points.push({
      day: dayLabel,
      equity: Math.round(equity * 100) / 100,
      tradeLabel: `${t.symbol} ${t.pnl! >= 0 ? '+' : ''}${t.pnl!.toFixed(0)}`,
    });
  }

  return points;
}

/**
 * 生成品种盈亏分布
 */
export function generateSymbolBreakdown(trades: Trade[]): {
  symbol: string;
  pnl: number;
  count: number;
  winRate: number;
}[] {
  const closed = trades.filter((t) => t.status === 'CLOSED' && t.pnl !== undefined);

  const symMap = new Map<string, { pnl: number; wins: number; total: number }>();

  for (const t of closed) {
    if (!symMap.has(t.symbol)) symMap.set(t.symbol, { pnl: 0, wins: 0, total: 0 });
    const entry = symMap.get(t.symbol)!;
    entry.pnl += t.pnl!;
    entry.total++;
    if (t.pnl! > 0) entry.wins++;
  }

  return [...symMap.entries()]
    .map(([symbol, val]) => ({
      symbol,
      pnl: val.pnl,
      count: val.total,
      winRate: val.total > 0 ? (val.wins / val.total) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}
