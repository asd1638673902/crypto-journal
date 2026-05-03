/**
 * IndexedDB 数据层
 * 替换 localStorage，支持大数据量存储
 * 保持与原有 db.ts API 兼容
 */

const DB_NAME = 'crypto-journal-db';
const DB_VERSION = 1;

/** 数据库存储名称 */
const STORE_NAMES = ['trades', 'reviews', 'strategies', 'syncLogs', 'backtestResults'] as const;
type StoreName = typeof STORE_NAMES[number];

// 内存缓存（读取后缓存，写入时同步更新）
const memoryCache = new Map<StoreName, any[]>();

// 连接池
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function getAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => {
      const data = request.result as T[];
      memoryCache.set(storeName, data);
      resolve(data);
    };
    request.onerror = () => reject(request.error);
  });
}

async function putAll<T extends { id: string }>(storeName: StoreName, items: T[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => {
      memoryCache.set(storeName, items);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteItem(storeName: StoreName, id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(id);
    tx.oncomplete = () => {
      const cached = memoryCache.get(storeName);
      if (cached) {
        memoryCache.set(storeName, cached.filter((item: any) => item.id !== id));
      }
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// ==================== 公开 API ====================

/** 获取所有交易记录 */
export async function idbGetTrades<T = any>(): Promise<T[]> {
  return getAll<T>('trades');
}

/** 批量保存交易记录 */
export async function idbSaveTrades<T extends { id: string }>(trades: T[]): Promise<void> {
  return putAll('trades', trades);
}

/** 获取所有复盘记录 */
export async function idbGetReviews<T = any>(): Promise<T[]> {
  return getAll<T>('reviews');
}

/** 批量保存复盘记录 */
export async function idbSaveReviews<T extends { id: string }>(reviews: T[]): Promise<void> {
  return putAll('reviews', reviews);
}

/** 获取所有策略 */
export async function idbGetStrategies<T = any>(): Promise<T[]> {
  return getAll<T>('strategies');
}

/** 批量保存策略 */
export async function idbSaveStrategies<T extends { id: string }>(strategies: T[]): Promise<void> {
  return putAll('strategies', strategies);
}

/** 删除单条记录 */
export async function idbDeleteItem(storeName: string, id: string): Promise<void> {
  return deleteItem(storeName as StoreName, id);
}

/** 获取回测结果历史 */
export async function idbGetBacktestResults<T = any>(): Promise<T[]> {
  return getAll<T>('backtestResults');
}

/** 保存回测结果 */
export async function idbSaveBacktestResult<T extends { id: string }>(result: T): Promise<void> {
  const results = await getAll<T>('backtestResults');
  const existingIdx = results.findIndex((r) => r.id === result.id);
  if (existingIdx >= 0) {
    results[existingIdx] = result;
  } else {
    results.push(result);
  }
  return putAll('backtestResults', results);
}

/** 从 localStorage 迁移数据到 IndexedDB */
export async function migrateToIdb(): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0;
  let skipped = 0;

  const migrations: { key: string; storeName: StoreName; getter: () => any[]; save: (data: any[]) => Promise<void> }[] = [
    {
      key: 'crypto-journal-trades',
      storeName: 'trades',
      getter: () => { const r = localStorage.getItem('crypto-journal-trades'); return r ? JSON.parse(r) : []; },
      save: async (d) => putAll('trades', d),
    },
    {
      key: 'crypto-journal-reviews',
      storeName: 'reviews',
      getter: () => { const r = localStorage.getItem('crypto-journal-reviews'); return r ? JSON.parse(r) : []; },
      save: async (d) => putAll('reviews', d),
    },
    {
      key: 'crypto-journal-strategies',
      storeName: 'strategies',
      getter: () => { const r = localStorage.getItem('crypto-journal-strategies'); return r ? JSON.parse(r) : []; },
      save: async (d) => putAll('strategies', d),
    },
    {
      key: 'crypto-journal-sync-logs',
      storeName: 'syncLogs',
      getter: () => { const r = localStorage.getItem('crypto-journal-sync-logs'); return r ? JSON.parse(r) : []; },
      save: async (d) => putAll('syncLogs', d),
    },
  ];

  for (const m of migrations) {
    const lsData = m.getter();
    if (lsData.length === 0) { skipped++; continue; }
    try {
      const idbData = await getAll(m.storeName);
      if (idbData.length >= lsData.length) {
        skipped++;
        continue;
      }
      await m.save(lsData);
      migrated += lsData.length;
    } catch (e) {
      console.warn(`迁移 ${m.key} 失败:`, e);
      skipped++;
    }
  }

  return { migrated, skipped };
}

/** 检查 IndexedDB 是否可用 */
export function isIdbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** 检查是否已完成迁移 */
export async function isMigrated(): Promise<boolean> {
  try {
    const db = await openDB();
    return db.objectStoreNames.length > 0;
  } catch {
    return false;
  }
}
