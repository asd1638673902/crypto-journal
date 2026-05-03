/**
 * 策略脚本引擎
 * 支持用户编写 JavaScript 策略脚本，回测执行
 *
 * 用户脚本格式:
 * ```js
 * // 策略参数（可被优化器覆盖）
 * const SMA_FAST = 10;
 * const SMA_SLOW = 30;
 *
 * // 初始化（可选）
 * function init() {}
 *
 * // 每根K线调用，返回交易指令
 * function onBar(bar, { index, klines, indicators }) {
 *   // bar = { open, high, low, close, volume, time }
 *   // 返回: 'buy' | 'sell' | 'close' | null
 *   if (index > 0 && smaFast > smaSlow) return 'buy';
 *   return null;
 * }
 * ```
 */

import type { KlineData } from './exchange';
import {
  closes, highs, lows,
  SMA, EMA, RSI, MACD, BollingerBands, ATR, ADX, Stochastic,
} from './strategyIndicators';
import type { SimulatedTrade, BacktestResult } from './strategyMetrics';
import { buildBacktestResult } from './strategyMetrics';

/** 内置指标名称列表，用户脚本可直接引用 */
const BUILTIN_INDICATORS = [
  'SMA', 'EMA', 'RSI', 'MACD', 'BB', 'ATR', 'ADX', 'Stochastic',
  'closes', 'highs', 'lows',
];

/** 单K线数据（传给用户脚本） */
export interface BarData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
}

/** 脚本执行上下文 */
interface ScriptContext {
  index: number;
  klines: KlineData[];
  indicators: Record<string, any>;
}

/** 编译并执行用户策略脚本进行回测 */
export function runScriptBacktest(
  scriptCode: string,
  klines: KlineData[],
  symbol: string,
  interval: string,
  initialCapital: number = 10000,
  params?: Record<string, number>,
): { result: BacktestResult; error?: string } {
  try {
    // 预处理：替换用户定义的参数常量
    let processedCode = scriptCode;

    // 如果提供了外部参数，替换脚本中的 const 定义
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        // 替换 const NAME = xxx;
        const regex = new RegExp(`(const\\s+)(${key})\\s*=\\s*[^;]+;`, 'g');
        processedCode = processedCode.replace(regex, `$1$2 = ${value};`);
      }
    }

    // 计算所有内置指标
    const prices = closes(klines);
    const h = highs(klines);
    const l = lows(klines);
    const indicators = {
      SMA: (period: number) => SMA(prices, period),
      EMA: (period: number) => EMA(prices, period),
      RSI: (period?: number) => RSI(prices, period || 14),
      MACD: (fast?: number, slow?: number, signal?: number) => MACD(prices, fast || 12, slow || 26, signal || 9),
      BB: (period?: number, std?: number) => BollingerBands(prices, period || 20, std || 2),
      ATR: (period?: number) => ATR(klines, period || 14),
      ADX: (period?: number) => ADX(klines, period || 14),
      Stochastic: (kPeriod?: number, dPeriod?: number) => Stochastic(klines, kPeriod || 14, dPeriod || 3),
    };

    // 构建用户脚本可访问的全局环境
    const sandboxCode = `
      const SMA = (p) => indicators.SMA(p);
      const EMA = (p) => indicators.EMA(p);
      const RSI = (p) => indicators.RSI(p);
      const MACD = (f, s, sig) => indicators.MACD(f, s, sig);
      const BB = (p, std) => indicators.BB(p, std);
      const ATR = (p) => indicators.ATR(p);
      const ADX = (p) => indicators.ADX(p);
      const Stochastic = (k, d) => indicators.Stochastic(k, d);
      const Math = window.Math;
      const JSON = window.JSON;
      const isNaN = window.isNaN;
      const parseFloat = window.parseFloat;
      const parseInt = window.parseInt;

      ${processedCode}

      // 执行策略
      const __trades__ = [];
      let __position__ = null;
      let __entryPrice__ = 0;

      for (let i = 0; i < klines.length; i++) {
        const bar = klines[i];
        const ctx = { index: i, klines, indicators };

        if (!__position__) {
          const signal = (typeof shouldEnter === 'function')
            ? shouldEnter(bar, ctx)
            : (typeof onBar === 'function')
              ? onBar(bar, ctx)
              : null;

          if (signal === 'buy' || signal === 'short') {
            __position__ = signal;
            __entryPrice__ = bar.close;
            __position__index = i;
          }
        } else {
          const signal = (typeof shouldExit === 'function')
            ? shouldExit(bar, ctx, { entryPrice: __entryPrice__, direction: __position__ })
            : (typeof onBar === 'function')
              ? onBar(bar, ctx)
              : null;

          const shouldClose = signal === 'close' || signal === 'sell'
            || (__position__ === 'buy' && signal === 'sell')
            || (__position__ === 'short' && signal === 'buy');

          if (shouldClose) {
            const pnl = __position__ === 'buy'
              ? (bar.close - __entryPrice__)
              : (__entryPrice__ - bar.close);
            const pnlPct = __entryPrice__ > 0 ? (pnl / __entryPrice__) * 100 : 0;

            __trades__.push({
              entryIndex: __position__index,
              exitIndex: i,
              entryTime: klines[__position__index].time,
              exitTime: bar.time,
              entryPrice: __entryPrice__,
              exitPrice: bar.close,
              direction: __position__ === 'buy' ? 'LONG' : 'SHORT',
              pnl: Math.round(pnl * 100) / 100,
              pnlPercent: Math.round(pnlPct * 100) / 100,
              holdingBars: i - __position__index,
              exitReason: 'signal',
            });
            __position__ = null;
          }
        }
      }
      __trades__;
    `;

    // 执行
    const fn = new Function('klines', 'indicators', sandboxCode);
    const trades: SimulatedTrade[] = fn(klines.map((k, i) => ({
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
      time: k.time,
    })), indicators);

    const result = buildBacktestResult(
      trades || [],
      symbol,
      interval,
      klines[0].time,
      klines[klines.length - 1].time,
      klines.length,
      initialCapital,
    );

    return { result };
  } catch (err: any) {
    return { result: buildBacktestResult([], symbol, interval, 0, 0, 0, initialCapital), error: err.message };
  }
}

