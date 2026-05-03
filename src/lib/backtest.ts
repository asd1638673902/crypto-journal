/**
 * 策略回测引擎
 * 在历史K线数据上模拟策略交易
 */

import type { KlineData } from './exchange';
import {
  closes, highs, lows,
  SMA, EMA, RSI, MACD, BollingerBands, ATR, crossAbove, crossBelow,
} from './strategyIndicators';
import type { SimulatedTrade, BacktestResult } from './strategyMetrics';
import { buildBacktestResult } from './strategyMetrics';
import { calcPositionSize } from './riskManager';

/** 回测风险配置 */
export interface BacktestRiskConfig {
  /** 每笔交易风险占当前权益的比例（%），如 1 = 1% */
  riskPerTradePercent: number;
  /** 杠杆倍数 */
  leverage?: number;
  /** 最大同时持仓数 */
  maxPositions?: number;
}

/** 回测策略配置 */
export interface BacktestConfig {
  symbol: string;
  interval: string;

  // 入场规则
  entryRules: {
    type: 'SMA_CROSS' | 'RSI_OVERSOLD' | 'MACD_CROSS' | 'BB_BOUNCE' | 'CUSTOM';
    params: Record<string, number>;
  };

  // 出场规则
  exitRules: {
    type: 'TARGET_PROFIT' | 'TRAILING_STOP' | 'FIXED_STOP' | 'CUSTOM';
    params: Record<string, number>;
  };

  // 止损
  stopLossPercent?: number;  // e.g. 2 = 2%
  takeProfitPercent?: number; // e.g. 4 = 4%

  // 方向
  direction: 'LONG' | 'SHORT' | 'BOTH';

  // 风控配置（可选）
  riskConfig?: BacktestRiskConfig;
}

/** 模拟期间持有仓位信息 */
interface Position {
  entryIndex: number;
  entryPrice: number;
  entryTime: number;
  direction: 'LONG' | 'SHORT';
  quantity: number;       // 持仓数量（币）
  positionValue: number;  // 仓位价值（USDT）
  stopPrice?: number;     // 实际止损价
}

/**
 * 运行回测
 * @param klines 历史K线数据（需按时间升序排列）
 * @param config 策略配置
 * @param initialCapital 初始资金（USDT），用于计算 USDT 盈亏和仓位
 * @returns 回测结果
 */
