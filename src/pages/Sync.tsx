import { useState, useEffect, useCallback } from 'react';
import {
  saveApiKey,
  getApiKey,
  clearApiKey,
  testConnection,
  syncFromBinance,
} from '../lib/exchange';
import { batchImportTrades, getTrades, getSyncLogs, addSyncLog } from '../lib/db';
import type { Trade, SyncLog } from '../lib/types';
import './Sync.css';

type SyncStep = 'idle' | 'testing' | 'syncing' | 'done' | 'error';

export default function Sync() {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [hasSavedKeys, setHasSavedKeys] = useState(false);
  const [syncDays, setSyncDays] = useState(7);

  // 状态
  const [step, setStep] = useState<SyncStep>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [connectionInfo, setConnectionInfo] = useState<{
    balances?: { asset: string; balance: number }[];
    positions?: { symbol: string; size: number; entryPrice: number }[];
  } | null>(null);

  const [syncedTrades, setSyncedTrades] = useState<Trade[]>([]);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);

  // 加载已有配置和日志
  useEffect(() => {
    const saved = getApiKey();
    if (saved) {
      setApiKey(saved.apiKey);
      setApiSecret(saved.apiSecret);
      setHasSavedKeys(true);
    }
    setSyncLogs(getSyncLogs().reverse().slice(0, 10));
    setAllTrades(getTrades());
  }, []);

  // 测试连接
  const handleTestConnection = useCallback(async () => {
    if (!apiKey || !apiSecret) {
      setStatusMsg('请先输入 API Key 和 API Secret');
      return;
    }
    setStep('testing');
    setStatusMsg('正在测试连接...');
    setConnectionInfo(null);

    // 临时保存以便测试
    saveApiKey(apiKey, apiSecret);

    const result = await testConnection();
    if (result.success) {
      setStep('idle');
      setStatusMsg(`✅ ${result.message}`);
      if (result.balances && result.balances.length > 0) {
        setConnectionInfo({
          balances: result.balances,
          positions: result.positions,
        });
      }
    } else {
      setStep('error');
      setStatusMsg(`❌ 连接失败: ${result.message}`);
    }
  }, [apiKey, apiSecret]);

  // 保存密钥
  const handleSaveKeys = () => {
    if (!apiKey || !apiSecret) {
      setStatusMsg('请完整填写 API Key 和 API Secret');
      return;
    }
    saveApiKey(apiKey, apiSecret);
    setHasSavedKeys(true);
    setStatusMsg('✅ API 密钥已保存');
    // 自动测试连接
    handleTestConnection();
  };

  // 清除密钥
  const handleClearKeys = () => {
    clearApiKey();
    setApiKey('');
    setApiSecret('');
    setHasSavedKeys(false);
    setConnectionInfo(null);
    setStatusMsg('API 密钥已清除');
  };

  // 一键同步
  const handleSync = useCallback(async () => {
    const saved = getApiKey();
    if (!saved) {
      setStatusMsg('请先配置并保存 API 密钥');
      return;
    }

    setStep('syncing');
    setStatusMsg(`正在同步过去 ${syncDays} 天的交易数据...`);
    setSyncedTrades([]);
    setImportResult(null);

    const syncStart = Date.now();

    try {
      const result = await syncFromBinance(syncDays);

      if (result.trades.length === 0) {
        setStep('done');
        setStatusMsg(result.message);
        addSyncLog({
          syncType: 'manual',
          status: 'success',
          tradesSynced: 0,
          syncDurationMs: Date.now() - syncStart,
        });
        return;
      }

      setStatusMsg(`同步完成！${result.message}`);
      setSyncedTrades(result.trades);

      // 导入到本地数据库
      const importResult = batchImportTrades(result.trades.map((t) => ({
        exchange: t.exchange,
        orderId: t.orderId,
        symbol: t.symbol,
        direction: t.direction,
        leverage: t.leverage,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        stopLoss: t.stopLoss,
        takeProfit: t.takeProfit,
        positionSize: t.positionSize,
        margin: t.margin,
        fee: t.fee,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        pnl: t.pnl,
        pnlPercent: t.pnlPercent,
        mae: t.mae,
        maePercent: t.maePercent,
        mfe: t.mfe,
        mfePercent: t.mfePercent,
        holdingSeconds: t.holdingSeconds,
        executionScore: t.executionScore,
        isLuckyTrade: t.isLuckyTrade,
        luckyReason: t.luckyReason,
        status: t.status,
        notes: t.notes,
      })));

      setImportResult(importResult);
      setAllTrades(getTrades());

      addSyncLog({
        syncType: 'manual',
        status: importResult.imported > 0 ? 'success' : 'partial',
        tradesSynced: importResult.imported,
        syncDurationMs: Date.now() - syncStart,
      });

      setStep('done');
      setStatusMsg(
        importResult.imported > 0
          ? `✅ 成功导入 ${importResult.imported} 笔新交易（跳过 ${importResult.skipped} 笔已存在的）`
          : `⚠️ 没有新交易需要导入（${importResult.skipped} 笔已存在）`,
      );

      // 刷新日志
      setSyncLogs(getSyncLogs().reverse().slice(0, 10));
    } catch (err: any) {
      setStep('error');
      setStatusMsg(`❌ 同步失败: ${err.message}`);

      addSyncLog({
        syncType: 'manual',
        status: 'failed',
        tradesSynced: 0,
        syncDurationMs: Date.now() - syncStart,
        errorMessage: err.message,
      });
    }
  }, [syncDays]);

  const formatBalance = (b: number) => {
    if (b >= 1000) return b.toFixed(2);
    if (b >= 1) return b.toFixed(4);
    return b.toFixed(6);
  };

  const formatPrice = (p: number) => {
    if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (p >= 100) return p.toFixed(2);
    if (p >= 1) return p.toFixed(4);
    return p.toFixed(6);
  };

  return (
    <div className="sync-page">
      <h1 className="page-title">交易所同步</h1>
      <p className="page-subtitle">一键同步币安合约成交记录，自动计算执行分、标记侥幸交易</p>

      {/* API 密钥配置 */}
      <section className="sync-section">
        <h2 className="section-title">
          <span className="section-icon">🔑</span>
          币安 API 配置
        </h2>
        <div className="api-form">
          <div className="form-row">
            <label className="form-label">API Key</label>
            <input
              type="text"
              className="form-input"
              placeholder="输入你的币安 API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={step === 'testing' || step === 'syncing'}
            />
          </div>
          <div className="form-row">
            <label className="form-label">API Secret</label>
            <div className="secret-input-wrapper">
              <input
                type={showSecret ? 'text' : 'password'}
                className="form-input"
                placeholder="输入你的币安 API Secret"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                disabled={step === 'testing' || step === 'syncing'}
              />
              <button
                className="toggle-secret-btn"
                onClick={() => setShowSecret(!showSecret)}
                title={showSecret ? '隐藏' : '显示'}
              >
                {showSecret ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
          <div className="form-actions">
            <button
              className="btn btn-primary"
              onClick={handleSaveKeys}
              disabled={step === 'testing' || step === 'syncing'}
            >
              保存并测试连接
            </button>
            {hasSavedKeys && (
              <button className="btn btn-danger" onClick={handleClearKeys}>
                清除密钥
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleTestConnection}
              disabled={step === 'testing' || step === 'syncing'}
            >
              测试连接
            </button>
          </div>

          {step === 'testing' && (
            <div className="status-bar testing">
              <span className="spinner" />
              正在连接币安服务器...
            </div>
          )}

          {statusMsg && step !== 'testing' && (
            <div className={`status-bar ${statusMsg.startsWith('✅') ? 'success' : statusMsg.startsWith('❌') ? 'error' : 'info'}`}>
              {statusMsg}
            </div>
          )}

          {/* 账户信息 */}
          {connectionInfo && (
            <div className="connection-info">
              <div className="info-grid">
                {connectionInfo.balances && connectionInfo.balances.length > 0 && (
                  <div className="info-card">
                    <h4>账户余额</h4>
                    {connectionInfo.balances.map((b) => (
                      <div key={b.asset} className="info-row">
                        <span className="info-label">{b.asset}</span>
                        <span className="info-value">{formatBalance(b.balance)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {connectionInfo.positions && connectionInfo.positions.length > 0 && (
                  <div className="info-card">
                    <h4>当前持仓</h4>
                    {connectionInfo.positions.map((p) => (
                      <div key={p.symbol} className="info-row">
                        <span className="info-label">{p.symbol}</span>
                        <span className="info-value">
                          {p.size > 0 ? '多' : '空'} {Math.abs(p.size)} @ {formatPrice(p.entryPrice)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 一键同步 */}
      <section className="sync-section">
        <h2 className="section-title">
          <span className="section-icon">🔄</span>
          一键同步
        </h2>
        <div className="sync-controls">
          <div className="sync-options">
            <label className="form-label">同步时间范围</label>
            <div className="day-options">
              {[1, 3, 7, 14, 30].map((d) => (
                <button
                  key={d}
                  className={`day-btn ${syncDays === d ? 'active' : ''}`}
                  onClick={() => setSyncDays(d)}
                  disabled={step === 'syncing'}
                >
                  {d === 1 ? '今天' : d === 30 ? '30天' : `${d}天`}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn btn-sync"
            onClick={handleSync}
            disabled={!hasSavedKeys || step === 'syncing' || step === 'testing'}
          >
            {step === 'syncing' ? (
              <>
                <span className="spinner" />
                正在同步...
              </>
            ) : (
              '🚀 一键同步'
            )}
          </button>
        </div>

        {step === 'syncing' && (
          <div className="sync-progress">
            <div className="progress-bar">
              <div className="progress-fill" />
            </div>
            <p className="progress-text">正在从币安获取数据，这可能需要几秒钟...</p>
          </div>
        )}

        {step === 'error' && statusMsg && (
          <div className="status-bar error">{statusMsg}</div>
        )}

        {step === 'done' && statusMsg && (
          <div className={`status-bar ${statusMsg.startsWith('✅') ? 'success' : 'info'}`}>
            {statusMsg}
          </div>
        )}

        {/* 同步结果预览 */}
        {syncedTrades.length > 0 && (
          <div className="sync-result">
            <h3>同步结果预览</h3>
            {importResult && (
              <div className="import-summary">
                <span className="import-badge success">新增 {importResult.imported} 笔</span>
                <span className="import-badge skip">跳过 {importResult.skipped} 笔（已存在）</span>
                <span className="import-badge total">当前共 {allTrades.length} 笔交易</span>
              </div>
            )}
            <div className="result-table-wrapper">
              <table className="result-table">
                <thead>
                  <tr>
                    <th>品种</th>
                    <th>方向</th>
                    <th>入场价</th>
                    <th>出场价</th>
                    <th>数量</th>
                    <th>盈亏</th>
                    <th>执行分</th>
                    <th>标记</th>
                  </tr>
                </thead>
                <tbody>
                  {syncedTrades.slice(0, 10).map((t, i) => (
                    <tr key={i} className={t.isLuckyTrade ? 'lucky-row' : ''}>
                      <td className="symbol-cell">{t.symbol}</td>
                      <td>
                        <span className={`dir-badge ${t.direction.toLowerCase()}`}>
                          {t.direction === 'LONG' ? '多' : '空'}
                        </span>
                      </td>
                      <td>{formatPrice(t.entryPrice)}</td>
                      <td>{t.exitPrice ? formatPrice(t.exitPrice) : '-'}</td>
                      <td>{t.positionSize}</td>
                      <td className={t.pnl && t.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                        {t.pnl && t.pnl >= 0 ? '+' : ''}{t.pnl?.toFixed(2)}
                      </td>
                      <td>
                        <span
                          className="score-badge"
                          style={{
                            background: (t.executionScore || 0) >= 70 ? '#22c55e' : (t.executionScore || 0) >= 40 ? '#f59e0b' : '#ef4444',
                            color: '#fff',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '12px',
                          }}
                        >
                          {t.executionScore ?? '-'}
                        </span>
                      </td>
                      <td>
                        {t.isLuckyTrade && (
                          <span className="lucky-badge" title={t.luckyReason}>⚠️ 侥幸</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {syncedTrades.length > 10 && (
                <p className="more-hint">...还有 {syncedTrades.length - 10} 笔未显示</p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 同步历史 */}
      <section className="sync-section">
        <h2 className="section-title">
          <span className="section-icon">📜</span>
          同步历史
        </h2>
        {syncLogs.length === 0 ? (
          <p className="empty-hint">还没有同步记录</p>
        ) : (
          <div className="logs-list">
            {syncLogs.map((log) => (
              <div key={log.id} className={`log-item ${log.status}`}>
                <div className="log-status-icon">
                  {log.status === 'success' ? '✅' : log.status === 'partial' ? '⚠️' : '❌'}
                </div>
                <div className="log-info">
                  <div className="log-time">
                    {new Date(log.createdAt).toLocaleString('zh-CN')}
                  </div>
                  <div className="log-detail">
                    {log.status === 'success' || log.status === 'partial'
                      ? `同步了 ${log.tradesSynced} 笔交易`
                      : `同步失败: ${log.errorMessage}`}
                  </div>
                </div>
                <div className="log-duration">
                  {(log.syncDurationMs / 1000).toFixed(1)}s
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 安全提示 */}
      <section className="sync-section tips">
        <h2 className="section-title">
          <span className="section-icon">🔒</span>
          安全说明
        </h2>
        <ul className="tips-list">
          <li>API 密钥仅保存在浏览器本地，不会上传到任何服务器</li>
          <li>建议在币安 API 管理页面仅开启 <strong>读取权限（Read-only）</strong>，禁止提现</li>
          <li>可以限制 API Key 的 IP 地址范围，提升安全性</li>
          <li>当前为原型阶段，生产环境建议使用后端代理中转</li>
        </ul>
      </section>
    </div>
  );
}
