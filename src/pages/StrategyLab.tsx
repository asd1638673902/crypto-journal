/**
 * 策略实验室页面
 * 回测 + 参数优化 + 风险管理 + 脚本 + 交易计划
 */

import { useState, useMemo, useCallback } from 'react';
import { fetchKlines, type KlineInterval } from '../lib/exchange';
import { getStrategies } from '../lib/db';
import { runBacktest, type BacktestConfig } from '../lib/backtest';
import { gridSearch, type ParamRange, type OptimizeTarget, getTargetLabel } from '../lib/optimizer';
import { calcPositionSize, simulateConsecutiveLosses } from '../lib/riskManager';
import type { BacktestResult } from '../lib/strategyMetrics';
import StrategyScriptEditor from '../components/StrategyScriptEditor';
import BacktestComparison from '../components/BacktestComparison';
import TradePlanPanel from '../components/TradePlanPanel';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import './StrategyLab.css';

type Tab = 'backtest' | 'optimize' | 'risk' | 'script' | 'plan';

export default function StrategyLab() {
  const [activeTab, setActiveTab] = useState<Tab>('backtest');
  const strategies = useMemo(() => getStrategies().filter((s) => s.isActive), []);

  return (
    <div className="strategylab-page">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">策略实验室</h1>
          <p className="page-subtitle">
            回测 · 优化 · 风控 · 脚本 · 计划
            {strategies.length > 0 && (
              <span className="source-tag info">{strategies.length} 个可用策略</span>
            )}
          </p>
        </div>
      </div>

      {/* 标签页导航 */}
      <div className="lab-tabs">
        <button className={`lab-tab ${activeTab === 'backtest' ? 'active' : ''}`} onClick={() => setActiveTab('backtest')}>
          📈 策略回测
        </button>
        <button className={`lab-tab ${activeTab === 'optimize' ? 'active' : ''}`} onClick={() => setActiveTab('optimize')}>
          🔬 参数优化
        </button>
        <button className={`lab-tab ${activeTab === 'risk' ? 'active' : ''}`} onClick={() => setActiveTab('risk')}>
          🛡️ 风险管理
        </button>
        <button className={`lab-tab ${activeTab === 'script' ? 'active' : ''}`} onClick={() => setActiveTab('script')}>
          📝 策略脚本
        </button>
        <button className={`lab-tab ${activeTab === 'plan' ? 'active' : ''}`} onClick={() => setActiveTab('plan')}>
          📝 交易计划
        </button>
      </div>

      <div className="lab-content">
        {activeTab === 'backtest' && <BacktestPanel strategies={strategies} />}
        {activeTab === 'optimize' && <OptimizePanel strategies={strategies} />}
        {activeTab === 'risk' && <RiskPanel />}
        {activeTab === 'script' && <ScriptPanel />}
        {activeTab === 'plan' && <TradePlanPanel />}
      </div>
    </div>
  );
}

// ==================== 回测面板 ====================

