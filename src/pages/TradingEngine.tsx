/**
 * V2 量化交易系统控制台
 *
 * 标签页：概览 · 信号看板 · Edge验证 · 风控仪表 · 运行日志
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getTrades } from '../lib/db';
import { runEdgeCheck, formatEdgeResult, getEdgeHistory, type EdgeReport } from '../lib/edgeVerifier';
import { runMarketFilters, getFilterLogs, type MarketFilterResult } from '../lib/marketFilter';
import { scoreTradeQuality, type TradeQualityScore } from '../lib/tradeQualityScorer';
import { getRiskState, resetRiskState, checkCircuitBreakers, type CircuitBreakerResult } from '../lib/riskProtocol';
import { runFullScan, getEngineLogs, getEngineSettings, saveEngineSettings, type EngineSettings, type EngineRunResult, type FullScanResult } from '../lib/tradingEngine';
import { startAutoTrading, stopAutoTrading, isAutoTradingRunning, restartAutoTrading } from '../lib/autoScanner';
import { generateDailyReport, runWeeklyOptimization, type DailyReport, type WeeklyOptimization } from '../lib/selfEvolution';
import { getSimulatedOrders, getSimulatedStats, type SimulatedOrder, type SimulatedStats } from '../lib/tradeExecutor';
import { getSimAccount, getAccountPositions, getAccountHistory, initSimAccount, resetSimAccount, formatAccount, type SimAccount, type AccountPosition } from '../lib/simulatedAccount';
import { fetchKlines, type KlineInterval } from '../lib/exchange';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import './StrategyLab.css';

type Tab = 'overview' | 'signals' | 'edge' | 'risk' | 'logs';

const TAB_LABELS: Record<Tab, string> = {
  overview: '📊 概览',
  signals: '📋 信号看板',
  edge: '🔬 Edge验证',
  risk: '🛡️ 风控',
  logs: '📈 日志',
};

export default function TradingEngine() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [settings, setSettings] = useState<EngineSettings>(() => getEngineSettings());
  const [isRunning, setIsRunning] = useState(() => isAutoTradingRunning());
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<FullScanResult | null>(null);
  const [account, setAccount] = useState<SimAccount>(() => getSimAccount());
  const [positions, setPositions] = useState<AccountPosition[]>(() => getAccountPositions());
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null);
  const [edgeReport, setEdgeReport] = useState<EdgeReport | null>(null);
  const [riskState, setRiskState] = useState(() => getRiskState());
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerResult | null>(null);
  const [logs, setLogs] = useState(() => getEngineLogs(50));
  const [orders, setOrders] = useState(() => getSimulatedOrders());
  const [stats, setStats] = useState(() => getSimulatedStats());
  const [filterLogs, setFilterLogs] = useState(() => getFilterLogs());
  const [weeklyOpt, setWeeklyOpt] = useState<WeeklyOptimization | null>(null);
  const [sampleKlines, setSampleKlines] = useState<any[]>([]);
  const [qualityTestResult, setQualityTestResult] = useState<string>('');

  const refresh = useCallback(() => {
    setLogs(getEngineLogs(50));
    setOrders(getSimulatedOrders());
    setStats(getSimulatedStats());
    setRiskState(getRiskState());
    setFilterLogs(getFilterLogs());
    setAccount(getSimAccount());
    setPositions(getAccountPositions());
    setDailyReport(null);
    setEdgeReport(null);
  }, []);

  // 运行扫描
  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await runFullScan();
      setScanResult(result);
      refresh();
    } catch (err: any) {
      console.error('扫描失败:', err);
    } finally {
      setScanning(false);
    }
  }, [refresh]);

  // 生成每日报告
  const handleDailyReport = useCallback(() => {
    setDailyReport(generateDailyReport());
  }, []);

  // Edge验证
  const handleEdgeCheck = useCallback(() => {
    const trades = getTrades();
    setEdgeReport(runEdgeCheck(trades));
  }, []);

  // 每周优化
  const handleWeeklyOpt = useCallback(() => {
    setWeeklyOpt(runWeeklyOptimization());
  }, []);

  // 启停引擎
  const handleToggle = useCallback(() => {
    if (isRunning) {
      stopAutoTrading();
      setIsRunning(false);
    } else {
      saveEngineSettings({ enabled: true });
      startAutoTrading();
      setIsRunning(true);
    }
  }, [isRunning]);

  // 风控检查
  const handleRiskCheck = useCallback(() => {
    setCircuitBreaker(checkCircuitBreakers(
      riskState.consecutiveLosses,
      riskState.dailyLossPercent,
      riskState.maxDrawdownPercent,
    ));
  }, [riskState]);

  // 测试质量评分
  const handleQualityTest = useCallback(async () => {
    try {
      const klines = await fetchKlines({ symbol: 'BTCUSDT', interval: '1h', limit: 100 });
      if (klines.length > 30) {
        setSampleKlines(klines);
        const score = scoreTradeQuality({
          klines,
          symbol: 'BTCUSDT',
          direction: 'LONG',
          entryPrice: klines[klines.length - 1].close,
          stopLoss: klines[klines.length - 1].close * 0.98,
          takeProfit: [klines[klines.length - 1].close * 1.04],
        });
        setQualityTestResult(`质量评分: ${score.totalScore}/100 (${score.level}) — ${score.reasons.join(' | ')}`);
      }
    } catch (err: any) {
      setQualityTestResult(`测试失败: ${err.message}`);
    }
  }, []);

  return (
    <div className="strategylab-page">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">⚡ 量化交易 V2</h1>
          <p className="page-subtitle">
            Edge验证 · 市场过滤 · 质量评分 · 风控 · 双引擎 · 自进化
          </p>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            fontSize: 12, padding: '3px 10px', borderRadius: 6,
            background: isRunning ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)',
            color: isRunning ? '#22c55e' : '#64748b', fontWeight: 600,
          }}>
            {isRunning ? '🟢 自动运行中' : '⏹ 已停止'}
          </span>
          <button
            className="btn-run"
            onClick={handleToggle}
            style={{ padding: '4px 14px', fontSize: 12, background: isRunning ? '#ef4444' : '#22c55e' }}
          >
            {isRunning ? '停止引擎' : '启动引擎'}
          </button>
        </div>
      </div>

      {/* 标签页导航 */}
      <div className="lab-tabs">
        {(['overview', 'signals', 'edge', 'risk', 'logs'] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`lab-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="lab-content">
        {/* ===== 概览 ===== */}
        {activeTab === 'overview' && (
          <div className="lab-panel">
            {/* 模拟账户概览 */}
            <div className="bt-result" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>💰 模拟账户</h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-run" onClick={() => { initSimAccount(10000); refresh(); }} style={{ padding: '3px 10px', fontSize: 11, background: '#f59e0b' }}>
                    重置账户
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                {[
                  { label: '总权益', value: `${account.currentBalance.toFixed(0)} USDT`, color: '#e2e8f0' },
                  { label: '可用余额', value: `${account.availableBalance.toFixed(0)}`, color: '#22c55e' },
                  { label: '保证金', value: `${account.usedMargin.toFixed(0)}`, color: '#f59e0b' },
                  { label: '未实现盈亏', value: `${account.unrealizedPnl >= 0 ? '+' : ''}${account.unrealizedPnl.toFixed(0)}`, color: account.unrealizedPnl >= 0 ? '#ef4444' : '#22c55e' },
                  { label: '累计盈亏', value: `${account.totalPnl >= 0 ? '+' : ''}${account.totalPnl.toFixed(0)}`, color: account.totalPnl >= 0 ? '#ef4444' : '#22c55e' },
                  { label: '手续费', value: `${account.totalFeesPaid.toFixed(2)}`, color: '#64748b' },
                  { label: '交易次数', value: `${account.totalTrades}`, color: '#3b82f6' },
                  { label: '胜率', value: account.totalTrades > 0 ? `${Math.round(account.winCount / account.totalTrades * 100)}%` : '0%', color: '#8b5cf6' },
                ].map((c) => (
                  <div key={c.label} style={{ background: '#11121a', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: c.color }}>{c.value}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{c.label}</div>
                  </div>
                ))}
              </div>
              {/* 持仓 */}
              {positions.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>当前持仓</div>
                  {positions.map((p) => (
                    <div key={p.id} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '4px 8px', background: '#0d0e14', borderRadius: 4, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{p.symbol.replace('USDT', '')}</span>
                      <span style={{ color: p.direction === 'LONG' ? '#ef4444' : '#22c55e' }}>{p.direction === 'LONG' ? '多' : '空'}</span>
                      <span style={{ color: '#94a3b8' }}>{p.quantity.toFixed(4)} @ {p.entryPrice.toFixed(2)}</span>
                      <span style={{ color: '#f59e0b' }}>{p.leverage}x</span>
                      <span style={{ color: p.unrealizedPnl >= 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                        {p.unrealizedPnl >= 0 ? '+' : ''}{p.unrealizedPnl.toFixed(2)} ({p.unrealizedPnlPercent >= 0 ? '+' : ''}{p.unrealizedPnlPercent.toFixed(1)}%)
                      </span>
                      <span style={{ color: '#64748b', marginLeft: 'auto' }}>
                        强平 {p.liquidationPrice.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 统计卡片 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
              {[
                { label: '模拟订单', value: stats.totalOrders, color: '#3b82f6' },
                { label: '持仓中', value: stats.openOrders, color: '#f59e0b' },
                { label: '已平仓', value: stats.closedOrders, color: '#22c55e' },
                { label: '胜率', value: `${stats.winRate}%`, color: '#8b5cf6' },
                { label: '总盈亏', value: `${stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(0)}`, color: stats.totalPnl >= 0 ? '#ef4444' : '#22c55e' },
                { label: '风控', value: riskState.status === 'NORMAL' ? '正常' : riskState.status === 'WARNING' ? '⚠️' : '🛑', color: riskState.status === 'NORMAL' ? '#22c55e' : '#ef4444' },
              ].map((c) => (
                <div key={c.label} style={{ background: '#1a1b23', border: '1px solid #2d2e3d', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: c.color }}>{c.value}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <button className="btn-run" onClick={handleScan} disabled={scanning} style={{ padding: '6px 16px', fontSize: 12 }}>
                {scanning ? '⏳ 扫描中...' : '🔍 执行一次扫描'}
              </button>
              <button className="btn-run" onClick={handleDailyReport} style={{ padding: '6px 16px', fontSize: 12, background: '#8b5cf6' }}>
                📊 生成每日报告
              </button>
              <button className="btn-run" onClick={handleEdgeCheck} style={{ padding: '6px 16px', fontSize: 12, background: '#f59e0b' }}>
                🔬 Edge验证
              </button>
              <button className="btn-run" onClick={handleWeeklyOpt} style={{ padding: '6px 16px', fontSize: 12, background: '#3b82f6' }}>
                📅 每周优化
              </button>
              <button className="btn-run" onClick={handleQualityTest} style={{ padding: '6px 16px', fontSize: 12, background: '#06b6d4' }}>
                🧪 测试质量评分
              </button>
            </div>

            {/* 每日报告 */}
            {dailyReport && (
              <div className="bt-result" style={{ marginBottom: 12 }}>
                <h3>📊 每日报告 — {dailyReport.date}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                  <div style={{ background: '#11121a', borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>实盘交易</div>
                    <div style={{ fontSize: 13, color: '#e2e8f0' }}>{dailyReport.realTrades.total} 笔 (胜率 {dailyReport.realTrades.winRate}%)</div>
                    <div style={{ fontSize: 13, color: dailyReport.realTrades.totalPnl >= 0 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
                      盈亏: {dailyReport.realTrades.totalPnl >= 0 ? '+' : ''}{dailyReport.realTrades.totalPnl.toFixed(2)} USDT
                    </div>
                  </div>
                  <div style={{ background: '#11121a', borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>模拟交易</div>
                    <div style={{ fontSize: 13, color: '#e2e8f0' }}>{dailyReport.simulatedOrders.total} 笔 (胜率 {dailyReport.simulatedOrders.winRate}%)</div>
                    <div style={{ fontSize: 13, color: dailyReport.simulatedOrders.totalPnl >= 0 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
                      盈亏: {dailyReport.simulatedOrders.totalPnl >= 0 ? '+' : ''}{dailyReport.simulatedOrders.totalPnl.toFixed(2)} USDT
                    </div>
                  </div>
                </div>
                {dailyReport.recommendations.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>优化建议</div>
                    {dailyReport.recommendations.map((r, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#94a3b8', padding: '2px 0' }}>{r}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 质量评分测试 */}
            {qualityTestResult && (
              <div className={`status-bar ${qualityTestResult.includes('失败') ? 'error' : 'info'}`} style={{ marginBottom: 12 }}>
                {qualityTestResult}
              </div>
            )}

            {/* 本周优化 */}
            {weeklyOpt && (
              <div className="bt-result" style={{ marginBottom: 12 }}>
                <h3>📅 本周策略优化 {weeklyOpt.weekStart} ~ {weeklyOpt.weekEnd}</h3>
                {weeklyOpt.actions.length > 0 ? (
                  <div style={{ marginTop: 8 }}>
                    {weeklyOpt.actions.map((a, i) => (
                      <div key={i} style={{ fontSize: 13, color: a.includes('淘汰') ? '#ef4444' : '#22c55e', padding: '3px 0' }}>
                        {a}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="status-bar info" style={{ marginTop: 8, fontSize: 12 }}>暂无需要优化的策略</div>
                )}
              </div>
            )}

            {/* 市场亮点 */}
            {scanResult && (
              <>
                {/* 暴涨榜 / 暴跌榜 / 蓄势突破 */}
                <div className="mc-heat-grid" style={{ marginBottom: 12 }}>
                  <div className="mc-heat-card">
                    <div className="mc-heat-title" style={{ color: '#ef4444' }}>🔥 暴涨榜</div>
                    <div className="mc-heat-list">
                      {scanResult.topGainers.map((t, i) => (
                        <div key={t.symbol} className="mc-heat-row" style={{ fontSize: 11 }}>
                          <span className="mc-heat-rank" style={{ color: i < 3 ? '#f59e0b' : '#64748b' }}>{i + 1}</span>
                          <span className="mc-heat-symbol">{t.symbol.replace('USDT', '')}</span>
                          <span className="mc-heat-value mc-up">{parseFloat(t.change) >= 0 ? '+' : ''}{parseFloat(t.change).toFixed(2)}%</span>
                          <span className="mc-heat-price">${parseFloat(t.price).toFixed(2)}</span>
                        </div>
                      ))}
                      {scanResult.topGainers.length === 0 && <div style={{ padding: 10, fontSize: 11, color: '#64748b', textAlign: 'center' }}>无数据</div>}
                    </div>
                  </div>
                  <div className="mc-heat-card">
                    <div className="mc-heat-title" style={{ color: '#22c55e' }}>❄️ 暴跌榜</div>
                    <div className="mc-heat-list">
                      {scanResult.topLosers.map((t, i) => (
                        <div key={t.symbol} className="mc-heat-row" style={{ fontSize: 11 }}>
                          <span className="mc-heat-rank" style={{ color: i < 3 ? '#f59e0b' : '#64748b' }}>{i + 1}</span>
                          <span className="mc-heat-symbol">{t.symbol.replace('USDT', '')}</span>
                          <span className="mc-heat-value mc-down">{parseFloat(t.change) >= 0 ? '+' : ''}{parseFloat(t.change).toFixed(2)}%</span>
                          <span className="mc-heat-price">${parseFloat(t.price).toFixed(2)}</span>
                        </div>
                      ))}
                      {scanResult.topLosers.length === 0 && <div style={{ padding: 10, fontSize: 11, color: '#64748b', textAlign: 'center' }}>无数据</div>}
                    </div>
                  </div>
                  <div className="mc-heat-card">
                    <div className="mc-heat-title" style={{ color: '#f59e0b' }}>⏳ 蓄势突破亮点</div>
                    <div className="mc-heat-list">
                      {scanResult.accumulationHighlights.slice(0, 5).map((r) => {
                        const phaseLabel = r.phase === 'both' ? '🔥 爆发' : r.phase === 'accumulating' ? '⏳ 蓄势' : r.phase === 'breaking_out' ? '🚀 突破' : '➖';
                        const phaseColor = r.phase === 'both' ? '#ef4444' : r.phase === 'accumulating' ? '#f59e0b' : r.phase === 'breaking_out' ? '#22c55e' : '#64748b';
                        return (
                          <div key={r.symbol} className="mc-heat-row" style={{ fontSize: 11 }}>
                            <span className="mc-heat-symbol">{r.symbol.replace('USDT', '')}</span>
                            <span style={{ color: phaseColor, fontWeight: 600, fontSize: 10 }}>{phaseLabel}</span>
                            <span className="mc-heat-value" style={{ color: '#94a3b8' }}>{r.score.toFixed(1)}分</span>
                          </div>
                        );
                      })}
                      {scanResult.accumulationHighlights.length === 0 && <div style={{ padding: 10, fontSize: 11, color: '#64748b', textAlign: 'center' }}>扫描后显示</div>}
                    </div>
                  </div>
                </div>

                {/* 详细扫描结果 */}
                <div className="bt-result">
                  <h3>扫描结果 <span className="result-period">{scanResult.results.length} 个品种 · {scanResult.summary.signals} 个信号</span></h3>
                  <div className="table-container" style={{ marginTop: 8 }}>
                    <table className="trades-table">
                      <thead>
                        <tr>
                          <th>品种</th><th>引擎</th><th>市场状态</th><th>过滤</th><th>信号分</th><th>信号</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanResult.results.map((r) => (
                          <tr key={r.symbol}>
                            <td style={{ fontWeight: 600 }}>{r.symbol.replace('USDT', '')}</td>
                            <td>
                              <span style={{ color: r.engineType === 'STABLE' ? '#22c55e' : '#ef4444', fontSize: 12 }}>
                                {r.engineType === 'STABLE' ? '🟢 稳健' : '🔴 激进'}
                              </span>
                            </td>
                            <td>
                              {r.marketState ? (
                                <span style={{
                                  color: r.marketState.state === 'EXPLOSIVE' ? '#ef4444'
                                    : r.marketState.state === 'TRENDING' ? '#22c55e' : '#f59e0b',
                                  fontSize: 12,
                                }}>
                                  {r.marketState.state === 'EXPLOSIVE' ? '🔥' : r.marketState.state === 'TRENDING' ? '📈' : '➡️'}
                                  {' '}{r.marketState.confidence}%
                                </span>
                              ) : <span style={{ fontSize: 12, color: '#64748b' }}>—</span>}
                            </td>
                            <td>
                              {r.marketFilter ? (
                                <span style={{ color: r.marketFilter.passed ? '#22c55e' : '#ef4444', fontSize: 12 }}>
                                  {r.marketFilter.passed ? '✅' : '❌'} {r.marketFilter.overallScore}
                                </span>
                              ) : <span style={{ fontSize: 12, color: '#64748b' }}>—</span>}
                            </td>
                            <td>
                              {r.signalScore ? (
                                <span style={{
                                  color: r.signalScore.level === 'BOOST' ? '#22c55e'
                                    : r.signalScore.level === 'NORMAL' ? '#f59e0b' : '#ef4444',
                                  fontWeight: 600, fontSize: 13,
                                }}>
                                  {r.signalScore.totalScore}
                                </span>
                              ) : <span style={{ fontSize: 12, color: '#64748b' }}>—</span>}
                            </td>
                            <td>
                              {r.order ? (
                                <span className="signal-tag" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                                  ✅ 下单
                                </span>
                              ) : (
                                <span style={{ fontSize: 12, color: '#64748b' }}>跳过</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {!scanResult && !dailyReport && !scanning && (
              <div className="status-bar info" style={{ textAlign: 'center', padding: '30px 20px' }}>
                点击「执行一次扫描」开始完整交易循环测试。<br />
                系统默认处于模拟模式，不下真实订单。
              </div>
            )}
          </div>
        )}

        {/* ===== 信号看板 ===== */}
        {activeTab === 'signals' && (
          <div className="lab-panel">
            <h3 style={{ marginBottom: 12 }}>📋 信号看板</h3>
            <p className="status-bar info" style={{ marginBottom: 16, fontSize: 12 }}>
              显示最近模拟交易信号。每笔信号包含：市场评分 + 质量评分 + 分批仓位
            </p>
            {orders.length > 0 ? (
              <div className="table-container">
                <table className="trades-table">
                  <thead>
                    <tr>
                      <th>时间</th><th>品种</th><th>方向</th><th>引擎</th><th>信号分</th><th>质量分</th><th>入场</th><th>止损</th><th>仓位</th><th>风险%</th><th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.slice(0, 20).map((o) => (
                      <tr key={o.id}>
                        <td style={{ fontSize: 11, color: '#64748b' }}>
                          {new Date(o.createdAt).toLocaleTimeString('zh-CN')}
                        </td>
                        <td style={{ fontWeight: 600 }}>{o.symbol.replace('USDT', '')}</td>
                        <td>
                          <span style={{ color: o.direction === 'LONG' ? '#ef4444' : '#22c55e', fontWeight: 600, fontSize: 12 }}>
                            {o.direction === 'LONG' ? '多' : '空'}
                          </span>
                        </td>
                        <td>
                          <span style={{ color: o.engineType === 'STABLE' ? '#22c55e' : '#ef4444', fontSize: 11 }}>
                            {o.engineType === 'STABLE' ? '🟢' : '🔴'}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            color: o.signalScore >= 80 ? '#22c55e' : o.signalScore >= 60 ? '#f59e0b' : '#ef4444',
                            fontWeight: 600,
                          }}>{o.signalScore}</span>
                        </td>
                        <td>
                          <span style={{
                            color: o.qualityScore >= 85 ? '#22c55e' : o.qualityScore >= 70 ? '#f59e0b' : '#ef4444',
                            fontWeight: 600,
                          }}>{o.qualityScore}</span>
                        </td>
                        <td style={{ fontSize: 12 }}>{o.entryPrice.toFixed(2)}</td>
                        <td style={{ fontSize: 12, color: '#ef4444' }}>{o.stopLoss.toFixed(2)}</td>
                        <td style={{ fontSize: 12 }}>
                          {o.batch1Qty.toFixed(4)}/{o.batch2Qty.toFixed(4)}/{o.batch3Qty.toFixed(4)}
                        </td>
                        <td style={{ fontSize: 12, color: '#f59e0b' }}>{o.riskPercent.toFixed(1)}%</td>
                        <td>
                          <span style={{
                            fontSize: 11, padding: '2px 6px', borderRadius: 3,
                            background: o.status === 'SIGNALED' ? 'rgba(59,130,246,0.15)' :
                              o.status === 'CLOSED' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                            color: o.status === 'SIGNALED' ? '#3b82f6' :
                              o.status === 'CLOSED' ? '#22c55e' : '#f59e0b',
                          }}>
                            {o.status === 'SIGNALED' ? '信号' : o.status === 'EXECUTED' ? '执行' : o.status === 'CLOSED' ? '已平' : '取消'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="status-bar info" style={{ textAlign: 'center', padding: 40 }}>
                暂无信号数据。点击「概览 → 执行一次扫描」生成信号。
              </div>
            )}
          </div>
        )}

        {/* ===== Edge 验证 ===== */}
        {activeTab === 'edge' && (
          <div className="lab-panel">
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn-run" onClick={handleEdgeCheck} style={{ padding: '6px 16px', fontSize: 12 }}>
                🔬 运行 Edge 验证
              </button>
            </div>

            {edgeReport ? (
              <div>
                <h3 style={{ marginBottom: 8 }}>Edge 报告 — {edgeReport.date}</h3>
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <div style={{ background: '#1a1b23', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, padding: '6px 12px' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>有效策略</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>{edgeReport.summary.aliveCount}</div>
                  </div>
                  <div style={{ background: '#1a1b23', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, padding: '6px 12px' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>已淘汰</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>{edgeReport.summary.eliminatedCount}</div>
                  </div>
                  <div style={{ background: '#1a1b23', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '6px 12px' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>最佳策略</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>{edgeReport.summary.bestStrategy}</div>
                  </div>
                </div>

                <div className="table-container">
                  <table className="trades-table">
                    <thead>
                      <tr>
                        <th>策略</th><th>交易数</th><th>胜率</th><th>平均盈利</th><th>平均亏损</th><th>盈亏比</th><th>期望值</th><th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {edgeReport.results.map((r) => (
                        <tr key={r.strategyName}>
                          <td style={{ fontWeight: 600 }}>{r.strategyName}</td>
                          <td>{r.totalTrades}</td>
                          <td style={{ color: r.winRate >= 50 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{r.winRate.toFixed(1)}%</td>
                          <td style={{ color: '#ef4444' }}>{r.avgWin.toFixed(2)}</td>
                          <td style={{ color: '#22c55e' }}>{r.avgLoss.toFixed(2)}</td>
                          <td style={{ fontWeight: 600 }}>{r.profitFactor.toFixed(2)}</td>
                          <td style={{
                            fontWeight: 800, fontSize: 14,
                            color: r.expectancy > 0 ? '#22c55e' : r.expectancy < 0 ? '#ef4444' : '#64748b',
                          }}>
                            {r.expectancy >= 0 ? '+' : ''}{r.expectancy.toFixed(2)}
                          </td>
                          <td>
                            <span style={{
                              color: r.isAlive ? '#22c55e' : '#ef4444', fontWeight: 600, fontSize: 13,
                            }}>
                              {r.isAlive ? '✅ 存活' : '❌ 淘汰'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="status-bar info" style={{ textAlign: 'center', padding: 40 }}>
                点击「运行 Edge 验证」查看各策略的生存能力评估
              </div>
            )}
          </div>
        )}

        {/* ===== 风控 ===== */}
        {activeTab === 'risk' && (
          <div className="lab-panel">
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn-run" onClick={handleRiskCheck} style={{ padding: '6px 16px', fontSize: 12 }}>
                🛡️ 检查风控状态
              </button>
              <button className="btn-run" onClick={() => { resetRiskState(); setRiskState(getRiskState()); }} style={{ padding: '6px 16px', fontSize: 12, background: '#64748b' }}>
                🔄 重置风控
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
              <div style={{ background: '#1a1b23', border: '1px solid #2d2e3d', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>风控状态</div>
                <div style={{
                  fontSize: 18, fontWeight: 800,
                  color: riskState.status === 'NORMAL' ? '#22c55e' : riskState.status === 'WARNING' ? '#f59e0b' : '#ef4444',
                }}>
                  {riskState.status === 'NORMAL' ? '🟢 正常' : riskState.status === 'WARNING' ? '🟡 警告' : '🔴 停机'}
                </div>
              </div>
              <div style={{ background: '#1a1b23', border: '1px solid #2d2e3d', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>连续亏损</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: riskState.consecutiveLosses >= 3 ? '#ef4444' : '#e2e8f0' }}>
                  {riskState.consecutiveLosses} 次
                </div>
              </div>
              <div style={{ background: '#1a1b23', border: '1px solid #2d2e3d', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>日亏损</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: riskState.dailyLossPercent >= 5 ? '#ef4444' : '#e2e8f0' }}>
                  {riskState.dailyLossPercent.toFixed(1)}%
                </div>
              </div>
              <div style={{ background: '#1a1b23', border: '1px solid #2d2e3d', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>最大回撤</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: riskState.maxDrawdownPercent >= 15 ? '#ef4444' : '#e2e8f0' }}>
                  {riskState.maxDrawdownPercent.toFixed(1)}%
                </div>
              </div>
            </div>

            {circuitBreaker && (
              <div className="bt-result">
                <h4>停机检查结果</h4>
                <div style={{ marginTop: 8 }}>
                  <div style={{
                    fontSize: 16, fontWeight: 700, marginBottom: 6,
                    color: circuitBreaker.shouldStop ? '#ef4444' : '#22c55e',
                  }}>
                    {circuitBreaker.shouldStop ? '🔴 触发停机' : '🟢 正常'}
                  </div>
                  {circuitBreaker.reasons.map((r, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#94a3b8', padding: '2px 0' }}>{r}</div>
                  ))}
                  <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 4 }}>
                    建议操作: {circuitBreaker.recommendedAction === 'STOP' ? '停止交易'
                      : circuitBreaker.recommendedAction === 'STOP_ALL' ? '强制停止'
                      : circuitBreaker.recommendedAction === 'REDUCE' ? '降低仓位' : '继续交易'}
                  </div>
                </div>
              </div>
            )}

            {/* 仓位计算器 */}
            <div className="bt-result" style={{ marginTop: 12 }}>
              <h4>仓位计算器（参考）</h4>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                假设账户 10,000 USDT，入场 BTC 68,000，止损 66,000，止盈 72,000
              </div>
              <div style={{ background: '#11121a', borderRadius: 6, padding: 10, marginTop: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                  <div>🟢 稳健模式 (1%)</div>
                  <div>风险金额: 100 USDT | 仓位: 0.05 BTC | 分批: 0.015/0.015/0.02</div>
                  <div>🔴 激进模式 (2%)</div>
                  <div>风险金额: 200 USDT | 仓位: 0.10 BTC | 分批: 0.03/0.03/0.04</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== 日志 ===== */}
        {activeTab === 'logs' && (
          <div className="lab-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>📈 运行日志</h3>
              <button className="btn-run" onClick={() => refresh()} style={{ padding: '4px 12px', fontSize: 11 }}>
                🔄 刷新
              </button>
            </div>

            {logs.length > 0 ? (
              <div style={{ background: '#0d0e14', borderRadius: 8, padding: 12, maxHeight: 500, overflow: 'auto' }}>
                {logs.map((log) => {
                  const typeColor: Record<string, string> = {
                    SCAN: '#3b82f6', SIGNAL: '#22c55e', FILTER: '#f59e0b',
                    QUALITY: '#06b6d4', RISK: '#ef4444', ORDER: '#8b5cf6',
                    EVOLVE: '#6366f1', ERROR: '#ef4444',
                  };
                  return (
                    <div key={log.id} style={{
                      display: 'flex', gap: 8, padding: '4px 0',
                      borderBottom: '1px solid rgba(45,46,61,0.3)',
                      fontSize: 12, fontFamily: 'monospace',
                    }}>
                      <span style={{
                        color: '#64748b', minWidth: 70, fontSize: 11,
                      }}>
                        {new Date(log.timestamp).toLocaleTimeString('zh-CN')}
                      </span>
                      <span style={{
                        color: typeColor[log.type] || '#64748b',
                        minWidth: 50, fontSize: 11, fontWeight: 600,
                      }}>
                        [{log.type}]
                      </span>
                      <span style={{ color: log.type === 'ERROR' ? '#ef4444' : '#94a3b8' }}>
                        {log.message}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="status-bar info" style={{ textAlign: 'center', padding: 40 }}>
                暂无日志。点击「概览 → 执行一次扫描」生成运行记录。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
