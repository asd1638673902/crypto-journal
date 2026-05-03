// 使用 localStorage 的简易数据层（原型用）
// IndexedDB 支持已就绪 — 调用 initDatabase() 自动迁移

import { migrateToIdb, isIdbAvailable, idbSaveTrades, idbSaveReviews, idbSaveStrategies, isMigrated } from './idb';

let _idbReady = false;

/** 初始化数据库：尝试从 localStorage 迁移到 IndexedDB */
export async function initDatabase(): Promise<boolean> {
  if (!isIdbAvailable()) return false;
  try {
    const already = await isMigrated();
    if (!already) {
      const { migrated } = await migrateToIdb();
      if (migrated > 0) {
        console.log(`[db] IndexedDB 迁移完成: ${migrated} 条记录`);
      }
    }
    _idbReady = true;
    return true;
  } catch (e) {
    console.warn('[db] IndexedDB 初始化失败，使用 localStorage:', e);
    return false;
  }
}

/** 数据库是否已准备好 IndexedDB */
export function isDbReady(): boolean {
  return _idbReady;
}

const STORAGE_KEYS = {
  TRADES: 'crypto-journal-trades',
  REVIEWS: 'crypto-journal-reviews',
  STRATEGIES: 'crypto-journal-strategies',
  SYNC_LOGS: 'crypto-journal-sync-logs',
};

// 生成简易唯一 ID
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

