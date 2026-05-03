/**
 * 智能市场分析组件
 * 显示：关键水平、市场结构、买卖信号、多时间框架交易机会
 */

import { useState, useCallback } from 'react';
import { fetchKlines, type KlineData, type KlineInterval } from '../lib/exchange';
import { analyzeMarket, type MarketAnalysisResult } from '../lib/marketAnalysis';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface Props {
  symbol?: string;
  interval?: KlineInterval;
}

const INTERVAL_LABELS: Record<string, string> = {
  '15m': '15分钟', '1h': '1小时', '4h': '4小时', '1d': '日线',
};

const SIGNAL_COLORS: Record<string, string> = {
  STRONG_BUY: '#22c55e',
  BUY: '#4ade80',
  NEUTRAL: '#f59e0b',
  SELL: '#fb923c',
  STRONG_SELL: '#ef4444',
};

const SIGNAL_LABELS: Record<string, string> = {
  STRONG_BUY: '强烈买入',
  BUY: '买入',
  NEUTRAL: '中性',
  SELL: '卖出',
  STRONG_SELL: '强烈卖出',
};

function SignalBadge({ action, score }: { action: string; score: number }) {
  const color = SIGNAL_COLORS[action] || '#64748b';
  return (
    <span className="signal-badge" style={{
      background: `${color}20`,
      color,
      border: `1px solid ${color}40`,
      borderRadius: 8,
      padding: '4px 12px',
      fontWeight: 700,
      fontSize: 14,
    }}>
      {SIGNAL_LABELS[action] || action} ({score > 0 ? '+' : ''}{score})
    </span>
  );
}

function LevelBar({ level }: { level: { price: number; type: string; strength: number; source: string; hits: number } }) {
  const isSupport = level.type === 'support';
  return (
    <div className="level-bar" style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 8px',
      borderLeft: `3px solid ${isSupport ? '#22c55e' : '#ef4444'}`,
      marginBottom: 2,
      fontSize: 12,
    }}>
      <span style={{ fontWeight: 600, width: 80 }}>{level.price.toFixed(2)}</span>
      <span className="level-badge" style={{
        background: isSupport ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
        color: isSupport ? '#22c55e' : '#ef4444',
        borderRadius: 4,
        padding: '1px 6px',
        fontSize: 10,
        fontWeight: 500,
      }}>
        {isSupport ? '支撑' : '阻力'} {level.strength}/5
      </span>
      <span style={{ color: '#64748b', fontSize: 11, flex: 1 }}>{level.source}</span>
      <span style={{ color: '#94a3b8', fontSize: 11 }}>触碰 {level.hits} 次</span>
    </div>
  );
}

