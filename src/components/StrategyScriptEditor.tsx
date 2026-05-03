/**
 * 策略脚本编辑器
 * 类似 TradingView Pine Script 的脚本编辑体验
 */

import { useState, useMemo, useCallback } from 'react';
import { fetchKlines, type KlineData, type KlineInterval } from '../lib/exchange';
import { runScriptBacktest, validateScript, getExampleScripts } from '../lib/scriptEngine';
import type { BacktestResult } from '../lib/strategyMetrics';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Cell,
} from 'recharts';
import './StrategyScriptEditor.css';

interface Props {
  symbol: string;
  interval: KlineInterval;
}

export default function StrategyScriptEditor({ symbol, interval }: Props) {
  const [code, setCode] = useState(() => getExampleScripts()[0].code);
  const [scriptName, setScriptName] = useState('SMA 金叉策略');
  const [activeExample, setActiveExample] = useState(0);
  const [initialCapital, setInitialCapital] = useState(10000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  const examples = useMemo(() => getExampleScripts(), []);

  const loadExample = (idx: number) => {
    setActiveExample(idx);
    setCode(examples[idx].code);
    setScriptName(examples[idx].name);
    setResult(null);
    setError(null);
    setCompileError(null);
  };

  const handleRun = useCallback(async () => {
    setCompileError(null);
    setError(null);
    setResult(null);

    // 语法验证
    const err = validateScript(code);
    if (err) {
      setCompileError(err);
      return;
    }

    setLoading(true);
    try {
      const endTime = Date.now();
      const startTime = endTime - 90 * 24 * 60 * 60 * 1000; // 90天数据
      const klines = await fetchKlines({ symbol, interval, startTime, endTime, limit: 1000 });

      if (klines.length < 30) {
        setError('K线数据不足（< 30根），请选择更小周期或更长时间范围');
        return;
      }

      const { result: btResult, error: runError } = runScriptBacktest(code, klines, symbol, interval, initialCapital);

      if (runError) {
        setError(`脚本执行错误: ${runError}`);
      } else {
        setResult(btResult);
      }
    } catch (err: any) {
      setError(`回测失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [code, symbol, interval]);

  const getScoreColor = (s: number) => s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444';
  const metricColor = (v: number, good: number) => v >= good ? '#22c55e' : '#ef4444';

  return (
    <div className="script-editor">
      {/* 上半：编辑区 */}
      <div className="editor-section">
        <div className="editor-header">
          <div className="editor-title-row">
            <input
              className="script-name-input"
              value={scriptName}
              onChange={(e) => setScriptName(e.target.value)}
              placeholder="策略名称"
            />
            <span className="indicator-badge">内置指标: SMA, EMA, RSI, MACD, BB, ATR, ADX, Stochastic</span>
          </div>
          <div className="editor-toolbar">
            <select
              className="example-select"
              value={activeExample}
              onChange={(e) => loadExample(Number(e.target.value))}
            >
              {examples.map((ex, i) => (
                <option key={i} value={i}>{ex.name}</option>
              ))}
            </select>
            <div className="capital-input-group">
              <label className="capital-label">资金(USDT)</label>
              <input
                type="number"
                className="capital-input"
                value={initialCapital}
                onChange={(e) => setInitialCapital(Math.max(100, Number(e.target.value)))}
                min={100}
                step={1000}
              />
            </div>
            <button className="btn-run" onClick={handleRun} disabled={loading}>
              {loading ? '⏳ 回测中...' : '▶ 运行回测'}
            </button>
          </div>
        </div>

        {/* 代码编辑器（textarea，带行号视觉） */}
        <div className="code-editor-wrapper">
          <div className="code-lines">
            {code.split('\n').map((_, i) => (
              <div key={i} className="line-num">{i + 1}</div>
            ))}
          </div>
          <textarea
            className="code-textarea"
            value={code}
            onChange={(e) => { setCode(e.target.value); setCompileError(null); }}
            spellCheck={false}
            wrap="off"
          />
        </div>

        {compileError && (
          <div className="compile-error">
            ❌ 语法错误: {compileError}
          </div>
        )}
        {error && !compileError && (
          <div className="status-bar error">{error}</div>
        )}
      </div>

      {/* 下半：回测结果 */}
      {result && (
        <div className="script-result">
          <h3>回测报告 — {scriptName}</h3>
          <p className="result-period">
            {new Date(result.startTime).toLocaleDateString('zh-CN')} → {new Date(result.endTime).toLocaleDateString('zh-CN')}
            &nbsp;|&nbsp; {result.totalBars} 根K线 &nbsp;|&nbsp; {result.totalTrades} 笔交易
          </p>

          {/* 核心指标 */}
          <div className="metrics-grid">
            <div className="metric-card">
              <span className="metric-value" style={{ color: metricColor(result.totalPnlPercent, 0) }}>
                {result.totalPnlPercent >= 0 ? '+' : ''}{result.totalPnlPercent.toFixed(2)}%
              </span>
              <span className="metric-label">总收益率</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: metricColor(result.totalPnlUsdt, 0) }}>
                {result.totalPnlUsdt >= 0 ? '+' : ''}{result.totalPnlUsdt.toFixed(2)} USDT
              </span>
              <span className="metric-label">总盈亏 (USDT)</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: metricColor(result.winRate, 50) }}>
                {result.winRate.toFixed(1)}%
              </span>
              <span className="metric-label">胜率 ({result.wins}/{result.totalTrades})</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: metricColor(result.profitFactor, 1.5) }}>
                {result.profitFactor === Infinity ? '∞' : result.profitFactor.toFixed(2)}
              </span>
              <span className="metric-label">盈亏比</span>
            </div>
            <div className="metric-card">
              <span className="metric-value" style={{ color: metricColor(result.sharpeRatio, 1) }}>
                {result.sharpeRatio.toFixed(2)}
              </span>
              <span className="metric-label">夏普比率</span>
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
              <span className="metric-value" style={{ fontSize: 13 }}>{result.initialCapital.toLocaleString()} USDT</span>
              <span className="metric-label">初始资金</span>
            </div>
          </div>

          {/* 权益曲线（USDT） */}
          {result.equityUsdtCurve.length > 0 && (
            <div className="chart-card" style={{ marginTop: 12 }}>
              <h4>权益曲线 (USDT)</h4>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={result.equityUsdtCurve}>
                  <defs><linearGradient id="eqGradScr" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
                  <XAxis dataKey="trade" stroke="#64748b" fontSize={9} />
                  <YAxis stroke="#64748b" fontSize={9} domain={['auto', 'auto']} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}K` : v.toFixed(0)} />
                  <Tooltip contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d', color: '#e2e8f0' }} formatter={(v: number) => [`${v.toFixed(2)} USDT`, '权益']} />
                  <Area type="monotone" dataKey="equity" stroke="#3b82f6" fill="url(#eqGradScr)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 交易明细 */}
          {result.trades.length > 0 && (
            <div className="bt-trades" style={{ marginTop: 12 }}>
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
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(0, 30).map((t, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td><span className={`dir-badge ${t.direction.toLowerCase()}`}>{t.direction === 'LONG' ? '多' : '空'}</span></td>
                        <td>{t.entryPrice.toFixed(2)}</td>
                        <td>{t.exitPrice.toFixed(2)}</td>
                        <td style={{ color: t.pnlPercent >= 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                          {t.pnlPercent >= 0 ? '+' : ''}{t.pnlPercent.toFixed(2)}%
                        </td>
                        <td>{t.holdingBars}</td>
                      </tr>
                    ))}
                    {result.trades.length > 30 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>...还有 {result.trades.length - 30} 笔</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