/** 批量导入交易（来自交易所同步），去重 + 保留原有数据 */
export function batchImportTrades(newTrades: Omit<Trade, 'id' | 'createdAt' | 'updatedAt'>[]): {
  imported: number;
  skipped: number;
  trades: Trade[];
} {
  const existing = getTrades();
  const existingKeys = new Set(existing.map((t) => `${t.symbol}::${t.orderId}`));
  const now = new Date().toISOString();

  let imported = 0;
  let skipped = 0;
  const fullTrades: Trade[] = [];

  for (const t of newTrades) {
    const key = `${t.symbol}::${t.orderId}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    const full: Trade = {
      ...t,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    existingKeys.add(key);
    fullTrades.push(full);
    imported++;
  }

  if (fullTrades.length > 0) {
    saveTrades([...fullTrades, ...existing]);
  }

  return { imported, skipped, trades: fullTrades };
}

/** 清除所有本地交易数据（谨慎使用） */
export function clearAllTrades(): void {
  localStorage.removeItem(STORAGE_KEYS.TRADES);
}

/** 获取同步日志 */
export function getSyncLogs(): SyncLog[] {
  const raw = localStorage.getItem(STORAGE_KEYS.SYNC_LOGS);
  return raw ? JSON.parse(raw) : [];
}

export function addSyncLog(log: Omit<SyncLog, 'id' | 'createdAt'>): SyncLog {
  const logs = getSyncLogs();
  const now = new Date().toISOString();
  const newLog: SyncLog = {
    ...log,
    id: generateId(),
    createdAt: now,
  };
  logs.push(newLog);
  localStorage.setItem(STORAGE_KEYS.SYNC_LOGS, JSON.stringify(logs));
  return newLog;
}

// ==================== Trade CRUD ====================

export function getTrades(): Trade[] {
  const raw = localStorage.getItem(STORAGE_KEYS.TRADES);
  return raw ? JSON.parse(raw) : [];
}

export function saveTrades(trades: Trade[]): void {
  localStorage.setItem(STORAGE_KEYS.TRADES, JSON.stringify(trades));
}

export function addTrade(trade: Omit<Trade, 'id' | 'createdAt' | 'updatedAt'>): Trade {
  const trades = getTrades();
  const now = new Date().toISOString();
  const newTrade: Trade = {
    ...trade,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  trades.push(newTrade);
  saveTrades(trades);
  return newTrade;
}

export function updateTrade(id: string, updates: Partial<Trade>): Trade | null {
  const trades = getTrades();
  const idx = trades.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  trades[idx] = { ...trades[idx], ...updates, updatedAt: new Date().toISOString() };
  saveTrades(trades);
  return trades[idx];
}

export function deleteTrade(id: string): boolean {
  const trades = getTrades();
  const filtered = trades.filter((t) => t.id !== id);
  if (filtered.length === trades.length) return false;
  saveTrades(filtered);
  return true;
}

export function getTradeById(id: string): Trade | undefined {
  return getTrades().find((t) => t.id === id);
}

// ==================== Review CRUD ====================

export function getReviews(): TradeReview[] {
  const raw = localStorage.getItem(STORAGE_KEYS.REVIEWS);
  return raw ? JSON.parse(raw) : [];
}

export function saveReviews(reviews: TradeReview[]): void {
  localStorage.setItem(STORAGE_KEYS.REVIEWS, JSON.stringify(reviews));
}

export function getReviewByTradeId(tradeId: string): TradeReview | undefined {
  return getReviews().find((r) => r.tradeId === tradeId);
}

export function upsertReview(review: Omit<TradeReview, 'id' | 'createdAt'>): TradeReview {
  const reviews = getReviews();
  const existingIdx = reviews.findIndex((r) => r.tradeId === review.tradeId);
  const now = new Date().toISOString();

  if (existingIdx >= 0) {
    reviews[existingIdx] = { ...reviews[existingIdx], ...review };
    saveReviews(reviews);
    return reviews[existingIdx];
  } else {
    const newReview: TradeReview = {
      ...review,
      id: generateId(),
      createdAt: now,
    };
    reviews.push(newReview);
    saveReviews(reviews);
    return newReview;
  }
}

// ==================== Strategy CRUD ====================

export function getStrategies(): Strategy[] {
  const raw = localStorage.getItem(STORAGE_KEYS.STRATEGIES);
  return raw ? JSON.parse(raw) : [];
}

export function saveStrategies(strategies: Strategy[]): void {
  localStorage.setItem(STORAGE_KEYS.STRATEGIES, JSON.stringify(strategies));
}

export function addStrategy(strategy: Omit<Strategy, 'id' | 'createdAt' | 'updatedAt'>): Strategy {
  const strategies = getStrategies();
  const now = new Date().toISOString();
  const newStrategy: Strategy = {
    ...strategy,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  strategies.push(newStrategy);
  saveStrategies(strategies);
  return newStrategy;
}

export function updateStrategy(id: string, updates: Partial<Omit<Strategy, 'id' | 'createdAt'>>): Strategy | null {
  const strategies = getStrategies();
  const idx = strategies.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  strategies[idx] = { ...strategies[idx], ...updates, updatedAt: new Date().toISOString() };
  saveStrategies(strategies);
  return strategies[idx];
}

export function deleteStrategy(id: string): boolean {
  const strategies = getStrategies();
  const filtered = strategies.filter((s) => s.id !== id);
  if (filtered.length === strategies.length) return false;
  saveStrategies(filtered);
  return true;
}

// ==================== 初始化模拟数据 ====================

export function initMockData(): void {
  const trades = getTrades();
  if (trades.length > 0) return; // 已有数据则不初始化

  const mockTrades: Omit<Trade, 'id' | 'createdAt' | 'updatedAt'>[] = [
    {
      exchange: 'binance',
      orderId: 'mock-001',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      leverage: 10,
      entryPrice: 65000,
      exitPrice: 67000,
      stopLoss: 63500,
      takeProfit: 68000,
      positionSize: 0.1,
      margin: 650,
      fee: 1.3,
      entryTime: '2026-04-28T02:15:00Z',
      exitTime: '2026-04-28T05:30:00Z',
      pnl: 170,
      pnlPercent: 26.15,
      mae: 300,
      maePercent: 0.46,
      mfe: 2200,
      mfePercent: 3.38,
      holdingSeconds: 11700,
      executionScore: 78,
      isLuckyTrade: false,
      luckyReason: undefined,
      status: 'CLOSED',
      notes: '趋势突破入场，计划执行较好',
    },
    {
      exchange: 'binance',
      orderId: 'mock-002',
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      leverage: 20,
      entryPrice: 3200,
      exitPrice: 3050,
      stopLoss: 3280,
      takeProfit: 3000,
      positionSize: 2,
      margin: 320,
      fee: 1.28,
      entryTime: '2026-04-29T10:00:00Z',
      exitTime: '2026-04-29T14:20:00Z',
      pnl: 286,
      pnlPercent: 89.4,
      mae: 120,
      maePercent: 3.75,
      mfe: 150,
      mfePercent: 4.69,
      holdingSeconds: 15600,
      executionScore: 85,
      isLuckyTrade: false,
      luckyReason: undefined,
      status: 'CLOSED',
      notes: '且战且退，出场有点早',
    },
    {
      exchange: 'binance',
      orderId: 'mock-003',
      symbol: 'SOLUSDT',
      direction: 'LONG',
      leverage: 15,
      entryPrice: 140,
      exitPrice: 145,
      stopLoss: 133,
      positionSize: 10,
      margin: 93.3,
      fee: 2.18,
      entryTime: '2026-04-30T01:00:00Z',
      exitTime: '2026-04-30T02:30:00Z',
      pnl: 35,
      pnlPercent: 37.5,
      mae: 12,     // MAE 很大！入场后跌了 $12
      maePercent: 8.57,
      mfe: 8,
      mfePercent: 5.71,
      holdingSeconds: 5400,
      executionScore: 35,
      isLuckyTrade: true, // 侥幸交易！
      luckyReason: 'MAE 达 8.57%，远超止损幅度，盈利纯属运气',
      status: 'CLOSED',
      notes: 'FOMO 追涨，入场后大幅回撤，侥幸止盈',
    },
  ];

  const now = new Date().toISOString();
  const fullMockTrades: Trade[] = mockTrades.map((t) => ({
    ...t,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  }));

  saveTrades(fullMockTrades);

  // 初始化模拟复盘
  const mockReviews: TradeReview[] = fullMockTrades.map((t) => ({
    id: generateId(),
    tradeId: t.id,
    createdAt: now,
    entryScore: t.isLuckyTrade ? 2 : 4,
    exitScore: t.isLuckyTrade ? 3 : 4,
    positionScore: 3,
    emotionScore: t.isLuckyTrade ? 2 : 4,
    planExecutionScore: t.isLuckyTrade ? 1 : 5,
    biases: t.isLuckyTrade ? ['fomo'] : [],
    errors: t.isLuckyTrade ? ['fomo', 'no_stop'] : [],
    improvementPlan: t.isLuckyTrade
      ? '严格设置止损，避免 FOMO 追涨，等待回调确认再入场'
      : '出场可以更耐心一些，让利润奔跑',
    whatWentWell: t.isLuckyTrade ? '侥幸获利' : '按计划执行',
    whatWentWrong: t.isLuckyTrade ? 'FOMO 入场，持仓过程中回撤过大' : '出场可以更好',
    lessonsLearned: '',
    emotions: t.isLuckyTrade ? ['fomo', 'greed'] : ['calm', 'confident'],
    followedPlan: !t.isLuckyTrade,
  }));

  saveReviews(mockReviews);
}

// 导入类型
import type { Trade } from './types';
import type { TradeReview } from './types';
import type { Strategy } from './types';
import type { SyncLog } from './types';