export default function MarketAnalysis({ symbol: defaultSymbol = 'BTCUSDT', interval: defaultInterval = '4h' }: Props) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [interval, setInterval_] = useState<KlineInterval>(defaultInterval);
  const [days, setDays] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MarketAnalysisResult | null>(null);
  const [klines, setKlines] = useState<KlineData[]>([]);

  const handleAnalyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const endTime = Date.now();
      const startTime = endTime - days * 24 * 60 * 60 * 1000;
      const data = await fetchKlines({ symbol, interval, startTime, endTime, limit: 1000 });
      if (data.length < 30) {
        setError('K线数据不足（至少需要30根）');
        return;
      }
      setKlines(data);
      const result = analyzeMarket(data, symbol, interval);
      setAnalysis(result);
    } catch (err: any) {
      setError(err.message || '分析失败');
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, days]);

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
            <select value={interval} onChange={(e) => setInterval_(e.target.value as KlineInterval)}>
              <option value="15m">15分钟</option>
              <option value="1h">1小时</option>
              <option value="4h">4小时</option>
              <option value="1d">日线</option>
            </select>
          </div>
          <div className="config-field">
            <label>数据天数</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>7天</option>
              <option value={14}>14天</option>
              <option value={30}>30天</option>
              <option value={60}>60天</option>
              <option value={90}>90天</option>
            </select>
          </div>
        </div>
        <button className="btn-run" onClick={handleAnalyze} disabled={loading}>
          {loading ? '⏳ 分析中...' : '🔍 智能分析'}
        </button>
      </div>

      {error && <div className="status-bar error">{error}</div>}

      {analysis && (
        <>
          {/* 摘要 */}
          <div className="bt-result" style={{ marginTop: 12 }}>
            <div className="metrics-grid">
              <div className="metric-card">
                <span className="metric-value">{analysis.currentPrice.toFixed(2)}</span>
                <span className="metric-label">现价 (USDT)</span>
              </div>
              <div className="metric-card">
                <SignalBadge action={analysis.signal.action} score={analysis.signal.score} />
                <span className="metric-label">综合信号</span>
              </div>
              <div className="metric-card">
                <span className="metric-value" style={{ color: analysis.structure.trend === 'BULLISH' ? '#22c55e' : analysis.structure.trend === 'BEARISH' ? '#ef4444' : '#f59e0b' }}>
                  {analysis.structure.trend === 'BULLISH' ? '📈 多头' : analysis.structure.trend === 'BEARISH' ? '📉 空头' : '➡️ 盘整'}
                </span>
                <span className="metric-label">
                  趋势方向 {analysis.structure.adx > 0 ? `(ADX: ${analysis.structure.adx.toFixed(1)})` : ''}
                </span>
              </div>
              <div className="metric-card">
                <span className="metric-value" style={{ fontSize: 12 }}>{analysis.structure.phase}</span>
                <span className="metric-label">市场阶段</span>
              </div>
            </div>

            <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 0 0', padding: '8px 12px', background: '#1a1b23', borderRadius: 6 }}>
              {analysis.summary}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            {/* 交易信号详情 */}
            <div className="bt-result" style={{ margin: 0 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>📊 信号详情</h4>
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid #2d2e3d' }}>
                  <span style={{ color: '#94a3b8' }}>RSI (14)</span>
                  <span style={{ color: analysis.signal.indicators.rsi > 70 ? '#ef4444' : analysis.signal.indicators.rsi < 30 ? '#22c55e' : '#e2e8f0' }}>
                    {analysis.signal.indicators.rsi.toFixed(1)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid #2d2e3d' }}>
                  <span style={{ color: '#94a3b8' }}>MACD</span>
                  <span style={{ color: analysis.signal.indicators.macd === 'bullish' ? '#22c55e' : analysis.signal.indicators.macd === 'bearish' ? '#ef4444' : '#f59e0b' }}>
                    {analysis.signal.indicators.macd === 'bullish' ? '🐂 看多' : analysis.signal.indicators.macd === 'bearish' ? '🐻 看空' : '⚪ 中性'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid #2d2e3d' }}>
                  <span style={{ color: '#94a3b8' }}>布林带</span>
                  <span style={{ color: analysis.signal.indicators.bb === 'lower' ? '#22c55e' : analysis.signal.indicators.bb === 'upper' ? '#ef4444' : '#e2e8f0' }}>
                    {analysis.signal.indicators.bb === 'lower' ? '📥 触及下轨' : analysis.signal.indicators.bb === 'upper' ? '📤 触及上轨' : '⚪ 中间'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid #2d2e3d' }}>
                  <span style={{ color: '#94a3b8' }}>SMA 交叉</span>
                  <span style={{ color: analysis.signal.indicators.sma === 'golden_cross' ? '#22c55e' : analysis.signal.indicators.sma === 'death_cross' ? '#ef4444' : '#e2e8f0' }}>
                    {analysis.signal.indicators.sma === 'golden_cross' ? '🥇 金叉' : analysis.signal.indicators.sma === 'death_cross' ? '💀 死叉' : analysis.signal.indicators.sma === 'above' ? '均线多头' : analysis.signal.indicators.sma === 'below' ? '均线空头' : '⚪ 中性'}
                  </span>
                </div>
              </div>

              <h5 style={{ margin: '12px 0 4px 0', fontSize: 12, color: '#94a3b8' }}>信号理由</h5>
              <ul style={{ fontSize: 11, color: '#94a3b8', margin: 0, paddingLeft: 16 }}>
                {analysis.signal.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>

            {/* 关键水平 */}
            <div className="bt-result" style={{ margin: 0 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>📌 关键水平</h4>
              <div className="levels-container">
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                  阻力位 ({analysis.keyLevels.filter(l => l.type === 'resistance').length})
                </div>
                {analysis.keyLevels.filter(l => l.type === 'resistance').slice(0, 4).map((l, i) => (
                  <LevelBar key={`r-${i}`} level={l} />
                ))}
                <div style={{ borderTop: '2px dashed #2d2e3d', margin: '6px 0' }} />
                <div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>
                  支撑位 ({analysis.keyLevels.filter(l => l.type === 'support').length})
                </div>
                {analysis.keyLevels.filter(l => l.type === 'support').slice(0, 4).map((l, i) => (
                  <LevelBar key={`s-${i}`} level={l} />
                ))}
              </div>
            </div>
          </div>

          {/* 交易机会 */}
          {analysis.opportunities.length > 0 && (
            <div className="bt-result" style={{ marginTop: 12 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>🎯 交易机会</h4>
              <div className="table-container">
                <table className="trades-table">
                  <thead>
                    <tr>
                      <th>方向</th>
                      <th>时间框架</th>
                      <th>信心</th>
                      <th>入场区间</th>
                      <th>止损</th>
                      <th>止盈1</th>
                      <th>止盈2</th>
                      <th>R/R</th>
                      <th>理由</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.opportunities.map((opp, i) => (
                      <tr key={i}>
                        <td>
                          <span className={`dir-badge ${opp.direction.toLowerCase()}`}>
                            {opp.direction === 'LONG' ? '📈 做多' : '📉 做空'}
                          </span>
                        </td>
                        <td>{INTERVAL_LABELS[opp.timeframe] || opp.timeframe}</td>
                        <td>
                          <div style={{
                            width: 50,
                            height: 6,
                            background: '#2d2e3d',
                            borderRadius: 3,
                            overflow: 'hidden',
                          }}>
                            <div style={{
                              width: `${opp.confidence}%`,
                              height: '100%',
                              background: opp.confidence >= 70 ? '#22c55e' : opp.confidence >= 40 ? '#f59e0b' : '#ef4444',
                              borderRadius: 3,
                            }} />
                          </div>
                          <span style={{ fontSize: 11 }}>{opp.confidence}%</span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {opp.entryZone.low.toFixed(2)} - {opp.entryZone.high.toFixed(2)}
                        </td>
                        <td style={{ color: '#ef4444', fontSize: 12 }}>{opp.stopLoss.toFixed(2)}</td>
                        <td style={{ color: '#22c55e', fontSize: 12 }}>{opp.takeProfit[0]?.toFixed(2)}</td>
                        <td style={{ color: '#4ade80', fontSize: 12 }}>{opp.takeProfit[1]?.toFixed(2)}</td>
                        <td style={{ fontWeight: 600 }}>1:{opp.riskReward.toFixed(1)}</td>
                        <td style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {opp.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 价格位置图 */}
          <div className="chart-card" style={{ marginTop: 12 }}>
            <h4>价格位置 — 关键水平 & 现价</h4>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={(() => {
                const allLevels = analysis.keyLevels;
                const minP = Math.min(...allLevels.map(l => l.price), analysis.currentPrice) * 0.998;
                const maxP = Math.max(...allLevels.map(l => l.price), analysis.currentPrice) * 1.002;
                const steps = 10;
                const stepSize = (maxP - minP) / steps;
                const data = [];
                for (let i = 0; i <= steps; i++) {
                  data.push({ pos: i.toString(), price: minP + i * stepSize, levels: 0 });
                }
                return data;
              })()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
                <XAxis dataKey="pos" hide />
                <YAxis stroke="#64748b" fontSize={10} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(0)} />
                <Tooltip contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d', color: '#e2e8f0' }} />
                {/* 现价线 */}
                <ReferenceLine y={analysis.currentPrice} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: `现价 ${analysis.currentPrice.toFixed(2)}`, fill: '#f59e0b', fontSize: 11, position: 'right' }} />
                {/* 支撑线 */}
                {analysis.keyLevels.filter(l => l.type === 'support').slice(0, 3).map((l, i) => (
                  <ReferenceLine key={`sl-${i}`} y={l.price} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: `S${i + 1}:${l.price.toFixed(0)}`, fill: '#22c55e', fontSize: 10 }} />
                ))}
                {/* 阻力线 */}
                {analysis.keyLevels.filter(l => l.type === 'resistance').slice(0, 3).map((l, i) => (
                  <ReferenceLine key={`rl-${i}`} y={l.price} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: `R${i + 1}:${l.price.toFixed(0)}`, fill: '#ef4444', fontSize: 10 }} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
