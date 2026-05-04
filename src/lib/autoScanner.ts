/**
 * 自动扫描调度器 — 定时执行完整交易循环
 *
 * 基于 tradingEngine.runFullScan() 定时调度
 */

import { runFullScan, getEngineSettings } from './tradingEngine';

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _isRunning = false;

/**
 * 启动自动扫描
 */
export function startAutoTrading(): void {
  if (_intervalId) return; // 已在运行

  const settings = getEngineSettings();
  if (!settings.enabled) return;

  const intervalMs = settings.scanInterval * 60 * 1000;

  // 立即执行一次
  runFullScan().catch((err) => console.warn('[autoScanner] 首次扫描失败:', err));

  // 定时执行
  _intervalId = setInterval(async () => {
    if (_isRunning) return; // 上次还没跑完
    _isRunning = true;
    try {
      await runFullScan();
    } catch (err) {
      console.warn('[autoScanner] 扫描失败:', err);
    } finally {
      _isRunning = false;
    }
  }, intervalMs);

  console.log(`[autoScanner] 自动交易已启动，间隔 ${settings.scanInterval} 分钟`);
}

/**
 * 停止自动扫描
 */
export function stopAutoTrading(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _isRunning = false;
  console.log('[autoScanner] 自动交易已停止');
}

/**
 * 检查是否在运行
 */
export function isAutoTradingRunning(): boolean {
  return _intervalId !== null;
}

/**
 * 重启自动扫描（设置变更后调用）
 */
export function restartAutoTrading(): void {
  stopAutoTrading();
  const settings = getEngineSettings();
  if (settings.enabled) {
    startAutoTrading();
  }
}
