/**
 * 技术指标计算库
 * 纯 JS 实现，无需 TA-Lib
 */

import type { KlineData } from './exchange';

/** 从 Kline 数据提取收盘价序列 */
export function closes(data: KlineData[]): number[] {
  return data.map((k) => k.close);
}

export function highs(data: KlineData[]): number[] {
  return data.map((k) => k.high);
}

export function lows(data: KlineData[]): number[] {
  return data.map((k) => k.low);
}

// ==================== SMA ====================

/** 简单移动平均 */
export function SMA(values: number[], period: number): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(undefined);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += values[j];
      }
      result.push(sum / period);
    }
  }
  return result;
}

// ==================== EMA ====================

/** 指数移动平均 */
export function EMA(values: number[], period: number): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      result.push(values[0]);
    } else if (i < period - 1) {
      result.push(undefined);
    } else if (i === period - 1) {
      // 第一个EMA用SMA
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[j];
      result.push(sum / period);
    } else {
      result.push((values[i] - result[i - 1]!) * multiplier + result[i - 1]!);
    }
  }
  return result;
}

// ==================== RSI ====================

/** 相对强弱指标 */
export function RSI(values: number[], period: number = 14): (number | undefined)[] {
  const result: (number | undefined)[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      result.push(undefined);
    } else {
      let gain = 0, loss = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const diff = values[j] - values[j - 1];
        if (diff > 0) gain += diff;
        else loss -= diff;
      }
      const avgGain = gain / period;
      const avgLoss = loss / period;
      if (avgLoss === 0) {
        result.push(100);
      } else {
        const rs = avgGain / avgLoss;
        result.push(100 - 100 / (1 + rs));
      }
    }
  }
  return result;
}

// ==================== MACD ====================

export interface MACDResult {
  macd: (number | undefined)[];
  signal: (number | undefined)[];
  histogram: (number | undefined)[];
}

/** MACD 指标 */
export function MACD(
  values: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): MACDResult {
  const fastEMA = EMA(values, fastPeriod);
  const slowEMA = EMA(values, slowPeriod);

  const macdLine: (number | undefined)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (fastEMA[i] !== undefined && slowEMA[i] !== undefined) {
      macdLine.push(fastEMA[i]! - slowEMA[i]!);
    } else {
      macdLine.push(undefined);
    }
  }

  // 对 macdLine 取 EMA 得到 signal
  const signalLine = EMA(
    macdLine.filter((v): v is number => v !== undefined),
    signalPeriod,
  );

  // 对齐信号线到原始位置
  const firstValid = macdLine.findIndex((v) => v !== undefined);
  const paddedSignal: (number | undefined)[] = [];
  let signalIdx = 0;

  for (let i = 0; i < values.length; i++) {
    if (i < firstValid + signalPeriod - 1) {
      paddedSignal.push(undefined);
    } else {
      paddedSignal.push(signalLine[firstValid + signalPeriod - 1 + signalIdx] ?? undefined);
      signalIdx++;
    }
  }

  const histogram: (number | undefined)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (macdLine[i] !== undefined && paddedSignal[i] !== undefined) {
      histogram.push(macdLine[i]! - paddedSignal[i]!);
    } else {
      histogram.push(undefined);
    }
  }

  return { macd: macdLine, signal: paddedSignal, histogram };
}

// ==================== Bollinger Bands ====================

export interface BBResult {
  upper: (number | undefined)[];
  middle: (number | undefined)[];
  lower: (number | undefined)[];
}

/** 布林带 */
export function BollingerBands(
  values: number[],
  period: number = 20,
  stdDev: number = 2,
): BBResult {
  const middle = SMA(values, period);

  const upper: (number | undefined)[] = [];
  const lower: (number | undefined)[] = [];

  for (let i = 0; i < values.length; i++) {
    if (middle[i] === undefined) {
      upper.push(undefined);
      lower.push(undefined);
    } else {
      // 计算标准差
      let sumSq = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumSq += Math.pow(values[j] - middle[i]!, 2);
      }
      const std = Math.sqrt(sumSq / period);
      upper.push(middle[i]! + stdDev * std);
      lower.push(middle[i]! - stdDev * std);
    }
  }

  return { upper, middle, lower };
}

// ==================== ATR ====================

