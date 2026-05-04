/**
 * 量化交易系统 — 完整重构 UI
 *
 * 8个标签页：
 * ① 总览（做不做）② 信号（做什么）③ Edge（赚不赚钱）
 * ④ 实验室（为什么赚钱）⑤ 风控（别死）⑥ 复盘（怎么变强）
 * ⑦ 回测（验证）⑧ 设置（控制）
 *
 * 每一页都必须改变交易决策，否则删除
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getTrades } from '../lib/db';
import { runEdgeCheck, type EdgeReport } from '../lib/edgeVerifier';
import { getRiskState, resetRiskState, checkCircuitBreakers, type CircuitBreakerResult, type RiskState } from '../lib/riskProtocol';
import { generateDailyReport, type DailyReport } from '../lib/selfEvolution';
import { type SimulatedOrder, type SimulatedStats } from '../lib/tradeExecutor';
import { type SimAccount, type AccountPosition, type AccountEntry } from '../lib/simulatedAccount';
import { runEngineBacktest, type EngineBacktestResult, type BacktestTrade } from '../lib/engineBacktest';
import { engineApi, engineWS } from '../lib/engineClient';
import { fetchKlines } from '../lib/exchange';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import './StrategyLab.css';

type Tab = 'overview' | 'signals' | 'edge' | 'lab' | 'risk' | 'trades' | 'backtest' | 'settings';

const TAB_INFO: { key: Tab; icon: string; label: string; purpose: string }[] = [
  { key: 'overview', icon: '📊', label: '总览', purpose: '要不要做' },
  { key: 'signals', icon: '📡', label: '信号', purpose: '做什么' },
  { key: 'edge', icon: '🔬', label: 'Edge', purpose: '赚不赚钱' },
  { key: 'lab', icon: '🧪', label: '实验室', purpose: '为什么赚钱' },
  { key: 'risk', icon: '🛡️', label: '风控', purpose: '别死' },
  { key: 'trades', icon: '📋', label: '复盘', purpose: '怎么变强' },
  { key: 'backtest', icon: '📉', label: '回测', purpose: '验证' },
  { key: 'settings', icon: '⚙️', label: '设置', purpose: '控制' },
];

// ==================== 颜色常量 ====================
const C_LONG = '#ef4444';
const C_SHORT = '#22c55e';
const C_GOOD = '#22c55e';
const C_WARN = '#f59e0b';
const C_BAD = '#ef4444';
const C_INFO = '#3b82f6';
const C_MUTED = '#64748b';

// ==================== 组件 ====================

function StatCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: '#1a1b23', border: '1px solid #2d2e3d', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: C_MUTED, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || '#e2e8f0' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C_MUTED, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function Badge({ label, color, bg }: { label: string; color: string; bg?: string }) {
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 4,
      background: bg || `${color}15`, color, fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function ActionBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      fontSize: 12, padding: '3px 10px', borderRadius: 6, fontWeight: 600,
      background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      color: ok ? C_GOOD : C_BAD,
    }}>
      {ok ? '✔' : '❌'} {label}
    </span>
  );
}

// ==================== 主页面 ====================

export default function TradingEngine() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [engineConnected, setEngineConnected] = useState(false);
  const [engineRunning, setEngineRunning] = useState(false);

  // 引擎数据
  const [account, setAccount] = useState<SimAccount>({
    initialBalance: 0, currentBalance: 0, availableBalance: 0, usedMargin: 0,
    unrealizedPnl: 0, totalPnl: 0, totalFeesPaid: 0, totalTrades: 0, winCount: 0, lossCount: 0,
  });
  const [positions, setPositions] = useState<any[]>([]);
  const [engineLogs, setEngineLogs] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [lastSignal, setLastSignal] = useState<{ symbol: string; score: number; level: string; direction: string; price: number; time: string } | null>(null);

  // 本地回测
  const [backtesting, setBacktesting] = useState(false);
  const [backtestResult, setBacktestResult] = useState<EngineBacktestResult | null>(null);
  const [btSymbol, setBtSymbol] = useState('BTCUSDT');
  const [btDays, setBtDays] = useState(30);

  // Edge 验证
  const [edgeReport, setEdgeReport] = useState<EdgeReport | null>(null);
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null);

  // 风控
  const [riskState, setRiskState] = useState<RiskState>(() => getRiskState());
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerResult | null>(null);

  // 复盘
  const [accountHistory, setAccountHistory] = useState<any[]>([]);
  const [orders, setOrders] = useState<SimulatedOrder[]>([]);

  // ==================== 引擎连接 ====================

  // 从引擎拉取全量数据
  const pullData = useCallback(async () => {
    try {
      const [acct, pos, hist, logs, state] = await Promise.all([
        engineApi.getAccount(),
        engineApi.getPositions(),
        engineApi.getHistory(),
        engineApi.getLogs(),
        engineApi.getState(),
      ]);
      setAccount(acct);
      setPositions(pos);
      setAccountHistory(hist);
      setEngineLogs(logs);
      setEngineRunning(state.running);
    } catch {}
  }, []);

  // WebSocket 连接 + 实时监听
  useEffect(() => {
    // 初始拉取
    pullData();

    // WebSocket 监听
    const unsubs = [
      engineWS.on('connection', (data: any) => setEngineConnected(data.connected)),
      engineWS.on('state', (data: any) => setEngineRunning(data.running)),
      engineWS.on('signal', (data: any) => {
        setLastSignal(data);
        setSignals((prev) => [data, ...prev].slice(0, 100));
      }),
      engineWS.on('order', () => pullData()),
      engineWS.on('position_closed', () => pullData()),
      engineWS.on('log', () => {
        engineApi.getLogs().then(setEngineLogs).catch(() => {});
      }),
      engineWS.connect,
    ];

    // 定时轮询（作为WS的备份）
    const interval = setInterval(pullData, 10000);

    return () => {
      unsubs.forEach((fn) => fn?.());
      clearInterval(interval);
      engineWS.disconnect();
    };
  }, [pullData]);

  // ==================== 操作 ====================

  // 启停引擎
  const handleToggle = useCallback(async () => {
    try {
      if (engineRunning) {
        await engineApi.stopEngine();
        setEngineRunning(false);
      } else {
        await engineApi.startEngine();
        setEngineRunning(true);
        setTimeout(pullData, 2000); // 给引擎初始化时间
      }
    } catch (e: any) {
      alert('操作失败: ' + e.message);
    }
  }, [engineRunning, pullData]);

  // Edge验证
  const handleEdgeCheck = useCallback(() => {
    setEdgeReport(runEdgeCheck(getTrades()));
  }, []);

  // 每日报告
  const handleDailyReport = useCallback(() => {
    setDailyReport(generateDailyReport());
  }, []);

  // 风控检查
  const handleRiskCheck = useCallback(() => {
    setCircuitBreaker(checkCircuitBreakers(
      riskState.consecutiveLosses, riskState.dailyLossPercent, riskState.maxDrawdownPercent,
    ));
  }, [riskState]);

  // 平仓
  const handleClosePosition = useCallback(async (posId: string) => {
    try {
      await engineApi.closePosition(posId);
      pullData();
    } catch {}
  }, [pullData]);

  // 回测
  const handleBacktest = useCallback(async () => {
    setBacktesting(true);
    setBacktestResult(null);
    try {
      const result = await runEngineBacktest(btSymbol, '1h', btDays, 10000);
      setBacktestResult(result);
    } catch (e: any) {
      alert('回测失败: ' + e.message);
    } finally { setBacktesting(false); }
  }, [btSymbol, btDays]);

  // 当前市场状态（从最近信号取）
  const currentState = useMemo(() => {
    if (!lastSignal) return null;
    return {
      marketState: lastSignal.score >= 80 ? 'TRENDING' : lastSignal.score >= 60 ? 'NORMAL' : 'WEAK',
      signalScore: lastSignal.score,
      marketConfidence: lastSignal.score,
      filterPassed: lastSignal.score >= 60,
      filterScore: lastSignal.score,
    };
  }, [lastSignal]);

  // 今日盈亏
  const todayPnl = useMemo(() => {
    if (!Array.isArray(accountHistory)) return 0;
    const today = new Date().toISOString().split('T')[0];
    return accountHistory
      .filter((e: any) => e.timestamp?.startsWith(today) && (e.type === 'REALIZED_PNL' || e.type === 'TRADE_CLOSE'))
      .reduce((s: number, e: any) => s + (e.amount || 0), 0);
  }, [accountHistory]);

  // ==================== RENDER ====================
  return (
    <div className="strategylab-page">
      {/* 页面标题 + 系统状态 */}
      <div className="page-header" style={{ marginBottom: 0, paddingBottom: 8 }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 18 }}>⚡ 量化交易系统</h1>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 4,
              background: engineConnected ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: engineConnected ? '#22c55e' : '#ef4444', fontWeight: 600,
            }}>
              {engineConnected ? (engineRunning ? '🟢 引擎运行' : '⏹ 引擎停止') : '🔴 引擎离线'}
            </span>
            {currentState && (
              <>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontWeight: 600 }}>
                  信号分: {currentState.signalScore}
                </span>
                {lastSignal && (
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    background: 'rgba(100,116,139,0.15)', color: '#94a3b8', fontWeight: 500 }}>
                    {lastSignal.symbol} ${lastSignal.price.toFixed(2)}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 6,
            background: engineConnected ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: engineConnected ? '#22c55e' : '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: engineConnected ? '#22c55e' : '#ef4444', display: 'inline-block' }} />
            {engineConnected ? '已连接引擎' : '引擎离线'}
          </span>
          <button className="btn-run" onClick={handleToggle}
            style={{ padding: '5px 14px', fontSize: 12, background: engineRunning ? '#ef4444' : '#22c55e' }}>
            {engineRunning ? '⏹ 停止引擎' : '▶ 启动引擎'}
          </button>
        </div>
      </div>

      {/* 标签页导航 */}
      <div className="lab-tabs" style={{ marginBottom: 12 }}>
        {TAB_INFO.map((t) => (
          <button key={t.key}
            className={`lab-tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
            style={{ fontSize: 11 }}>
            {t.icon} {t.label}
            <span style={{ fontSize: 9, color: C_MUTED, marginLeft: 3, display: 'none' }}>{t.purpose}</span>
          </button>
        ))}
      </div>

      <div className="lab-content">
        {/* ========== ① 总览 — 做不做 ========== */}
        {activeTab === 'overview' && (
          <div className="lab-panel">
            {/* 行动提示（最显眼） */}
            <div style={{
              background: currentState?.filterPassed ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${currentState?.filterPassed ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
              borderRadius: 10, padding: '14px 16px', marginBottom: 14,
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: currentState?.filterPassed ? C_GOOD : C_BAD }}>
                {currentState?.filterPassed ? '✔ 当前允许交易' : '⚠️ 当前不宜交易'}
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
                {currentState
                  ? `市场 ${currentState.marketState} · 信号分 ${currentState.signalScore} · 过滤 ${currentState.filterScore}分`
                  : '点击「扫描」获取实时市场状态'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <ActionBadge ok={currentState?.filterPassed || false} label="允许交易" />
                <ActionBadge ok={currentState?.marketState === 'TRENDING'} label="趋势策略" />
                <ActionBadge ok={riskState.status === 'NORMAL'} label="风控正常" />
                <ActionBadge ok={account.availableBalance >= 100} label="余额充足" />
              </div>
              {currentState?.filterPassed && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(34,197,94,0.05)', borderRadius: 6, fontSize: 12, color: '#94a3b8' }}>
                  ➡ 推荐策略：{currentState.marketState === 'TRENDING' ? '趋势回调（中等仓位）' : currentState.marketState === 'EXPLOSIVE' ? '突破追涨（轻仓）' : '观望等待'}
                  · 仓位：{currentState.signalScore >= 80 ? '正常' : '轻仓'}
                </div>
              )}
            </div>

            {/* 核心指标 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
              <StatCard label="账户权益" value={`${account.currentBalance.toFixed(0)}`} color={account.totalPnl >= 0 ? C_BAD : C_GOOD}
                sub={account.totalPnl >= 0 ? `+${account.totalPnl.toFixed(0)}` : account.totalPnl.toFixed(0)} />
              <StatCard label="今日盈亏" value={`${todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(0)}`} color={todayPnl >= 0 ? C_BAD : C_GOOD} />
              <StatCard label="回撤" value={`${riskState.maxDrawdownPercent.toFixed(1)}%`} color={riskState.maxDrawdownPercent >= 15 ? C_BAD : riskState.maxDrawdownPercent >= 10 ? C_WARN : C_GOOD} />
              <StatCard label="连亏" value={`${riskState.consecutiveLosses}次`} color={riskState.consecutiveLosses >= 3 ? C_BAD : C_GOOD} />
              <StatCard label="持仓" value={`${positions.length}`} color={positions.length > 0 ? C_INFO : C_MUTED} />
              <StatCard label="模拟订单" value={`${stats.totalOrders}笔`} color={C_INFO}
                sub={`胜率 ${stats.winRate}%`} />
            </div>

            {/* 持仓摘要 */}
            {positions.length > 0 && (
              <div style={{ background: '#1a1b23', border: '1px solid #2d2e3d', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>📦 当前持仓</div>
                {positions.map((p) => (
                  <div key={p.id} style={{
                    display: 'flex', gap: 8, fontSize: 12, padding: '6px 8px',
                    background: '#0d0e14', borderRadius: 4, marginBottom: 3, alignItems: 'center',
                  }}>
                    <span style={{ fontWeight: 700, color: '#e2e8f0', minWidth: 40 }}>{p.symbol.replace('USDT', '')}</span>
                    <Badge label={p.direction === 'LONG' ? '做多' : '做空'} color={p.direction === 'LONG' ? C_LONG : C_SHORT} />
                    <span style={{ color: '#94a3b8' }}>{p.quantity.toFixed(4)}</span>
                    <span style={{ color: '#94a3b8' }}>@ {p.entryPrice.toFixed(2)}</span>
                    <span style={{ color: '#f59e0b' }}>{p.leverage}x</span>
                    <span style={{ fontWeight: 700, color: p.unrealizedPnl >= 0 ? C_LONG : C_SHORT }}>
                      {p.unrealizedPnl >= 0 ? '+' : ''}{p.unrealizedPnl.toFixed(2)}
                    </span>
                    <button onClick={() => handleClosePosition(p.id)}
                      style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 3, border: '1px solid #2d2e3d', background: 'transparent', color: C_MUTED, cursor: 'pointer' }}>
                      平仓
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 上次信号 */}
            {lastSignal && (
              <div style={{ fontSize: 11, color: C_MUTED, paddingTop: 8, borderTop: '1px solid #2d2e3d' }}>
                📡 最新信号: {lastSignal.symbol} 评分 {lastSignal.score} {lastSignal.level} · {new Date(lastSignal.time).toLocaleTimeString('zh-CN')}
              </div>
            )}
          </div>
        )}

        {/* ========== ② 信号看板 — 做什么 ========== */}
        {activeTab === 'signals' && (
          <div className="lab-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>📡 实时交易机会</h3>
              <button className="btn-run" onClick={handleScan} disabled={scanning}
                style={{ padding: '3px 12px', fontSize: 11 }}>
                {scanning ? '⏳' : '🔄 刷新'}
              </button>
            </div>

            {signals.length > 0 ? (
              <div className="table-container">
                <table className="trades-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>时间</th><th>品种</th><th>评分</th><th>RSI</th><th>方向</th><th>价格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signals.slice(0, 30).map((s, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 11, color: C_MUTED }}>
                          {new Date(s.time).toLocaleTimeString('zh-CN')}
                        </td>
                        <td style={{ fontWeight: 600 }}>{s.symbol}</td>
                        <td>
                          <span style={{ fontWeight: 700, color: s.score >= 80 ? C_GOOD : s.score >= 60 ? C_WARN : C_BAD }}>
                            {s.score}
                          </span>
                          <span style={{ fontSize: 10, color: C_MUTED, marginLeft: 4 }}>({s.level})</span>
                        </td>
                        <td>{s.rsi ?? '--'}</td>
                        <td>
                          <Badge label={s.direction === 'LONG' ? '做多' : '做空'}
                            color={s.direction === 'LONG' ? '#ef4444' : '#22c55e'} />
                        </td>
                        <td style={{ fontSize: 12 }}>${s.price?.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="status-bar info" style={{ textAlign: 'center', padding: 30 }}>
                暂无信号。点击「扫描」获取实时机会。
              </div>
            )}
          </div>
        )}

        {/* ========== ③ Edge — 赚不赚钱 ========== */}
        {activeTab === 'edge' && (
          <div className="lab-panel">
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <button className="btn-run" onClick={handleEdgeCheck} style={{ padding: '5px 14px', fontSize: 12 }}>
                🔬 运行Edge验证
              </button>
              <button className="btn-run" onClick={handleDailyReport} style={{ padding: '5px 14px', fontSize: 12, background: '#8b5cf6' }}>
                📊 每日报告
              </button>
            </div>

            {/* ① 策略表现 */}
            <div className="bt-result" style={{ marginBottom: 10 }}>
              <h4 style={{ fontSize: 13, marginBottom: 6 }}>📊 策略表现</h4>
              <ComparisonTable
                rows={[
                  { label: '🟢 全部信号', ...calcComparison(signals.map(s => ({ pnl: 0, signalScore: s.score }))) },
                  { label: '⭐ 高评分(≥80)', ...calcComparison(signals.filter(s => s.score >= 80).map(s => ({ pnl: 0, signalScore: s.score }))) },
                ]}
              />
            </div>

            {/* ② 评分分层 */}
            <div className="bt-result" style={{ marginBottom: 10 }}>
              <h4 style={{ fontSize: 13, marginBottom: 6 }}>📊 评分分层</h4>
              <ComparisonTable rows={[
                { label: '⭐ 高评分(≥80)', ...calcComparison(orders.filter(o => o.signalScore >= 80)) },
                { label: '中等(60~79)', ...calcComparison(orders.filter(o => o.signalScore >= 60 && o.signalScore < 80)) },
              ]} />
            </div>

            {/* ③ 时段对比 */}
            <div className="bt-result" style={{ marginBottom: 10 }}>
              <h4 style={{ fontSize: 13, marginBottom: 6 }}>📊 时段表现</h4>
              <ComparisonTable rows={[
                { label: '🌏 亚洲', ...calcComparison(orders.filter(o => {
                  const h = new Date(o.createdAt).getHours();
                  return h >= 8 && h < 14;
                })) },
                { label: '🌍 欧盘', ...calcComparison(orders.filter(o => {
                  const h = new Date(o.createdAt).getHours();
                  return h >= 14 && h < 20;
                })) },
                { label: '🌎 美盘', ...calcComparison(orders.filter(o => {
                  const h = new Date(o.createdAt).getHours();
                  return h >= 20 || h < 2;
                })) },
              ]} />
            </div>

            {/* 每日报告 */}
            {dailyReport && (
              <div className="bt-result">
                <h4 style={{ fontSize: 13, marginBottom: 6 }}>📋 每日报告 — {dailyReport.date}</h4>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8 }}>
                  <div>实盘: {dailyReport.realTrades.total}笔 胜率{dailyReport.realTrades.winRate}% 盈亏{dailyReport.realTrades.totalPnl.toFixed(0)}</div>
                  <div>模拟: {dailyReport.simulatedOrders.total}笔 胜率{dailyReport.simulatedOrders.winRate}%</div>
                  {dailyReport.recommendations.map((r, i) => (
                    <div key={i} style={{ color: r.includes('淘汰') ? C_BAD : C_GOOD }}>{r}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========== ④ 实验室 — 为什么赚钱 ========== */}
        {activeTab === 'lab' && (
          <div className="lab-panel">
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>🧪 条件实验室 — 找真实原因</h3>
            <p style={{ fontSize: 12, color: C_MUTED, marginBottom: 12 }}>
              分析不同条件下的交易表现，找出真正的赚钱原因
            </p>

            {/* 交叉分析表 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="bt-result">
                <h4 style={{ fontSize: 12, marginBottom: 6 }}>趋势 + 评分</h4>
                <ConditionLabTable orders={orders} />
              </div>
              <div className="bt-result">
                <h4 style={{ fontSize: 12, marginBottom: 6 }}>市场状态 + 结果</h4>
                <MarketConditionTable orders={orders} />
              </div>
            </div>

            <div style={{ fontSize: 11, color: C_MUTED, marginTop: 8, padding: 8, background: '#0d0e14', borderRadius: 6 }}>
              💡 提示：需要先运行扫描积累交易数据，实验室才能分析出有效结论
            </div>
          </div>
        )}

        {/* ========== ⑤ 风控 — 别死 ========== */}
        {activeTab === 'risk' && (
          <div className="lab-panel">
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <button className="btn-run" onClick={handleRiskCheck} style={{ padding: '5px 14px', fontSize: 12 }}>
                🛡️ 检查风控
              </button>
              <button className="btn-run" onClick={() => { resetRiskState(); setRiskState(getRiskState()); }}
                style={{ padding: '5px 14px', fontSize: 12, background: C_MUTED }}>
                🔄 重置
              </button>
            </div>

            {/* 风控仪表 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
              <StatCard label="风控状态" value={riskState.status === 'NORMAL' ? '正常' : riskState.status === 'WARNING' ? '⚠️ 警告' : '🛑 停机'}
                color={riskState.status === 'NORMAL' ? C_GOOD : riskState.status === 'WARNING' ? C_WARN : C_BAD} />
              <StatCard label="连续亏损" value={`${riskState.consecutiveLosses}次`}
                color={riskState.consecutiveLosses >= 3 ? C_BAD : C_GOOD} />
              <StatCard label="今日亏损" value={`${riskState.dailyLossPercent.toFixed(1)}%`}
                color={riskState.dailyLossPercent >= 5 ? C_BAD : C_GOOD} />
              <StatCard label="最大回撤" value={`${riskState.maxDrawdownPercent.toFixed(1)}%`}
                color={riskState.maxDrawdownPercent >= 15 ? C_BAD : riskState.maxDrawdownPercent >= 10 ? C_WARN : C_GOOD} />
            </div>

            {circuitBreaker && (
              <div style={{
                background: circuitBreaker.shouldStop ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                border: `1px solid ${circuitBreaker.shouldStop ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                borderRadius: 8, padding: 12, marginBottom: 12,
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: circuitBreaker.shouldStop ? C_BAD : C_GOOD, marginBottom: 4 }}>
                  {circuitBreaker.shouldStop ? '🔴 触发停机' : '🟢 风控正常'}
                </div>
                {circuitBreaker.reasons.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#94a3b8' }}>{r}</div>
                ))}
                <div style={{ fontSize: 12, color: C_WARN, marginTop: 4 }}>
                  建议: {circuitBreaker.recommendedAction === 'STOP' ? '停止交易' : circuitBreaker.recommendedAction === 'REDUCE' ? '降低仓位' : '继续'}
                </div>
              </div>
            )}

            {/* 紧急按钮 */}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>🛑 紧急控制</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleToggle}
                  style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: C_BAD, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  🛑 强制停止引擎
                </button>
                <button onClick={() => { resetRiskState(); alert('风控已重置'); }}
                  style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #2d2e3d', background: 'transparent', color: C_WARN, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  🔒 重置风控
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== ⑥ 复盘 — 怎么变强 ========== */}
        {activeTab === 'trades' && (
          <div className="lab-panel">
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>📋 交易记录 / 复盘</h3>

            {/* 统计摘要 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 6, marginBottom: 12 }}>
              <StatCard label="总交易" value={`${account.totalTrades}`} />
              <StatCard label="胜" value={`${account.winCount}`} color={C_LONG} />
              <StatCard label="负" value={`${account.lossCount}`} color={C_SHORT} />
              <StatCard label="胜率" value={account.totalTrades > 0 ? `${Math.round(account.winCount / account.totalTrades * 100)}%` : '0%'}
                color={C_INFO} />
              <StatCard label="总盈亏" value={`${account.totalPnl >= 0 ? '+' : ''}${account.totalPnl.toFixed(0)}`}
                color={account.totalPnl >= 0 ? C_LONG : C_SHORT} />
              <StatCard label="手续费" value={`${account.totalFeesPaid.toFixed(2)}`} color={C_MUTED} />
            </div>

            {/* 交易明细 */}
            <div className="table-container">
              <table className="trades-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>时间</th><th>类型</th><th>金额</th><th>描述</th>
                  </tr>
                </thead>
                <tbody>
                  {accountHistory.slice(0, 50).map((e, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 11, color: C_MUTED }}>{new Date(e.timestamp).toLocaleString('zh-CN')}</td>
                      <td>
                        <Badge label={e.type} color={
                          e.type === 'REALIZED_PNL' ? (e.amount >= 0 ? C_LONG : C_SHORT)
                            : e.type === 'FEE' ? C_MUTED : C_INFO
                        } />
                      </td>
                      <td style={{ fontWeight: 600, color: e.amount >= 0 ? C_LONG : C_SHORT }}>
                        {e.amount >= 0 ? '+' : ''}{e.amount.toFixed(2)}
                      </td>
                      <td style={{ color: '#94a3b8', fontSize: 11 }}>{e.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========== ⑦ 回测 — 验证 ========== */}
        {activeTab === 'backtest' && (
          <div className="lab-panel">
            <div className="bt-config" style={{ marginBottom: 12, padding: 12 }}>
              <div className="config-grid" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                <div className="config-field">
                  <label>品种</label>
                  <input value={btSymbol} onChange={(e) => setBtSymbol(e.target.value.toUpperCase())} placeholder="BTCUSDT" style={{ background: '#11121a', border: '1px solid #2d2e3d', borderRadius: 4, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }} />
                </div>
                <div className="config-field">
                  <label>天数</label>
                  <select value={btDays} onChange={(e) => setBtDays(Number(e.target.value))}
                    style={{ background: '#11121a', border: '1px solid #2d2e3d', borderRadius: 4, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}>
                    <option value={7}>7天</option>
                    <option value={15}>15天</option>
                    <option value={30}>30天</option>
                    <option value={60}>60天</option>
                    <option value={90}>90天</option>
                  </select>
                </div>
                <button className="btn-run" onClick={handleBacktest} disabled={backtesting} style={{ alignSelf: 'flex-end' }}>
                  {backtesting ? '⏳' : '▶ 运行回测'}
                </button>
              </div>
            </div>

            {backtestResult && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 6, marginBottom: 12 }}>
                  <StatCard label="交易" value={`${backtestResult.totalTrades}`} />
                  <StatCard label="胜率" value={`${backtestResult.winRate}%`} color={backtestResult.winRate >= 50 ? C_LONG : C_SHORT} />
                  <StatCard label="盈亏比" value={`${backtestResult.profitFactor.toFixed(2)}`} color={backtestResult.profitFactor >= 1.5 ? C_GOOD : C_WARN} />
                  <StatCard label="期望值" value={`${backtestResult.expectancy >= 0 ? '+' : ''}${backtestResult.expectancy.toFixed(2)}`} color={backtestResult.expectancy > 0 ? C_GOOD : C_BAD} />
                  <StatCard label="净盈亏" value={`${backtestResult.netPnl >= 0 ? '+' : ''}${backtestResult.netPnl}`} color={backtestResult.netPnl >= 0 ? C_LONG : C_SHORT} />
                  <StatCard label="最大回撤" value={`${backtestResult.maxDrawdown}%`} color={backtestResult.maxDrawdown >= 15 ? C_BAD : C_WARN} />
                </div>

                {backtestResult.equityCurve.length > 0 && (
                  <div className="chart-card" style={{ marginBottom: 10 }}>
                    <h4 style={{ fontSize: 13 }}>权益曲线</h4>
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={backtestResult.equityCurve.filter((_, i) => i % Math.max(1, Math.floor(backtestResult.equityCurve.length / 60)) === 0)}>
                        <defs><linearGradient id="btEq" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
                        <XAxis dataKey="bar" stroke="#64748b" fontSize={9} />
                        <YAxis stroke="#64748b" fontSize={9} domain={['auto', 'auto']} />
                        <Tooltip contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d', color: '#e2e8f0' }} />
                        <Area type="monotone" dataKey="equity" stroke="#22c55e" fill="url(#btEq)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="bt-result" style={{ marginBottom: 8 }}>
                  <h4 style={{ fontSize: 12, marginBottom: 4 }}>策略对比</h4>
                  <ComparisonTable rows={[
                    { label: '高评分(≥80)', ...calcComparison(backtestResult.trades.filter(t => t.signalScore >= 80)) },
                    { label: '普通(60~79)', ...calcComparison(backtestResult.trades.filter(t => t.signalScore >= 60 && t.signalScore < 80)) },
                  ]} />
                </div>

                <div className="bt-result">
                  <h4 style={{ fontSize: 12, marginBottom: 4 }}>市场状态对比</h4>
                  <ComparisonTable rows={[
                    { label: '📈 趋势', ...calcComparison(backtestResult.trades.filter(t => t.marketState === 'TRENDING')) },
                    { label: '➡️ 震荡', ...calcComparison(backtestResult.trades.filter(t => t.marketState === 'CONSOLIDATING')) },
                    { label: '🔥 爆发', ...calcComparison(backtestResult.trades.filter(t => t.marketState === 'EXPLOSIVE')) },
                  ]} />
                </div>
              </>
            )}
          </div>
        )}

        {/* ========== ⑧ 设置 — 控制 ========== */}
        {activeTab === 'settings' && (
          <div className="lab-panel">
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>⚙️ 系统控制</h3>

            {/* 引擎状态 */}
            <div className="bt-result" style={{ marginBottom: 12 }}>
              <h4 style={{ fontSize: 13, marginBottom: 8 }}>引擎状态</h4>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8 }}>
                <div>连接: {engineConnected ? '🟢 已连接' : '🔴 离线'}</div>
                <div>运行: {engineRunning ? '🟢 运行中' : '⏹ 已停止'}</div>
                <div>后端地址: ws://localhost:3001</div>
                <div>品种: BTCUSDT, ETHUSDT, SOLUSDT (5m)</div>
              </div>
            </div>

            {/* 账户重置 */}
            <div className="bt-result">
              <h4 style={{ fontSize: 13, marginBottom: 8 }}>模拟账户</h4>
              <button onClick={() => engineApi.resetAccount().then(pullData)}
                style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#f59e0b', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                🔄 重置账户为 10,000 USDT
              </button>
              <div style={{ fontSize: 11, color: C_MUTED, marginTop: 6 }}>
                当前余额: {account.currentBalance.toFixed(0)} USDT
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 辅助组件 ====================

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <table className="trades-table" style={{ fontSize: 12 }}>
      <thead>
        <tr>
          <th>条件</th><th>笔数</th><th>胜率</th><th>盈亏比</th><th>期望值</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ fontWeight: 600 }}>{r.label}</td>
            <td>{r.totalTrades}</td>
            <td style={{ fontWeight: 600, color: r.winRate >= 50 ? C_LONG : C_SHORT }}>{r.winRate}%</td>
            <td>{r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)}</td>
            <td style={{ fontWeight: 700, color: r.expectancy > 0 ? C_GOOD : C_BAD }}>
              {r.expectancy >= 0 ? '+' : ''}{r.expectancy.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function calcComparison(trades: { pnl?: number; signalScore?: number }[]): {
  totalTrades: number; winRate: number; avgWin: number; avgLoss: number;
  profitFactor: number; expectancy: number; netPnl: number;
} {
  const closed = trades.filter(t => t.pnl !== undefined);
  const total = closed.length;
  if (total === 0) return { totalTrades: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, expectancy: 0, netPnl: 0 };
  const wins = closed.filter(t => (t.pnl ?? 0) > 0);
  const losses = closed.filter(t => (t.pnl ?? 0) <= 0);
  const winRate = (wins.length / total) * 100;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0)) / losses.length : 0;
  const pf = avgLoss > 0 ? (wins.length * avgWin) / (losses.length * avgLoss) : wins.length > 0 ? Infinity : 0;
  const exp = (winRate / 100 * avgWin) - ((total - wins.length) / total * avgLoss);
  return {
    totalTrades: total, winRate: Math.round(winRate * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100, avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(pf * 100) / 100, expectancy: Math.round(exp * 100) / 100,
    netPnl: Math.round(closed.reduce((s, t) => s + (t.pnl ?? 0), 0) * 100) / 100,
  };
}

