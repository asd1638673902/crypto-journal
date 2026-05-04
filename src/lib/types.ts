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

// ==================== V2 量化交易系统类型 ====================

/** 市场状态枚举 */
export type MarketStateType = 'TRENDING' | 'CONSOLIDATING' | 'EXPLOSIVE';

/** 市场过滤器结果 */
export interface MarketFilterResult {
  passed: boolean;
  trendStrength: { passed: boolean; score: number; reason: string };
  volatility: { passed: boolean; atrRatio: number; reason: string };
  timeWindow: { passed: boolean; currentHour: number; reason: string };
  overallScore: number; // 0-100
}

/** Edge验证结果（每个策略） */
export interface EdgeVerifierResult {
  strategyName: string;
  strategyId?: string;
  totalTrades: number;
  winRate: number;      // 0-100
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;   // 期望值（最重要）
  isAlive: boolean;     // expectancy > 0
  updatedAt: string;
}

/** 每日Edge报告 */
export interface EdgeReport {
  date: string;
  results: EdgeVerifierResult[];
  summary: {
    aliveCount: number;
    eliminatedCount: number;
    bestStrategy: string;
    worstStrategy: string;
  };
}

/** 交易质量评分（每笔潜在交易） */
export interface TradeQualityScore {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  timestamp: number;
  
  // 5维度评分
  pullbackCleanScore: number;  // 回踩干净 0-20
  structureScore: number;      // 结构清晰 0-20
  stopLossScore: number;       // 止损合理 0-20
  rrScore: number;             // 风险收益比 0-20
  timeScore: number;           // 时间窗口 0-20
  
  totalScore: number;          // 0-100
  level: 'REJECT' | 'NORMAL' | 'BOOST'; // <70 / 70-85 / ≥85
  reasons: string[];
}

/** 策略引擎类型 */
export type EngineType = 'STABLE' | 'AGGRESSIVE';

/** 风控状态 */
export interface RiskState {
  status: 'NORMAL' | 'WARNING' | 'STOPPED';
  consecutiveLosses: number;
  dailyLossPercent: number;
  maxDrawdownPercent: number;
  reason?: string;
  stoppedAt?: string;
}

/** 模拟交易指令 */
export interface SimulatedOrder {
  id: string;
  createdAt: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  engineType: EngineType;
  
  // 评分
  signalScore: number;         // 市场信号分
  qualityScore: number;        // 交易质量分
  marketState: MarketStateType;
  
  // 价格
  entryPrice: number;
  stopLoss: number;
  takeProfit: number[];
  
  // 仓位
  positionSize: number;
  positionValue: number;
  riskAmount: number;
  riskPercent: number;
  
  // 分批仓位
  batch1Qty: number; // 30%试仓
  batch2Qty: number; // 30%确认
  batch3Qty: number; // 40%趋势
  
  // 状态
  status: 'SIGNALED' | 'EXECUTED' | 'FILLED' | 'CLOSED' | 'CANCELLED';
  executedAt?: string;
  filledPrice?: number;
  exitPrice?: number;
  pnl?: number;
  
  notes?: string;
}

/** 引擎运行日志 */
export interface EngineLog {
  id: string;
  timestamp: string;
  type: 'SCAN' | 'SIGNAL' | 'FILTER' | 'QUALITY' | 'RISK' | 'ORDER' | 'EVOLVE' | 'ERROR';
  message: string;
  details?: Record<string, any>;
}