/** 平均真实波幅 */
export function ATR(data: KlineData[], period: number = 14): (number | undefined)[] {
  const trueRanges: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      trueRanges.push(data[i].high - data[i].low);
    } else {
      const highLow = data[i].high - data[i].low;
      const highClose = Math.abs(data[i].high - data[i - 1].close);
      const lowClose = Math.abs(data[i].low - data[i - 1].close);
      trueRanges.push(Math.max(highLow, highClose, lowClose));
    }
  }

  const result: (number | undefined)[] = [];
  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period - 1) {
      result.push(undefined);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += trueRanges[j];
      result.push(sum / period);
    } else {
      result.push((trueRanges[i] + (result[i - 1] ?? 0) * (period - 1)) / period);
    }
  }
  return result;
}

// ==================== 辅助函数 ====================

export function crossAbove(values: (number | undefined)[], index: number): boolean {
  if (index < 1) return false;
  const prev = values[index - 1];
  const curr = values[index];
  if (prev === undefined || curr === undefined) return false;
  return prev <= 0 && curr > 0;
}

export function crossBelow(values: (number | undefined)[], index: number): boolean {
  if (index < 1) return false;
  const prev = values[index - 1];
  const curr = values[index];
  if (prev === undefined || curr === undefined) return false;
  return prev >= 0 && curr < 0;
}

// ==================== ADX ====================

export interface ADXResult {
  adx: (number | undefined)[];
  plusDI: (number | undefined)[];
  minusDI: (number | undefined)[];
}

/** 平均趋向指数 */
export function ADX(data: KlineData[], period: number = 14): ADXResult {
  const tr = ATR(data, period);
  const plusDM: (number | undefined)[] = [];
  const minusDM: (number | undefined)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      plusDM.push(undefined);
      minusDM.push(undefined);
    } else {
      const upMove = data[i].high - data[i - 1].high;
      const downMove = data[i - 1].low - data[i].low;
      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
  }

  const smoothedPlus = smoothedMA(plusDM, period);
  const smoothedMinus = smoothedMA(minusDM, period);

  const plusDI: (number | undefined)[] = [];
  const minusDI: (number | undefined)[] = [];
  const dx: (number | undefined)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (smoothedPlus[i] === undefined || smoothedMinus[i] === undefined || tr[i] === undefined || tr[i] === 0) {
      plusDI.push(undefined);
      minusDI.push(undefined);
      dx.push(undefined);
    } else {
      const pDI = (smoothedPlus[i]! / tr[i]!) * 100;
      const mDI = (smoothedMinus[i]! / tr[i]!) * 100;
      plusDI.push(pDI);
      minusDI.push(mDI);
      const sum = pDI + mDI;
      dx.push(sum > 0 ? Math.abs(pDI - mDI) / sum * 100 : 0);
    }
  }

  const adx = smoothedMA(dx, period);

  return { adx, plusDI, minusDI };
}

function smoothedMA(values: (number | undefined)[], period: number): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      result.push(undefined);
    } else if (i === period) {
      let sum = 0;
      for (let j = 1; j <= period; j++) sum += values[j] ?? 0;
      result.push(sum / period);
    } else {
      const prev = result[i - 1] ?? 0;
      const curr = values[i] ?? 0;
      result.push(((period - 1) * prev + curr) / period);
    }
  }
  return result;
}

// ==================== Stochastic ====================

export interface StochResult {
  k: (number | undefined)[];
  d: (number | undefined)[];
}

/** 随机指标（KDJ） */
export function Stochastic(data: KlineData[], kPeriod: number = 14, dPeriod: number = 3): StochResult {
  const rawK: (number | undefined)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < kPeriod - 1) {
      rawK.push(undefined);
    } else {
      let high = -Infinity, low = Infinity;
      for (let j = i - kPeriod + 1; j <= i; j++) {
        if (data[j].high > high) high = data[j].high;
        if (data[j].low < low) low = data[j].low;
      }
      const range = high - low;
      rawK.push(range > 0 ? ((data[i].close - low) / range) * 100 : 50);
    }
  }

  const rawD = SMA(rawK.filter((v): v is number => v !== undefined), dPeriod);

  const k: (number | undefined)[] = [];
  const d: (number | undefined)[] = [];

  let dIdx = 0;
  for (let i = 0; i < data.length; i++) {
    k.push(rawK[i]);
    if (rawK[i] !== undefined && dIdx < rawD.length) {
      d.push(rawD[dIdx]);
      dIdx++;
    } else {
      d.push(undefined);
    }
  }

  return { k, d };
}