function ConditionLabTable({ orders }: { orders: any[] }) {
  const groups = [
    { label: '趋势 + 高评分≥80', filter: (o: any) => o.engineType === 'STABLE' && o.signalScore >= 80 },
    { label: '趋势 + 普通评分', filter: (o: any) => o.engineType === 'STABLE' && o.signalScore < 80 },
    { label: '突破 + 高评分≥80', filter: (o: any) => o.engineType === 'AGGRESSIVE' && o.signalScore >= 80 },
    { label: '突破 + 低评分', filter: (o: any) => o.engineType === 'AGGRESSIVE' && o.signalScore < 80 },
  ];
  return (
    <table className="trades-table" style={{ fontSize: 11 }}>
      <thead><tr><th>组合</th><th>笔数</th><th>期望值</th></tr></thead>
      <tbody>
        {groups.map((g) => {
          const gTrades = orders.filter(g.filter);
          const total = gTrades.length;
          const wins = gTrades.filter((t: any) => (t.pnl ?? 0) > 0);
          const winRate = total > 0 ? (wins.length / total) * 100 : 0;
          const avgWin = wins.length > 0 ? wins.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0) / wins.length : 0;
          const avgLoss = (total - wins.length) > 0 ? Math.abs(gTrades.filter((t: any) => (t.pnl ?? 0) <= 0).reduce((s: number, t: any) => s + (t.pnl ?? 0), 0)) / (total - wins.length) : 0;
          const exp = (winRate / 100 * avgWin) - ((total - wins.length) / total * avgLoss);
          return (
            <tr key={g.label}>
              <td style={{ fontSize: 10 }}>{g.label}</td>
              <td>{total}</td>
              <td style={{ fontWeight: 700, color: exp > 0 ? C_GOOD : C_BAD }}>
                {exp >= 0 ? '+' : ''}{exp.toFixed(2)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MarketConditionTable({ orders }: { orders: any[] }) {
  const marketStates = [...new Set(orders.map((o) => o.marketState).filter(Boolean))];
  return (
    <table className="trades-table" style={{ fontSize: 11 }}>
      <thead><tr><th>市场状态</th><th>笔数</th><th>胜率</th><th>期望值</th></tr></thead>
      <tbody>
        {marketStates.map((state) => {
          const gTrades = orders.filter((o) => o.marketState === state);
          const total = gTrades.length;
          const wins = gTrades.filter((t: any) => (t.pnl ?? 0) > 0);
          const winRate = total > 0 ? (wins.length / total) * 100 : 0;
          const avgWin = wins.length > 0 ? wins.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0) / wins.length : 0;
          const avgLoss = (total - wins.length) > 0 ? Math.abs(gTrades.filter((t: any) => (t.pnl ?? 0) <= 0).reduce((s: number, t: any) => s + (t.pnl ?? 0), 0)) / (total - wins.length) : 0;
          const exp = (winRate / 100 * avgWin) - ((total - wins.length) / total * avgLoss);
          return (
            <tr key={state}>
              <td>{state}</td>
              <td>{total}</td>
              <td style={{ color: winRate >= 50 ? C_LONG : C_SHORT, fontWeight: 600 }}>{Math.round(winRate)}%</td>
              <td style={{ fontWeight: 700, color: exp > 0 ? C_GOOD : C_BAD }}>{exp >= 0 ? '+' : ''}{exp.toFixed(2)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
