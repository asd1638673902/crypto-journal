/**
 * 通知引擎
 * 定时扫描市场 → 发现突破 → 浏览器桌面通知
 */

import { scanAccumulationBreakout, type AccumulationBreakoutResult } from './marketScanner';
import { fetchKlines } from './exchange';

// ==================== 存储 ====================

const STORAGE_KEY = 'crypto-journal-notification-settings';
const HISTORY_KEY = 'crypto-journal-notification-history';

/** 通知设置 */
export interface NotificationSettings {
  enabled: boolean;
  intervalMinutes: number;    // 扫描间隔：60/240/480
  minScore: number;           // 最低评分 0-10
  minBreakoutScore: number;   // 最低突破分 0-10
  watchlist: string[];        // 关注列表（空 = 全部）
  lastSeenTokens: string[];   // 上次扫描发现的币种（用于去重）
}

/** 通知记录 */
export interface NotificationRecord {
  id: string;
  title: string;
  body: string;
  symbol: string;
  timestamp: number;
  read: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  intervalMinutes: 60,
  minScore: 5,
  minBreakoutScore: 3,
  watchlist: [],
  lastSeenTokens: [],
};

// ==================== 设置管理 ====================

export function getNotificationSettings(): NotificationSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getNotificationHistory(): NotificationRecord[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveNotificationHistory(history: NotificationRecord[]): void {
  // 只保留最近 50 条
  const trimmed = history.slice(-50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

// ==================== 浏览器通知 ====================

/** 请求通知权限 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

/** 发送桌面通知 */
export function sendBrowserNotification(title: string, body: string, options?: NotificationOptions): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'crypto-journal-alert',
      requireInteraction: true,
      ...options,
    });

    // 点击通知跳转到策略实验室
    notification.onclick = () => {
      window.focus();
      window.location.href = '/strategy-lab';
    };
  } catch (e) {
    console.warn('[通知] 发送失败:', e);
  }
}

// ==================== 扫描引擎 ====================

const POPULAR_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 'FILUSDT',
  'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'PEPEUSDT',
  'INJUSDT', 'TIAUSDT', 'SEIUSDT', 'NEARUSDT', 'FTMUSDT',
  'LTCUSDT', 'BCHUSDT', 'TRXUSDT', 'VETUSDT', 'ALGOUSDT',
];

let scanTimerId: ReturnType<typeof setInterval> | null = null;

/** 执行一次蓄势突破扫描 */
export async function runBreakoutScan(): Promise<AccumulationBreakoutResult[]> {
  const results: AccumulationBreakoutResult[] = [];
  const endTime = Date.now();
  const startTime = endTime - 60 * 24 * 60 * 60 * 1000;
  const settings = getNotificationSettings();
  const skipWatchlist = settings.watchlist.length > 0;
  const symbolsToScan = skipWatchlist ? settings.watchlist : POPULAR_SYMBOLS;

  // 分批扫描（每批 5 个并行）
  for (let i = 0; i < symbolsToScan.length; i += 5) {
    const batch = symbolsToScan.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        try {
          const klines = await fetchKlines({ symbol, interval: '1h', startTime, endTime, limit: 100 });
          if (klines.length < 50) return null;
          const result = scanAccumulationBreakout(klines, symbol);
          return result && result.score >= settings.minScore && result.breakoutScore >= settings.minBreakoutScore
            ? result : null;
        } catch { return null; }
      })
    );
    results.push(...batchResults.filter((r): r is AccumulationBreakoutResult => r !== null));
  }

  return results.sort((a, b) => b.score - a.score);
}

/** 检测新出现的突破币种并发送通知 */
export function detectAndNotify(newResults: AccumulationBreakoutResult[]): void {
  const settings = getNotificationSettings();
  if (!settings.enabled) return;

  const prevTokens = new Set(settings.lastSeenTokens);
  const newTokens = newResults.filter(r => !prevTokens.has(r.symbol));

  if (newTokens.length === 0) return;

  // 记录通知
  const history = getNotificationHistory();
  const now = Date.now();

  for (const result of newTokens) {
    const phaseLabel = result.phase === 'both' ? '蓄势突破爆发'
      : result.phase === 'accumulating' ? '蓄势中'
      : '突破中';

    const title = `🚀 ${result.symbol.replace('USDT', '')} ${phaseLabel}`;
    const body = `评分 ${result.score.toFixed(1)} | 蓄势 ${result.accumulationScore.toFixed(1)} | 突破 ${result.breakoutScore.toFixed(1)}${result.priceChange24h !== 0 ? ` | 24h ${result.priceChange24h > 0 ? '+' : ''}${result.priceChange24h.toFixed(2)}%` : ''}`;

    // 发送浏览器通知
    sendBrowserNotification(title, body);

    // 保存记录
    history.push({
      id: `${result.symbol}-${now}`,
      title,
      body,
      symbol: result.symbol,
      timestamp: now,
      read: false,
    });
  }

  saveNotificationHistory(history);

  // 更新 lastSeenTokens
  settings.lastSeenTokens = newResults.map(r => r.symbol);
  saveNotificationSettings(settings);
}

// ==================== 定时任务管理 ====================

/** 启动定时扫描 */
export function startAutoScan(): void {
  const settings = getNotificationSettings();
  if (!settings.enabled || scanTimerId) return;

  // 先请求权限
  requestNotificationPermission();

  // 立即执行一次
  runBreakoutScan().then(detectAndNotify);

  // 定时执行
  scanTimerId = setInterval(async () => {
    const currentSettings = getNotificationSettings();
    if (!currentSettings.enabled) {
      stopAutoScan();
      return;
    }
    const results = await runBreakoutScan();
    detectAndNotify(results);
  }, settings.intervalMinutes * 60 * 1000);

  console.log(`[通知] 定时扫描已启动，间隔 ${settings.intervalMinutes} 分钟`);
}

/** 停止定时扫描 */
export function stopAutoScan(): void {
  if (scanTimerId) {
    clearInterval(scanTimerId);
    scanTimerId = null;
    console.log('[通知] 定时扫描已停止');
  }
}

/** 重启定时扫描（设置变更后调用） */
export function restartAutoScan(): void {
  stopAutoScan();
  startAutoScan();
}

/** 标记通知为已读 */
export function markNotificationRead(id: string): void {
  const history = getNotificationHistory();
  const record = history.find(r => r.id === id);
  if (record) {
    record.read = true;
    saveNotificationHistory(history);
  }
}

/** 标记所有为已读 */
export function markAllNotificationsRead(): void {
  const history = getNotificationHistory();
  history.forEach(r => { r.read = true; });
  saveNotificationHistory(history);
}

/** 清空通知历史 */
export function clearNotificationHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

/** 是否已获通知权限 */
export function hasNotificationPermission(): boolean {
  return 'Notification' in window && Notification.permission === 'granted';
}
