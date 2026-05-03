/**
 * 策略诊断指标计算
 * Sharpe Ratio, Sortino Ratio, Calmar Ratio, Max Drawdown 等
 */

/** 单笔模拟交易 */
export interface SimulatedTrade {
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  direction: 'LONG' | 'SHORT';
  pnl: number;       // 点数盈亏（未归一化）
  pnlPercent: number; // 盈亏百分比
  holdingBars: number;
  exitReason: 'signal' | 'stop_loss' | 'take_profit';
  /** 持仓数量（币），风控集成后可用 */
  positionSize?: number;
  /** 仓位价值（USDT），风控集成后可用 */
  positionValue?: number;
  /** USDT 盈亏，风控集成后可用 */
  pnlUsdt?: number;
}

/** 回测结果 */
export interface BacktestResult {
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  totalBars: number;
  trades: SimulatedTrade[];

  // 初始资金
  initialCapital: number;

  // 基础统计
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;

  totalPnl: number;       // 总盈亏（点数）
  totalPnlPercent: number; // 总盈亏百分比
  totalPnlUsdt: number;    // 总盈亏（USDT，基于初始资金）
  avgPnl: number;
  avgWin: number;
  avgLoss: number;

  profitFactor: number;
  expectancy: number;

  // 高级指标
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;

  avgHoldingBars: number;
  avgHoldingMinutes: number;

  bestTrade: number;
  worstTrade: number;

  // 月度分布
  monthlyBreakdown: { month: string; pnl: number; trades: number }[];

  // 权益曲线（USDT）
  equityUsdtCurve: { trade: string; equity: number }[];
}

/** 计算夏普比率（年化） */
export function calcSharpeRatio(returns: number[], riskFree: number = 0.02): number {
  if (returns.length < 2) return 0;
  const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  // 假设每个 return 代表一根K线，年化因子取决于K线周期
  return ((avg - riskFree / (365 * 24 * 60)) / std) * Math.sqrt(365 * 24 * 60);
}

/** 计算索提诺比率 */
export function calcSortinoRatio(returns: number[], riskFree: number = 0.02): number {
  if (returns.length < 2) return 0;
  const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
  const downsideVariance =
    returns.reduce((s, r) => s + (r < 0 ? Math.pow(r, 2) : 0), 0) / (returns.length - 1);
  const downside = Math.sqrt(downsideVariance);
  if (downside === 0) return 0;
  return ((avg - riskFree / (365 * 24 * 60)) / downside) * Math.sqrt(365 * 24 * 60);
}

/** 计算最大回撤 */
export function calcMaxDrawdown(equityCurve: number[]): {
  maxDrawdown: number;
  maxDrawdownPercent: number;
} {
  let peak = equityCurve[0] || 0;
  let maxDD = 0;
  let maxDDPct = 0;

  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    const ddPct = peak > 0 ? dd / peak : 0;
    if (dd > maxDD) maxDD = dd;
    if (ddPct > maxDDPct) maxDDPct = ddPct;
  }

  return { maxDrawdown: maxDD, maxDrawdownPercent: maxDDPct * 100 };
}

/** 生成月度盈亏分布 */
export function monthlyPnL(trades: SimulatedTrade[]): {
  month: string;
  pnl: number;
  trades: number;
}[] {
  const map = new Map<string, { pnl: number; count: number }>();
  for (const t of trades) {
    const d = new Date(t.exitTime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, { pnl: 0, count: 0 });
    const m = map.get(key)!;
    m.pnl += t.pnlPercent;
    m.count++;
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, pnl: v.pnl, trades: v.count }));
}

/** 从模拟交易生成完整的回测报告 */
export function buildBacktestResult(
  trades: SimulatedTrade[],
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  totalBars: number,
  initialCapital: number = 10000,
): BacktestResult {
  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const totalPnlPercent = trades.reduce((s, t) => s + t.pnlPercent, 0);

  const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length)
    : 0;

  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;
  const expectancy = totalTrades > 0
    ? winRate / 100 * avgWin - (1 - winRate / 100) * avgLoss
    : 0;

  const bestTrade = trades.length > 0 ? Math.max(...trades.map((t) => t.pnl)) : 0;
  const worstTrade = trades.length > 0 ? Math.min(...trades.map((t) => t.pnl)) : 0;

  const avgHoldingBars =
    trades.length > 0
      ? trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length
      : 0;

  const avgHoldingMinutes = trades.length > 0
    ? trades.reduce((s, t) => s + (t.exitTime - t.entryTime) / 60000, 0) / trades.length
    : 0;

  // 百分比权益曲线（用于计算最大回撤和夏普比率）
  const equityCurve: number[] = [0];
  const returns: number[] = [];
  for (const t of trades) {
    equityCurve.push(equityCurve[equityCurve.length - 1] + t.pnlPercent);
    returns.push(t.pnlPercent);
  }

  // USDT 权益曲线（基于初始资金，优先使用 pnlUsdt）
  const equityUsdtCurve: { trade: string; equity: number }[] = [];
  let usdtEq = initialCapital;
  for (let i = 0; i < trades.length; i++) {
    if (trades[i].pnlUsdt !== undefined) {
      usdtEq += trades[i].pnlUsdt!;
    } else {
      usdtEq += usdtEq * (trades[i].pnlPercent / 100);
    }
    equityUsdtCurve.push({
      trade: `#${i + 1}`,
      equity: Math.round(usdtEq * 100) / 100,
    });
  }

  const totalPnlUsdt = initialCapital > 0
    ? Math.round((equityUsdtCurve.length > 0 ? equityUsdtCurve[equityUsdtCurve.length - 1].equity - initialCapital : 0) * 100) / 100
    : 0;

  const { maxDrawdown, maxDrawdownPercent } = calcMaxDrawdown(equityCurve);
  const sharpeRatio = calcSharpeRatio(returns);
  const sortinoRatio = calcSortinoRatio(returns);

  // 年化收益率 = 总收益率 / 总时间(年)
  const totalMinutes = (endTime - startTime) / 60000;
  const years = totalMinutes / (365 * 24 * 60);
  const annualizedReturn = years > 0 ? totalPnlPercent / years : 0;
  const calmarRatio = maxDrawdownPercent > 0 ? annualizedReturn / maxDrawdownPercent : 0;

  return {
    symbol,
    interval,
    startTime,
    endTime,
    totalBars,
    trades,
    initialCapital,
    totalTrades,
    wins: wins.length,
    losses: losses.length,
    winRate,
    totalPnl,
    totalPnlPercent,
    totalPnlUsdt,
    avgPnl,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    sortinoRatio: Math.round(sortinoRatio * 100) / 100,
    calmarRatio: Math.round(calmarRatio * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPercent: Math.round(maxDrawdownPercent * 100) / 100,
    avgHoldingBars: Math.round(avgHoldingBars * 10) / 10,
    avgHoldingMinutes: Math.round(avgHoldingMinutes * 10) / 10,
    bestTrade: Math.round(bestTrade * 100) / 100,
    worstTrade: Math.round(worstTrade * 100) / 100,
    monthlyBreakdown: monthlyPnL(trades),
    equityUsdtCurve,
  };
}