function BacktestPanel({ strategies: _strategies }: { strategies: { id: string; name: string }[] }) {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState<KlineInterval>('1h');
  const [days, setDays] = useState(30);
  const [entryType, setEntryType] = useState<BacktestConfig['entryRules']['type']>('SMA_CROSS');
  const [smaFast, setSmaFast] = useState(10);
  const [smaSlow, setSmaSlow] = useState(30);
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [rsiThreshold, setRsiThreshold] = useState(30);
  const [slPct, setSlPct] = useState(2);
  const [tpPct, setTpPct] = useState(4);
  const [initialCapital, setInitialCapital] = useState(10000);
  const [riskEnabled, setRiskEnabled] = useState(false);
  const [riskPerTrade, setRiskPerTrade] = useState(1);
  const [riskLeverage, setRiskLeverage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedResults, setSavedResults] = useState<{ id: string; label: string; result: BacktestResult }[]>([]);

  const addToComparison = useCallback(() => {
    if (!result) return;
    const label = `${symbol} ${entryType} (${slPct}%SL/${tpPct}%TP)`;
    setSavedResults((prev) => [...prev, { id: Date.now().toString(36), label, result }]);
  }, [result, symbol, entryType, slPct, tpPct]);

  const handleRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const endTime = Date.now();
      const startTime = endTime - days * 24 * 60 * 60 * 1000;
      const klines = await fetchKlines({ symbol, interval, startTime, endTime, limit: 1000 });

      if (klines.length === 0) {
        setError('未获取到K线数据');
        return;
      }

      const config: BacktestConfig = {
        symbol,
        interval,
        entryRules: {
          type: entryType,
          params: {
            smaFast,
            smaSlow,
            rsiPeriod,
            rsiThreshold,
          },
        },
        exitRules: { type: 'FIXED_STOP', params: {} },
        stopLossPercent: slPct,
        takeProfitPercent: tpPct,
        direction: 'LONG',
        riskConfig: riskEnabled && slPct > 0 ? {
          riskPerTradePercent: riskPerTrade,
          leverage: riskLeverage,
        } : undefined,
      };

      const btResult = runBacktest(klines, config, initialCapital);
      setResult(btResult);
    } catch (err: any) {
      setError(err.message || '回测执行失败');
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, days, entryType, smaFast, smaSlow, rsiPeriod, rsiThreshold, slPct, tpPct, initialCapital, riskEnabled, riskPerTrade, riskLeverage]);

  const getColor = (v: number, good: number) => v >= good ? '#22c55e' : '#ef4444';

  return (
    <div className="lab-panel">
      {/* 配置区 */}
      <div className="bt-config">
        <div className="config-grid">
          <div className="config-field">
            <label>品种</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </div>
          <div className="config-field">
            <label>周期</label>
            <select value={interval} onChange={(e) => setInterval(e.target.value as KlineInterval)}>
              <option value="15m">15分钟</option>
              <option value="1h">1小时</option>
              <option value="4h">4小时</option>
              <option value="1d">日线</option>
            </select>
          </div>
          <div className="config-field">
            <label>回测天数</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>7天</option>
              <option value={14}>14天</option>
              <option value={30}>30天</option>
              <option value={60}>60天</option>
              <option value={90}>90天</option>
            </select>
          </div>
          <div className="config-field">
            <label>入场策略</label>
            <select value={entryType} onChange={(e) => setEntryType(e.target.value as any)}>
              <option value="SMA_CROSS">SMA 金叉</option>
              <option value="RSI_OVERSOLD">RSI 超卖</option>
              <option value="MACD_CROSS">MACD 金叉</option>
              <option value="BB_BOUNCE">布林带下轨反弹</option>
            </select>
          </div>
          {entryType === 'SMA_CROSS' && (
            <>
              <div className="config-field">
                <label>快线SMA</label>
                <input type="number" value={smaFast} onChange={(e) => setSmaFast(Number(e.target.value))} />
              </div>
              <div className="config-field">
                <label>慢线SMA</label>
                <input type="number" value={smaSlow} onChange={(e) => setSmaSlow(Number(e.target.value))} />
              </div>
            </>
          )}
          {entryType === 'RSI_OVERSOLD' && (
            <>
              <div className="config-field">
                <label>RSI周期</label>
                <input type="number" value={rsiPeriod} onChange={(e) => setRsiPeriod(Number(e.target.value))} />
              </div>
              <div className="config-field">
                <label>超卖阈值</label>
                <input type="number" value={rsiThreshold} onChange={(e) => setRsiThreshold(Number(e.target.value))} />
              </div>
            </>
          )}
          <div className="config-field">
            <label>止损 (%)</label>
            <input type="number" value={slPct} onChange={(e) => setSlPct(Number(e.target.value))} />
          </div>
            <div className="config-field">
            <label>止盈 (%)</label>
            <input type="number" value={tpPct} onChange={(e) => setTpPct(Number(e.target.value))} />
          </div>
          <div className="config-field">
            <label>初始资金 (USDT)</label>
            <input type="number" value={initialCapital} onChange={(e) => setInitialCapital(Math.max(100, Number(e.target.value)))} min={100} step={1000} />
          </div>
          <div className="config-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ marginBottom: 0 }}>风控仓位</label>
            <input type="checkbox" checked={riskEnabled} onChange={(e) => setRiskEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
          </div>
          {riskEnabled && slPct > 0 && (
            <>
              <div className="config-field">
                <label>每笔风险 (%)</label>
                <input type="number" value={riskPerTrade} onChange={(e) => setRiskPerTrade(Math.max(0.1, Number(e.target.value)))} min={0.1} step={0.1} />
              </div>
              <div className="config-field">
                <label>杠杆</label>
                <select value={riskLeverage} onChange={(e) => setRiskLeverage(Number(e.target.value))}>
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={3}>3x</option>
                  <option value={5}>5x</option>
                  <option value={10}>10x</option>
                </select>
              </div>
            </>
          )}
        </div>
        <button className="btn-run" onClick={handleRun} disabled={loading}>
          {loading ? '⏳ 回测中...' : '🚀 运行回测'}
        </button>
      </div>

      {/* 错误 */}
      {error && <div className="status-bar error">{error}</div>}

      {/* 回测结果 */}
      {result && (
        <>
        <div className="bt-result">
          <h3>回测报告 — {result.symbol} ({result.interval})</h3>
          <p className="result-period">
            {new Date(result.startTime).toLocaleDateString('zh-CN')} → {new Date(result.endTime).toLocaleDateString('zh-CN')}
            &nbsp;|&nbsp; {result.totalBars} 根K线 &nbsp;|&nbsp; {result.totalTrades} 笔交易
          </p>

          {/* 核心指标 */}
          <div className="metrics-grid">
            <div className="metric-card">
              <span className="metric-value" style={{ color: getColor(result.totalPnlPercent, 0) }}>
                {result.totalPnlPercent >= 0 ? '+' : ''}{result.totalPnlPercent.toFixed(2)}%
              </span>
              <span className="metric-label">总收益率</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: result.totalPnlUsdt >= 0 ? '#ef4444' : '#22c55e' }}>
                {result.totalPnlUsdt >= 0 ? '+' : ''}{result.totalPnlUsdt.toFixed(2)}
              </span>
              <span className="metric-label">总盈亏 (USDT)</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: getColor(result.winRate, 50) }}>
                {result.winRate.toFixed(1)}%
              </span>
              <span className="metric-label">胜率 ({result.wins}/{result.totalTrades})</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: getColor(result.profitFactor, 1.5) }}>
                {result.profitFactor === Infinity ? '∞' : result.profitFactor.toFixed(2)}
              </span>
              <span className="metric-label">盈亏比</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: getColor(result.sharpeRatio, 1) }}>
                {result.sharpeRatio.toFixed(2)}
              </span>
              <span className="metric-label">夏普比率</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: getColor(result.sortinoRatio, 1) }}>
                {result.sortinoRatio.toFixed(2)}
              </span>
              <span className="metric-label">索提诺比率</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: result.calmarRatio >= 1 ? '#22c55e' : '#f59e0b' }}>
                {result.calmarRatio.toFixed(2)}
              </span>
              <span className="metric-label">卡玛比率</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: '#ef4444' }}>
                -{result.maxDrawdownPercent.toFixed(2)}%
              </span>
              <span className="metric-label">最大回撤</span>
            </div>
            <div className="metric-card">
              <span className="metric-value">{result.expectancy.toFixed(2)}%</span>
              <span className="metric-label">期望值/笔</span>
            </div>
            <div className="metric-card">
              <span className="metric-value">{result.avgHoldingMinutes.toFixed(0)}m</span>
              <span className="metric-label">平均持仓</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: '#22c55e' }}>
                +{result.bestTrade.toFixed(2)}%
              </span>
              <span className="metric-label">最佳交易</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: '#ef4444' }}>
                {result.worstTrade.toFixed(2)}%
              </span>
              <span className="metric-label">最差交易</span>
            </div>
            <div className="metric-card">
              <span className="metric-value">{result.avgPnl.toFixed(2)}%</span>
              <span className="metric-label">均盈亏</span>
            </div>
          </div>

          {/* 权益曲线（USDT） */}

          {/* 权益曲线（USDT） */}
          {result.equityUsdtCurve.length > 0 && (
            <>
              <div className="chart-card" style={{ marginTop: 16 }}>
                <h4>权益曲线 (USDT) — 初始资金 {result.initialCapital.toLocaleString()} USDT</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={result.equityUsdtCurve}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
                    <XAxis dataKey="trade" stroke="#64748b" fontSize={10} />
                    <YAxis stroke="#64748b" fontSize={10} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}K` : v.toFixed(0)} />
                    <Tooltip contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d', color: '#e2e8f0' }} formatter={(v: any) => [`${Number(v).toFixed(2)} USDT`, '权益']} />
                    <Area type="monotone" dataKey="equity" stroke="#3b82f6" fill="url(#eqGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* 月度盈亏 */}
              {result.monthlyBreakdown.length > 0 && (
                <div className="chart-card" style={{ marginTop: 16 }}>
                  <h4>月度盈亏</h4>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={result.monthlyBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
                      <XAxis dataKey="month" stroke="#64748b" fontSize={10} />
                      <YAxis stroke="#64748b" fontSize={10} />
                      <Tooltip contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d', color: '#e2e8f0' }} />
                      <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                        {result.monthlyBreakdown.map((_entry, idx) => (
                          <rect key={idx} /> // Cell replaced for simplicity
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 交易明细 */}
              <div className="bt-trades" style={{ marginTop: 16 }}>
                <h4>交易明细</h4>
                <div className="table-container">
                  <table className="trades-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>方向</th>
                        <th>入场价</th>
                        <th>出场价</th>
                        <th>盈亏%</th>
                        <th>持有K线</th>
                        <th>出场原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(0, 50).map((t, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>
                            <span className={`dir-badge ${t.direction.toLowerCase()}`}>
                              {t.direction === 'LONG' ? '多' : '空'}
                            </span>
                          </td>
                          <td>{t.entryPrice.toFixed(2)}</td>
                          <td>{t.exitPrice.toFixed(2)}</td>
                          <td style={{ color: t.pnlPercent >= 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                            {t.pnlPercent >= 0 ? '+' : ''}{t.pnlPercent.toFixed(2)}%
                          </td>
                          <td>{t.holdingBars}</td>
                          <td>
                            <span className={`exit-reason ${t.exitReason}`}>
                              {t.exitReason === 'stop_loss' ? '止损' : t.exitReason === 'take_profit' ? '止盈' : '信号'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {result.trades.length > 50 && (
                        <tr><td colSpan={7} style={{ textAlign: 'center', color: '#64748b' }}>...还有 {result.trades.length - 50} 笔</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 添加到对比 */}
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <button
            className="btn-compare-add"
            onClick={addToComparison}
            style={{
              background: 'rgba(139, 92, 246, 0.1)',
              color: '#8b5cf6',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              padding: '6px 14px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            + 添加到对比
          </button>
        </div>
        </>
      )}

      {/* 对比面板 */}
      <BacktestComparison
        entries={savedResults}
        onRemove={(id) => setSavedResults((prev) => prev.filter((e) => e.id !== id))}
        onClearAll={() => setSavedResults([])}
      />
    </div>
  );
}

// ==================== 优化面板 ====================

function OptimizePanel({ strategies: _strategies }: { strategies: { id: string; name: string }[] }) {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState<KlineInterval>('1h');
  const [days, setDays] = useState(30);
  const [param1, setParam1] = useState('smaFast');
  const [range1, setRange1] = useState('5,10,15,20');
  const [param2, setParam2] = useState('smaSlow');
  const [range2, setRange2] = useState('20,30,40,50');
  const [slPct, setSlPct] = useState(2);
  const [tpPct, setTpPct] = useState(4);
  const [target, setTarget] = useState<OptimizeTarget>('sharpeRatio');

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Awaited<ReturnType<typeof gridSearch>>>([]);
  const [error, setError] = useState<string | null>(null);

  const handleOptimize = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const endTime = Date.now();
      const startTime = endTime - days * 24 * 60 * 60 * 1000;
      const klines = await fetchKlines({ symbol, interval, startTime, endTime, limit: 1000 });

      if (klines.length === 0) {
        setError('未获取到K线数据');
        return;
      }

      const p1 = range1.split(',').map(Number).filter((n) => !isNaN(n));
      const p2 = range2.split(',').map(Number).filter((n) => !isNaN(n));

      const paramRanges: ParamRange[] = [
        { param: param1, values: p1 },
        { param: param2, values: p2 },
        { param: 'stopLossPercent', values: [slPct] },
        { param: 'takeProfitPercent', values: [tpPct] },
      ];

      const sorted = gridSearch(klines, { symbol, interval, direction: 'LONG' }, paramRanges, target, 20);
      setResults(sorted);
    } catch (err: any) {
      setError(err.message || '优化失败');
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, days, param1, range1, param2, range2, slPct, tpPct, target]);

  return (
    <div className="lab-panel">
      <div className="bt-config">
        <div className="config-grid">
          <div className="config-field">
            <label>品种</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </div>
          <div className="config-field">
            <label>周期</label>
            <select value={interval} onChange={(e) => setInterval(e.target.value as KlineInterval)}>
              <option value="1h">1小时</option>
              <option value="4h">4小时</option>
              <option value="1d">日线</option>
            </select>
          </div>
          <div className="config-field">
            <label>天数</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={14}>14天</option>
              <option value={30}>30天</option>
              <option value={60}>60天</option>
            </select>
          </div>
          <div className="config-field">
            <label>参数1</label>
            <input value={param1} onChange={(e) => setParam1(e.target.value)} placeholder="参数名" />
          </div>
          <div className="config-field">
            <label>参数1取值</label>
            <input value={range1} onChange={(e) => setRange1(e.target.value)} placeholder="逗号分隔" />
          </div>
          <div className="config-field">
            <label>参数2</label>
            <input value={param2} onChange={(e) => setParam2(e.target.value)} placeholder="参数名" />
          </div>
          <div className="config-field">
            <label>参数2取值</label>
            <input value={range2} onChange={(e) => setRange2(e.target.value)} placeholder="逗号分隔" />
          </div>
          <div className="config-field">
            <label>止损%</label>
            <input type="number" value={slPct} onChange={(e) => setSlPct(Number(e.target.value))} />
          </div>
          <div className="config-field">
            <label>止盈%</label>
            <input type="number" value={tpPct} onChange={(e) => setTpPct(Number(e.target.value))} />
          </div>
          <div className="config-field">
            <label>优化目标</label>
            <select value={target} onChange={(e) => setTarget(e.target.value as OptimizeTarget)}>
              <option value="sharpeRatio">夏普比率</option>
              <option value="profitFactor">盈亏比</option>
              <option value="totalPnlPercent">总收益率</option>
              <option value="winRate">胜率</option>
            </select>
          </div>
        </div>
        <button className="btn-run" onClick={handleOptimize} disabled={loading}>
          {loading ? '⏳ 运行中...' : '🔬 开始优化'}
        </button>
        {loading && <p className="optimizing-hint">正在测试 {results.length > 0 ? results.length : '...'} 种参数组合...</p>}
      </div>

      {error && <div className="status-bar error">{error}</div>}

      {results.length > 0 && (
        <div className="opt-results">
          <h3>优化结果 (按 {getTargetLabel(target)} 排序)</h3>
          <div className="table-container">
            <table className="trades-table">
              <thead>
                <tr>
                  <th>排名</th>
                  {Object.keys(results[0].params).map((k) => <th key={k}>{k}</th>)}
                  <th>总收益率</th>
                  <th>胜率</th>
                  <th>盈亏比</th>
                  <th>夏普</th>
                  <th>回撤</th>
                  <th>交易数</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.rank}>
                    <td style={{ fontWeight: 700, color: r.rank <= 3 ? '#f59e0b' : '#94a3b8' }}>#{r.rank}</td>
                    {Object.values(r.params).map((v, i) => <td key={i}>{v}</td>)}
                    <td style={{ color: r.metrics.totalPnlPercent >= 0 ? '#ef4444' : '#22c55e' }}>
                      {r.metrics.totalPnlPercent.toFixed(1)}%
                    </td>
                    <td>{r.metrics.winRate.toFixed(0)}%</td>
                    <td>{r.metrics.profitFactor === Infinity ? '∞' : r.metrics.profitFactor.toFixed(2)}</td>
                    <td>{r.metrics.sharpeRatio.toFixed(2)}</td>
                    <td style={{ color: '#ef4444' }}>-{r.metrics.maxDrawdownPercent.toFixed(1)}%</td>
                    <td>{r.metrics.totalTrades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 风险管理面板 ====================

function RiskPanel() {
  const [balance, setBalance] = useState(10000);
  const [entryPrice, setEntryPrice] = useState(65000);
  const [stopPrice, setStopPrice] = useState(63000);
  const [riskPct, setRiskPct] = useState(1);
  const [leverage, setLeverage] = useState(1);
  const [winRate, setWinRate] = useState(60);
  const [avgWin, setAvgWin] = useState(500);
  const [avgLoss, setAvgLoss] = useState(300);
  const [lossPct, setLossPct] = useState(2);
  const [maxLosses, setMaxLosses] = useState(10);

  const posSize = calcPositionSize(balance, entryPrice, stopPrice, riskPct, leverage);
  const kelly = avgLoss > 0 ? (() => {
    const wr = winRate / 100;
    const b = avgWin / avgLoss;
    const q = 1 - wr;
    const k = Math.max(0, Math.min((wr * b - q) / b, 0.25));
    return {
      kellyPercent: Math.round(k * 10000) / 100,
      halfKellyPercent: Math.round((k / 2) * 10000) / 100,
      quarterKellyPercent: Math.round((k / 4) * 10000) / 100,
    };
  })() : null;

  const lossSim = simulateConsecutiveLosses(balance, lossPct, maxLosses);

  return (
    <div className="lab-panel">
      <div className="risk-grid">
        {/* 仓位计算器 */}
        <div className="detail-card">
          <h3>仓位计算器</h3>
          <div className="config-grid">
            <div className="config-field">
              <label>账户总额 (USDT)</label>
              <input type="number" value={balance} onChange={(e) => setBalance(Number(e.target.value))} />
            </div>
            <div className="config-field">
              <label>入场价格</label>
              <input type="number" value={entryPrice} onChange={(e) => setEntryPrice(Number(e.target.value))} />
            </div>
            <div className="config-field">
              <label>止损价格</label>
              <input type="number" value={stopPrice} onChange={(e) => setStopPrice(Number(e.target.value))} />
            </div>
            <div className="config-field">
              <label>每笔风险 (%)</label>
              <input type="number" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} />
            </div>
            <div className="config-field">
              <label>杠杆</label>
              <input type="number" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} />
            </div>
          </div>
          {posSize && (
            <div className="position-result">
              <div className="result-row">
                <span>开仓数量</span><span className="value">{posSize.positionSize}</span>
              </div>
              <div className="result-row">
                <span>仓位价值</span><span className="value">{posSize.positionValue} USDT</span>
              </div>
              <div className="result-row">
                <span>所需保证金</span><span className="value">{posSize.marginRequired} USDT</span>
              </div>
              <div className="result-row highlight">
                <span>💸 风险敞口</span><span className="value" style={{ color: '#ef4444' }}>{posSize.riskAmount} USDT ({posSize.riskPercent}%)</span>
              </div>
              <div className="result-row">
                <span>止损距离</span><span className="value">{posSize.stopDistance} ({posSize.stopDistancePercent}%)</span>
              </div>
              <div className="result-row highlight">
                <span>⚖️ 风险回报比</span><span className="value" style={{ color: '#f59e0b', fontWeight: 700 }}>1 : {posSize.rrRatio}</span>
              </div>
            </div>
          )}
        </div>

        {/* 凯利公式 */}
        <div className="detail-card">
          <h3>凯利公式</h3>
          <div className="config-grid">
            <div className="config-field">
              <label>胜率 (%)</label>
              <input type="number" value={winRate} onChange={(e) => setWinRate(Number(e.target.value))} max={99} />
            </div>
            <div className="config-field">
              <label>平均盈利 (USDT)</label>
              <input type="number" value={avgWin} onChange={(e) => setAvgWin(Number(e.target.value))} />
            </div>
            <div className="config-field">
              <label>平均亏损 (USDT)</label>
              <input type="number" value={avgLoss} onChange={(e) => setAvgLoss(Number(e.target.value))} />
            </div>
          </div>
          {kelly && (
            <div className="position-result">
              <div className="result-row highlight">
                <span>🎯 凯利比例</span><span className="value" style={{ color: '#f59e0b', fontWeight: 700 }}>{kelly.kellyPercent}%</span>
              </div>
              <div className="result-row">
                <span>半凯利 (推荐)</span><span className="value" style={{ color: '#22c55e' }}>{kelly.halfKellyPercent}%</span>
              </div>
              <div className="result-row">
                <span>四分之一凯利 (保守)</span><span className="value">{kelly.quarterKellyPercent}%</span>
              </div>
            </div>
          )}
        </div>

        {/* 连续亏损模拟 */}
        <div className="detail-card full-width">
          <h3>连续亏损模拟</h3>
          <div className="config-grid">
            <div className="config-field">
              <label>初始资金</label>
              <input type="number" value={balance} onChange={(e) => setBalance(Number(e.target.value))} />
            </div>
            <div className="config-field">
              <label>单笔亏损 (%)</label>
              <input type="number" value={lossPct} onChange={(e) => setLossPct(Number(e.target.value))} />
            </div>
            <div className="config-field">
              <label>最大连续亏损</label>
              <input type="number" value={maxLosses} onChange={(e) => setMaxLosses(Number(e.target.value))} />
            </div>
          </div>
          {lossSim.length > 0 && (
            <div className="table-container">
              <table className="trades-table">
                <thead>
                  <tr>
                    <th>次数</th>
                    <th>亏损金额</th>
                    <th>剩余资金</th>
                    <th>总亏损占初始%</th>
                  </tr>
                </thead>
                <tbody>
                  {lossSim.map((r, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td style={{ color: '#ef4444' }}>-{r.lossAmount.toFixed(2)}</td>
                      <td style={{ fontWeight: 600 }}>{r.balance.toFixed(2)}</td>
                      <td style={{ color: r.lossPercent >= 20 ? '#ef4444' : '#64748b' }}>{r.lossPercent.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== 策略脚本面板 =====
function ScriptPanel() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState<KlineInterval>('1h');

  return (
    <div className="lab-panel">
      <div className="bt-config" style={{ marginBottom: 0 }}>
        <div className="config-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="config-field">
            <label>品种</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </div>
          <div className="config-field">
            <label>K线周期</label>
            <select value={interval} onChange={(e) => setInterval(e.target.value as KlineInterval)}>
              <option value="15m">15分钟</option>
              <option value="1h">1小时</option>
              <option value="4h">4小时</option>
              <option value="1d">日线</option>
            </select>
          </div>
        </div>
      </div>
      <StrategyScriptEditor symbol={symbol} interval={interval} />
    </div>
  );
}
