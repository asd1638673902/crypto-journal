/**
 * 策略参数优化器 — 网格搜索
 * 对标 Freqtrade Hyperopt 的简化版
 */

import type { KlineData } from './exchange';
import type { BacktestConfig } from './backtest';
import { runBacktest } from './backtest';
import type { BacktestResult } from './strategyMetrics';

/** 参数范围定义 */
export interface ParamRange {
  param: string;
  values: number[];
}

/** 优化目标 */
export type OptimizeTarget =
  | 'sharpeRatio'
  | 'profitFactor'
  | 'totalPnlPercent'
  | 'winRate';

/** 单次优化结果 */
export interface OptimizeResult {
  params: Record<string, number>;
  metrics: BacktestResult;
  rank: number;
}

const TARGET_LABELS: Record<OptimizeTarget, string> = {
  sharpeRatio: '夏普比率',
  profitFactor: '盈亏比',
  totalPnlPercent: '总收益率',
  winRate: '胜率',
};

export function getTargetLabel(t: OptimizeTarget): string {
  return TARGET_LABELS[t];
}

export { OptimizeTarget };

/**
 * 网格搜索优化
 * @param klines K线数据
 * @param baseConfig 基础策略配置（不含要优化的参数值）
 * @param paramRanges 要优化的参数及取值范围
 * @param target 优化目标
 * @param maxResults 最多返回结果数
 */
export function gridSearch(
  klines: KlineData[],
  baseConfig: Omit<BacktestConfig, 'entryRules' | 'exitRules'>,
  paramRanges: ParamRange[],
  target: OptimizeTarget = 'sharpeRatio',
  maxResults: number = 20,
): OptimizeResult[] {
  // 生成所有参数组合
  const combinations = generateCombinations(paramRanges);
  const results: OptimizeResult[] = [];

  for (const params of combinations) {
    const config: BacktestConfig = {
      ...baseConfig,
      entryRules: {
        type: 'SMA_CROSS',
        params: {
          smaFast: params.smaFast || 10,
          smaSlow: params.smaSlow || 30,
          rsiPeriod: params.rsiPeriod || 14,
          rsiThreshold: params.rsiThreshold || 30,
          macdFast: params.macdFast || 12,
          macdSlow: params.macdSlow || 26,
          macdSignal: params.macdSignal || 9,
        },
      },
      exitRules: {
        type: 'FIXED_STOP',
        params: {},
      },
      stopLossPercent: params.stopLossPercent as number | undefined,
      takeProfitPercent: params.takeProfitPercent as number | undefined,
    };

    try {
      const result = runBacktest(klines, config);
      results.push({ params, metrics: result, rank: 0 });
    } catch {
      // 忽略失败的回测
    }
  }

  // 按目标排序
  results.sort((a, b) => {
    const va = a.metrics[target];
    const vb = b.metrics[target];
    // 对于 Infinity，排名在最后
    if (va === Infinity || isNaN(va)) return 1;
    if (vb === Infinity || isNaN(vb)) return -1;
    return vb - va;
  });

  // 标注排名
  results.forEach((r, i) => {
    r.rank = i + 1;
  });

  return results.slice(0, maxResults);
}

/** 生成所有参数组合（笛卡尔积） */
function generateCombinations(ranges: ParamRange[]): Record<string, number>[] {
  if (ranges.length === 0) return [{}];

  const [first, ...rest] = ranges;
  const subCombos = generateCombinations(rest);
  const result: Record<string, number>[] = [];

  for (const val of first.values) {
    for (const combo of subCombos) {
      result.push({ ...combo, [first.param]: val });
    }
  }

  return result;
}
