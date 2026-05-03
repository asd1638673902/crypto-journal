// 数据类型定义

export interface Trade {
  id: string;
  createdAt: string;
  updatedAt: string;

  // 交易所关联
  exchange: string;
  orderId: string;

  // 基础信息
  symbol: string;
  direction: 'LONG' | 'SHORT';
  leverage: number;

  // 价格
  entryPrice: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;

  // 仓位
  positionSize: number; // 币的数量
  margin?: number; // 保证金 USDT
  fee: number;

  // 时间
  entryTime: string;
  exitTime?: string;

  // 计算结果
  pnl?: number;
  pnlPercent?: number;
  mae?: number; // 最大不利变动（价格）
  maePercent?: number;
  mfe?: number; // 最大有利变动（价格）
  mfePercent?: number;
  holdingSeconds?: number;

  // 评分与标记
  executionScore?: number; // 1-100
  isLuckyTrade: boolean;
  luckyReason?: string;

  // 状态
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';

  // 关联
  strategyId?: string;

  // 笔记
  notes?: string;
}

export interface TradeReview {
  id: string;
  tradeId: string;
  createdAt: string;

  // 评分 1-5
  entryScore?: number;
  exitScore?: number;
  positionScore?: number;
  emotionScore?: number;
  planExecutionScore?: number;

  // 偏差
  biases: string[]; // ['fomo', 'revenge', 'premature_exit']

  // 错误点
  errors: string[]; // ['entry_logic', 'stop_loss', 'over_position', 'emotional', 'premature_exit', 'no_stop', 'fomo', 'revenge']

  // 改进计划
  improvementPlan?: string;

  // 文字复盘
  whatWentWell?: string;
  whatWentWrong?: string;
  lessonsLearned?: string;

  // 情绪标签
  emotions: string[]; // ['fear', 'greed', 'calm', 'fomo', 'anxious', 'confident', 'frustrated']

  // 是否按计划
  followedPlan: boolean;
}

export interface Strategy {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  description?: string;
  rules?: string;
  entryConditions?: string;    // 开仓条件
  exitConditions?: string;     // 平仓条件
  riskManagement?: string;     // 风控规则
  isActive: boolean;
}

export interface SyncLog {
  id: string;
  createdAt: string;
  syncType: 'manual' | 'auto';
  status: 'success' | 'partial' | 'failed';
  tradesSynced: number;
  errorMessage?: string;
  syncDurationMs: number;
}