/** 验证脚本语法 */
export function validateScript(code: string): string | null {
  try {
    new Function(code);
    return null;
  } catch (err: any) {
    return err.message;
  }
}

/** 获取示例脚本 */
export function getExampleScripts(): { name: string; code: string }[] {
  return [
    {
      name: 'SMA 金叉策略',
      code: `// SMA 金叉策略
// 快线上穿慢线时买入，下穿时卖出
const SMA_FAST = 10;
const SMA_SLOW = 30;

function onBar(bar, ctx) {
  const { index, indicators } = ctx;
  if (index < 1) return null;

  const fast = SMA(SMA_FAST);
  const slow = SMA(SMA_SLOW);

  const prevFast = fast[index - 1];
  const prevSlow = slow[index - 1];
  const currFast = fast[index];
  const currSlow = slow[index];

  if (prevFast === undefined || prevSlow === undefined ||
      currFast === undefined || currSlow === undefined) return null;

  // 金叉买入
  if (prevFast <= prevSlow && currFast > currSlow) return 'buy';
  // 死叉卖出
  if (prevFast >= prevSlow && currFast < currSlow) return 'close';

  return null;
}`,
    },
    {
      name: 'RSI 超卖反弹策略',
      code: `// RSI 超卖反弹策略
// RSI 低于超卖阈值时买入，高于超买阈值时卖出
const RSI_PERIOD = 14;
const OVERSOLD = 30;
const OVERBOUGHT = 70;

function onBar(bar, ctx) {
  const { index } = ctx;
  const rsi = RSI(RSI_PERIOD);

  if (rsi[index] === undefined || rsi[index - 1] === undefined) return null;

  // RSI 从超卖区反弹买入
  if (rsi[index - 1] <= OVERSOLD && rsi[index] > OVERSOLD) return 'buy';
  // RSI 进入超买区卖出
  if (rsi[index] >= OVERBOUGHT) return 'close';

  return null;
}`,
    },
    {
      name: '布林带反弹策略',
      code: `// 布林带反弹策略
// 价格触及下轨买入，触及上轨卖出
const BB_PERIOD = 20;
const BB_STD = 2;

function onBar(bar, ctx) {
  const { index } = ctx;
  const bb = BB(BB_PERIOD, BB_STD);

  if (bb.lower[index] === undefined || bb.upper[index] === undefined) return null;

  // 价格触及下轨买入
  if (bar.close <= bb.lower[index]) return 'buy';
  // 价格触及上轨卖出
  if (bar.close >= bb.upper[index]) return 'close';

  return null;
}`,
    },
    {
      name: 'MACD 金叉策略',
      code: `// MACD 金叉策略
// MACD 柱状图由负转正买入，由正转负卖出
function onBar(bar, ctx) {
  const { index } = ctx;
  const macd = MACD(12, 26, 9);

  if (macd.histogram[index] === undefined ||
      macd.histogram[index - 1] === undefined) return null;

  // 柱状图由负转正
  if (macd.histogram[index - 1] <= 0 && macd.histogram[index] > 0) return 'buy';
  // 柱状图由正转负
  if (macd.histogram[index - 1] >= 0 && macd.histogram[index] < 0) return 'close';

  return null;
}`,
    },
    {
      name: '自定义多信号策略',
      code: `// 自定义多信号策略
// 组合多种条件：SMA趋势 + RSI + 成交量确认
const SMA_FAST = 20;
const SMA_SLOW = 50;
const RSI_PERIOD = 14;

const STOP_LOSS_PCT = 3;    // 止损 3%
const TAKE_PROFIT_PCT = 6;  // 止盈 6%

let entryPrice = 0;

function shouldEnter(bar, ctx) {
  const { index } = ctx;
  const fast = SMA(SMA_FAST);
  const slow = SMA(SMA_SLOW);
  const rsi = RSI(RSI_PERIOD);

  if (fast[index] === undefined || slow[index] === undefined) return null;

  // 条件：快线 > 慢线 + RSI > 50 + 放量
  const trendUp = fast[index] > slow[index];
  const rsiOk = rsi[index] > 50;
  const volumeOk = bar.volume > 1000;

  if (trendUp && rsiOk && volumeOk) {
    entryPrice = bar.close;
    return 'buy';
  }
  return null;
}

function shouldExit(bar, ctx, pos) {
  // 止损
  if (bar.close <= pos.entryPrice * (1 - STOP_LOSS_PCT / 100)) return 'close';
  // 止盈
  if (bar.close >= pos.entryPrice * (1 + TAKE_PROFIT_PCT / 100)) return 'close';

  // 趋势反转
  const slow = SMA(SMA_SLOW);
  if (slow[ctx.index] !== undefined && bar.close < slow[ctx.index]) return 'close';

  return null;
}`,
    },
    {
      name: '海龟交易法则',
      code: `// 海龟交易法则（简化版）
// 突破 N 日高点买入，跌破 N 日低点卖出
const ENTRY_PERIOD = 20;
const EXIT_PERIOD = 10;
const ATR_PERIOD = 14;
const ATR_MULTIPLIER = 2;

function onBar(bar, ctx) {
  const { index, klines } = ctx;
  if (index < ENTRY_PERIOD) return null;

  const atr = ATR(ATR_PERIOD);
  const atrVal = atr[index];
  if (atrVal === undefined) return null;

  const lookback = klines.slice(index - ENTRY_PERIOD + 1, index + 1);
  const hh = Math.max(...lookback.map(k => k.high));
  const ll = Math.min(...lookback.map(k => k.low));

  if (bar.close >= hh) return 'buy';
  if (bar.close <= ll) return 'close';

  return null;
}

function shouldExit(bar, ctx, pos) {
  const { index } = ctx;
  const atr = ATR(ATR_PERIOD);
  const atrVal = atr[index];
  if (atrVal === undefined) return null;

  const stopDist = atrVal * ATR_MULTIPLIER;
  if (pos.direction === 'buy' && bar.close <= pos.entryPrice - stopDist) return 'close';
  if (pos.direction === 'short' && bar.close >= pos.entryPrice + stopDist) return 'close';

  return null;
}`,
    },
    {
      name: 'ADX 趋势跟踪',
      code: `// ADX 趋势跟踪策略
// ADX > 25 确认趋势，DI方向判断多空
const ADX_PERIOD = 14;
const ADX_THRESHOLD = 25;

function onBar(bar, ctx) {
  const { index, klines } = ctx;
  if (index < ADX_PERIOD + 1) return null;

  const adx = ADX(ADX_PERIOD);
  if (adx[index] === undefined || adx[index] < ADX_THRESHOLD) return null;

  const prevBar = klines[index - 1];
  if (bar.close > prevBar.close && bar.high > prevBar.high) return 'buy';
  if (bar.close < prevBar.close && bar.low < prevBar.low) return 'short';

  return null;
}`,
    },
    {
      name: 'Stochastic 超买超卖',
      code: `// 随机指标超买超卖策略
// %K 上穿 20 买入，下穿 80 卖出
const K_PERIOD = 14;
const D_PERIOD = 3;
const OVERSOLD = 20;
const OVERBOUGHT = 80;

function onBar(bar, ctx) {
  const { index } = ctx;
  if (index < K_PERIOD + 1) return null;

  const stoch = Stochastic(K_PERIOD, D_PERIOD);
  const k = stoch.k[index];
  const prevK = stoch.k[index - 1];
  if (k === undefined || prevK === undefined) return null;

  if (prevK <= OVERSOLD && k > OVERSOLD) return 'buy';
  if (prevK >= OVERBOUGHT && k < OVERBOUGHT) return 'close';

  return null;
}`,
    },
    {
      name: '网格交易策略',
      code: `// 网格交易策略
// 在价格区间内设置 N 层网格，低买高卖
const GRID_TOP = 70000;
const GRID_BOTTOM = 60000;
const GRID_LEVELS = 10;
const GRID_SIZE = (GRID_TOP - GRID_BOTTOM) / GRID_LEVELS;

let gridOrders = [];
let lastPrice = 0;

function onBar(bar, ctx) {
  const price = bar.close;
  if (gridOrders.length === 0) {
    for (let i = 0; i < GRID_LEVELS; i++) {
      const gp = GRID_BOTTOM + i * GRID_SIZE + GRID_SIZE / 2;
      gridOrders.push({ price: gp, hasPosition: price < gp });
    }
  }

  const minP = Math.min(price, lastPrice || price);
  const maxP = Math.max(price, lastPrice || price);

  for (const g of gridOrders) {
    if (g.hasPosition && maxP >= g.price && (lastPrice || price) < g.price) {
      g.hasPosition = false;
      lastPrice = price;
      return 'sell';
    }
    if (!g.hasPosition && minP <= g.price && (lastPrice || price) > g.price) {
      g.hasPosition = true;
      lastPrice = price;
      return 'buy';
    }
  }

  lastPrice = price;
  return null;
}`,
    },
  ];
}