export function runBacktest(klines: KlineData[], config: BacktestConfig, initialCapital: number = 10000): BacktestResult {
  const prices = closes(klines);
  const _highs = highs(klines);
  const _lows = lows(klines);
  const n = klines.length;

  // 计算所有技术指标
  const smaFast = SMA(prices, config.entryRules.params.smaFast || 10);
  const smaSlow = SMA(prices, config.entryRules.params.smaSlow || 30);
  const rsi = RSI(prices, config.entryRules.params.rsiPeriod || 14);
  const macd = MACD(
    prices,
    config.entryRules.params.macdFast || 12,
    config.entryRules.params.macdSlow || 26,
    config.entryRules.params.macdSignal || 9,
  );
  const bb = BollingerBands(prices, config.entryRules.params.bbPeriod || 20, config.entryRules.params.bbStd || 2);
  const atr = ATR(klines, 14);

  const trades: SimulatedTrade[] = [];
  let position: Position | null = null;
  let currentEquity = initialCapital;
  let openPositions = 0;

  const maxPositions = config.riskConfig?.maxPositions ?? 1;

  const stopLossPrice = config.stopLossPercent
    ? (price: number, dir: 'LONG' | 'SHORT') =>
        dir === 'LONG'
          ? price * (1 - config.stopLossPercent! / 100)
          : price * (1 + config.stopLossPercent! / 100)
    : null;

  const takeProfitPrice = config.takeProfitPercent
    ? (price: number, dir: 'LONG' | 'SHORT') =>
        dir === 'LONG'
          ? price * (1 + config.takeProfitPercent! / 100)
          : price * (1 - config.takeProfitPercent! / 100)
    : null;

  // 检查入场信号
  function shouldEnter(i: number): boolean {
    const rule = config.entryRules.type;
    switch (rule) {
      case 'SMA_CROSS':
        return smaFast[i] !== undefined && smaSlow[i] !== undefined &&
               smaFast[i - 1] !== undefined && smaSlow[i - 1] !== undefined &&
               smaFast[i - 1]! <= smaSlow[i - 1]! && smaFast[i]! > smaSlow[i]!;

      case 'RSI_OVERSOLD':
        return rsi[i] !== undefined && rsi[i]! < (config.entryRules.params.rsiThreshold || 30);

      case 'MACD_CROSS':
        return macd.histogram[i] !== undefined && macd.histogram[i - 1] !== undefined &&
               macd.histogram[i - 1]! <= 0 && macd.histogram[i]! > 0;

      case 'BB_BOUNCE':
        return bb.lower[i] !== undefined && prices[i] <= bb.lower[i]!;

      default:
        return false;
    }
  }

  function shouldExit(i: number): { exit: boolean; reason: 'signal' | 'stop_loss' | 'take_profit' } {
    if (!position) return { exit: false, reason: 'signal' };

    // 止损检查
    if (stopLossPrice) {
      const sl = stopLossPrice(position.entryPrice, position.direction);
      if (position.direction === 'LONG' && _lows[i] <= sl) {
        return { exit: true, reason: 'stop_loss' };
      }
      if (position.direction === 'SHORT' && _highs[i] >= sl) {
        return { exit: true, reason: 'stop_loss' };
      }
    }

    // 止盈检查
    if (takeProfitPrice) {
      const tp = takeProfitPrice(position.entryPrice, position.direction);
      if (position.direction === 'LONG' && _highs[i] >= tp) {
        return { exit: true, reason: 'take_profit' };
      }
      if (position.direction === 'SHORT' && _lows[i] <= tp) {
        return { exit: true, reason: 'take_profit' };
      }
    }

    // 出场信号
    const rule = config.exitRules.type;
    switch (rule) {
      case 'FIXED_STOP':
        // 由止损处理
        return { exit: false, reason: 'signal' };

      case 'TARGET_PROFIT':
        // 由止盈处理
        return { exit: false, reason: 'signal' };

      default:
        return { exit: false, reason: 'signal' };
    }
  }

  // 逐K线扫描
  for (let i = 1; i < n; i++) {
    if (!position) {
      // 检测入场
      const entryDir: 'LONG' | 'SHORT' = config.direction === 'BOTH'
        ? 'LONG'  // 简化处理
        : config.direction;

      if (shouldEnter(i)) {
        // 计算仓位大小
        let quantity = 1; // 默认：1 单位（无风控时）
        let positionValue = prices[i];
        let stopPrice: number | undefined;

        if (config.riskConfig && config.stopLossPercent) {
          const sl = stopLossPrice!(prices[i], entryDir);
          stopPrice = sl;
          const psResult = calcPositionSize(
            currentEquity,
            prices[i],
            sl,
            config.riskConfig.riskPerTradePercent,
            config.riskConfig.leverage || 1,
          );
          if (psResult) {
            quantity = psResult.positionSize;
            positionValue = psResult.positionValue;
          }
        }

        position = {
          entryIndex: i,
          entryPrice: prices[i],
          entryTime: klines[i].time,
          direction: entryDir,
          quantity,
          positionValue,
          stopPrice,
        };
        openPositions++;
      }
    } else {
      // 检测出场
      const { exit, reason } = shouldExit(i);
      if (exit) {
        const exitPrice = reason === 'stop_loss'
          ? (position.direction === 'LONG'
              ? Math.max(prices[i], stopLossPrice!(position.entryPrice, position.direction))
              : Math.min(prices[i], stopLossPrice!(position.entryPrice, position.direction)))
          : reason === 'take_profit'
            ? (position.direction === 'LONG'
                ? Math.min(prices[i], takeProfitPrice!(position.entryPrice, position.direction))
                : Math.max(prices[i], takeProfitPrice!(position.entryPrice, position.direction)))
            : prices[i];

        const pnl = position.direction === 'LONG'
          ? (exitPrice - position.entryPrice)
          : (position.entryPrice - exitPrice);

        const pnlPercent = position.entryPrice > 0
          ? (pnl / position.entryPrice) * 100
          : 0;

        // USDT PnL = 每单位盈亏 × 持仓数量
        const pnlUsdt = pnl * position.quantity;

        // 更新当前权益
        currentEquity += pnlUsdt;

        trades.push({
          entryIndex: position.entryIndex,
          exitIndex: i,
          entryTime: position.entryTime,
          exitTime: klines[i].time,
          entryPrice: position.entryPrice,
          exitPrice,
          direction: position.direction,
          pnl: Math.round(pnl * 100) / 100,
          pnlPercent: Math.round(pnlPercent * 100) / 100,
          holdingBars: i - position.entryIndex,
          exitReason: reason,
          positionSize: Math.round(position.quantity * 10000) / 10000,
          positionValue: Math.round(position.positionValue * 100) / 100,
          pnlUsdt: Math.round(pnlUsdt * 100) / 100,
        });

        position = null;
      }
    }
  }

  // 如果最后还有持仓，强制平仓
  if (position) {
    const lastK = klines[n - 1];
    const pnl = position.direction === 'LONG'
      ? (lastK.close - position.entryPrice)
      : (position.entryPrice - lastK.close);
    const pnlPercent = position.entryPrice > 0 ? (pnl / position.entryPrice) * 100 : 0;
    const pnlUsdt = pnl * position.quantity;
    currentEquity += pnlUsdt;

    trades.push({
      entryIndex: position.entryIndex,
      exitIndex: n - 1,
      entryTime: position.entryTime,
      exitTime: lastK.time,
      entryPrice: position.entryPrice,
      exitPrice: lastK.close,
      direction: position.direction,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round(pnlPercent * 100) / 100,
      holdingBars: n - 1 - position.entryIndex,
      exitReason: 'signal',
      positionSize: Math.round(position.quantity * 10000) / 10000,
      positionValue: Math.round(position.positionValue * 100) / 100,
      pnlUsdt: Math.round(pnlUsdt * 100) / 100,
    });
  }

  return buildBacktestResult(
    trades,
    config.symbol,
    config.interval,
    klines[0].time,
    klines[n - 1].time,
    n,
    initialCapital,
  );
}
