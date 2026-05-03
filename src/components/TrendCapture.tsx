/**
 * 趋势捕捉
 * 发现今日大涨币种 → 一键深度分析 → 下次也能捕捉类似机会
 */

import { useState, useCallback } from 'react';
import { fetchKlines, type KlineInterval } from '../lib/exchange';
import { analyzeMarket } from '../lib/marketAnalysis';
import type { MarketAnalysisResult } from '../lib/marketAnalysis';

// ==================== 类型 ====================

interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  priceChange: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  count: string;
}

interface GainerItem {
  symbol: string;
  base: string;
  lastPrice: number;
  changePct: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  trades: number;
}

// ==================== 辅助函数 ====================

const fmtPrice = (v: number) => v >= 1000 ? v.toFixed(2)
  : v >= 1 ? v.toFixed(4)
  : v.toFixed(6);

const fmtVolume = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(2)}B`
  : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M`
  : v >= 1e3 ? `${(v / 1e3).toFixed(2)}K`
  : v.toFixed(0);

const INTERVAL_LABELS: Record<string, string> = {
  '15m': '15分钟', '1h': '1小时', '4h': '4小时', '1d': '日线',
};

// ==================== 深度分析面板 ====================

function GainerDetail({
  gainer,
  interval,
  onClose,
}: {
  gainer: GainerItem;
  interval: KlineInterval;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<MarketAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAnalysis = useCallback(async () => {
    if (analysis) return; // 已加载
    setLoading(true);
    setError(null);
    try {
      const endTime = Date.now();
      const startTime = endTime - 60 * 24 * 60 * 60 * 1000;
      const klines = await fetchKlines({
        symbol: gainer.symbol,
        interval,
        startTime,
        endTime,
        limit: 500,
      });
      if (klines.length < 50) {
        setError('K线数据不足');
        return;
      }
      const result = analyzeMarket(klines, gainer.symbol, interval);
      setAnalysis(result);
    } catch (err: any) {
      setError(err.message || '分析失败');
    } finally {
      setLoading(false);
    }
  }, [gainer.symbol, interval, analysis]);

  // 自动加载
  useState(() => { loadAnalysis(); });

  const isBullish = gainer.changePct >= 0;
  const signalColor = isBullish ? '#22c55e' : '#ef4444';

  return (
    <div className="bt-result" style={{
      marginTop: 8,
      border: `1px solid ${signalColor}30`,
      borderLeft: `3px solid ${signalColor}`,
    }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 16 }}>
            🔍 {gainer.base} 深度分析
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 400, marginLeft: 8 }}>
              {INTERVAL_LABELS[interval]} | 60天数据
            </span>
          </h4>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#64748b',
            cursor: 'pointer', fontSize: 18, padding: '0 4px',
          }}
        >
          ✕
        </button>
      </div>

      {/* 🔥 涨幅综述 */}
      <div className="metrics-grid" style={{ marginBottom: 8 }}>
        <div className="metric-card" style={{ borderLeft: `3px solid ${signalColor}` }}>
          <span className="metric-value" style={{ color: signalColor, fontSize: 20 }}>
            {gainer.changePct >= 0 ? '+' : ''}{gainer.changePct.toFixed(2)}%
          </span>
          <span className="metric-label">24h 涨跌幅</span>
        </div>
        <div className="metric-card">
          <span className="metric-value" style={{ fontSize: 14 }}>${fmtPrice(gainer.lastPrice)}</span>
          <span className="metric-label">当前价格</span>
        </div>
        <div className="metric-card">
          <span className="metric-value" style={{ fontSize: 14 }}>{fmtVolume(gainer.quoteVolume)}</span>
          <span className="metric-label">24h 成交额</span>
        </div>
        <div className="metric-card">
          <span className="metric-value" style={{ fontSize: 13 }}>
            高: ${fmtPrice(gainer.highPrice)} / 低: ${fmtPrice(gainer.lowPrice)}
          </span>
          <span className="metric-label">24h 最高 / 最低</span>
        </div>
      </div>

      {/* 加载/错误状态 */}
      {loading && <div className="status-bar info" style={{ marginTop: 8 }}>⏳ 正在获取 K 线数据并分析...</div>}
      {error && <div className="status-bar error" style={{ marginTop: 8 }}>{error}</div>}

      {/* 深度分析内容 */}
      {analysis && (
        <>
          {/* 市场结构 + 信号 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
            {/* 市场结构 */}
            <div style={{ background: '#1a1b23', borderRadius: 8, padding: 10 }}>
              <h5 style={{ margin: '0 0 6px 0', fontSize: 12, color: '#64748b' }}>📊 市场结构</h5>
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #2d2e3d', padding: '2px 0' }}>
                  <span style={{ color: '#94a3b8' }}>趋势</span>
                  <span style={{
                    color: analysis.structure.trend === 'BULLISH' ? '#22c55e'
                      : analysis.structure.trend === 'BEARISH' ? '#ef4444' : '#f59e0b'
                  }}>
                    {analysis.structure.trend === 'BULLISH' ? '📈 多头' : analysis.structure.trend === 'BEARISH' ? '📉 空头' : '➡️ 盘整'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #2d2e3d', padding: '2px 0' }}>
                  <span style={{ color: '#94a3b8' }}>ADX 趋势强度</span>
                  <span>{analysis.structure.adx.toFixed(1)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #2d2e3d', padding: '2px 0' }}>
                  <span style={{ color: '#94a3b8' }}>波动率</span>
                  <span>{analysis.structure.volatility === 'HIGH' ? '🔴 高' : analysis.structure.volatility === 'MEDIUM' ? '🟡 中' : '🟢 低'}</span>
                </div>
                <div style={{ padding: '2px 0' }}>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>{analysis.structure.phase}</span>
                </div>
              </div>
            </div>

            {/* 信号详情 */}
            <div style={{ background: '#1a1b23', borderRadius: 8, padding: 10 }}>
              <h5 style={{ margin: '0 0 6px 0', fontSize: 12, color: '#64748b' }}>📈 技术指标</h5>
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #2d2e3d', padding: '2px 0' }}>
                  <span style={{ color: '#94a3b8' }}>RSI (14)</span>
                  <span style={{
                    color: analysis.signal.indicators.rsi > 70 ? '#ef4444'
                      : analysis.signal.indicators.rsi < 30 ? '#22c55e' : '#e2e8f0'
                  }}>
                    {analysis.signal.indicators.rsi.toFixed(1)}
                    {analysis.signal.indicators.rsi > 70 ? ' ⚠️超买' : analysis.signal.indicators.rsi < 30 ? ' 💡超卖' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #2d2e3d', padding: '2px 0' }}>
                  <span style={{ color: '#94a3b8' }}>MACD</span>
                  <span style={{
                    color: analysis.signal.indicators.macd === 'bullish' ? '#22c55e'
                      : analysis.signal.indicators.macd === 'bearish' ? '#ef4444' : '#f59e0b'
                  }}>
                    {analysis.signal.indicators.macd === 'bullish' ? '🐂 金叉看多' : analysis.signal.indicators.macd === 'bearish' ? '🐻 死叉看空' : '⚪ 中性'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #2d2e3d', padding: '2px 0' }}>
                  <span style={{ color: '#94a3b8' }}>布林带</span>
                  <span style={{
                    color: analysis.signal.indicators.bb === 'lower' ? '#22c55e'
                      : analysis.signal.indicators.bb === 'upper' ? '#ef4444' : '#e2e8f0'
                  }}>
                    {analysis.signal.indicators.bb === 'lower' ? '📥 触及下轨' : analysis.signal.indicators.bb === 'upper' ? '📤 触及上轨' : '⚪ 中轨'}
                  </span>
                </div>
                <div style={{ padding: '2px 0' }}>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>{analysis.signal.reasons.slice(0, 2).join(' | ')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 关键水平 */}
          {analysis.keyLevels.length > 0 && (
            <div style={{ background: '#1a1b23', borderRadius: 8, padding: 10, marginTop: 8 }}>
              <h5 style={{ margin: '0 0 6px 0', fontSize: 12, color: '#64748b' }}>📌 关键水平</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {/* 阻力位 */}
                <div>
                  <div style={{ fontSize: 10, color: '#ef4444', marginBottom: 2 }}>阻力位</div>
                  {analysis.keyLevels.filter(l => l.type === 'resistance').slice(0, 3).map((l, i) => (
                    <div key={`r-${i}`} style={{ fontSize: 11, padding: '2px 4px', color: '#fca5a5', borderLeft: '2px solid #ef4444', marginBottom: 1 }}>
                      R{i + 1}: ${fmtPrice(l.price)}
                      <span style={{ color: '#64748b', marginLeft: 4, fontSize: 10 }}>强度 {l.strength}/5</span>
                    </div>
                  ))}
                </div>
                {/* 支撑位 */}
                <div>
                  <div style={{ fontSize: 10, color: '#22c55e', marginBottom: 2 }}>支撑位</div>
                  {analysis.keyLevels.filter(l => l.type === 'support').slice(0, 3).map((l, i) => (
                    <div key={`s-${i}`} style={{ fontSize: 11, padding: '2px 4px', color: '#86efac', borderLeft: '2px solid #22c55e', marginBottom: 1 }}>
                      S{i + 1}: ${fmtPrice(l.price)}
                      <span style={{ color: '#64748b', marginLeft: 4, fontSize: 10 }}>强度 {l.strength}/5</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 交易机会 */}
          {analysis.opportunities.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <h5 style={{ margin: '0 0 4px 0', fontSize: 12, color: '#64748b' }}>🎯 交易机会（{INTERVAL_LABELS[interval]}）</h5>
              <div className="table-container">
                <table className="trades-table" style={{ fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th>方向</th>
                      <th>信心</th>
                      <th>入场区间</th>
                      <th>止损</th>
                      <th>止盈1</th>
                      <th>止盈2</th>
                      <th>R/R</th>
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
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ width: 40, height: 5, background: '#2d2e3d', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.abs(analysis.signal.score)}%`, height: '100%', background: Math.abs(analysis.signal.score) >= 70 ? '#22c55e' : Math.abs(analysis.signal.score) >= 40 ? '#f59e0b' : '#ef4444', borderRadius: 3 }} />
                            </div>
                            <span>{Math.abs(analysis.signal.score)}%</span>
                          </div>
                        </td>
                        <td>{opp.entryZone.low.toFixed(2)} ~ {opp.entryZone.high.toFixed(2)}</td>
                        <td style={{ color: '#ef4444' }}>{opp.stopLoss.toFixed(2)}</td>
                        <td style={{ color: '#22c55e' }}>{opp.takeProfit[0]?.toFixed(2)}</td>
                        <td style={{ color: '#4ade80' }}>{opp.takeProfit[1]?.toFixed(2)}</td>
                        <td style={{ fontWeight: 600 }}>1:{opp.riskReward.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 小结 */}
          <div style={{ marginTop: 8, padding: 10, background: '#1a1b23', borderRadius: 8, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
            <strong style={{ color: '#e2e8f0' }}>📝 趋势小结</strong><br />
            {analysis.summary}
            {gainer.changePct > 15 && (
              <span style={{ color: '#f59e0b', display: 'block', marginTop: 4 }}>
                ⚡ {gainer.base} 24h 涨幅 {gainer.changePct.toFixed(1)}%，属于强势突破。建议关注 RSI 是否进入超买区，
                若放量突破关键阻力位后可考虑追涨，但需设置严格止损。
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ==================== 主组件 ====================

export default function TrendCapture() {
  const [interval, setInterval_] = useState<KlineInterval>('4h');
  const [sortBy, setSortBy] = useState<'gainers' | 'losers' | 'volume'>('gainers');
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(false);
  const [gainers, setGainers] = useState<GainerItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedGainer, setSelectedGainer] = useState<GainerItem | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedGainer(null);
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Ticker24h[] = await res.json();
      const usdt: GainerItem[] = data
        .filter((t) => t.symbol.endsWith('USDT'))
        .map((t) => ({
          symbol: t.symbol,
          base: t.symbol.replace('USDT', ''),
          lastPrice: parseFloat(t.lastPrice),
          changePct: parseFloat(t.priceChangePercent),
          highPrice: parseFloat(t.highPrice),
          lowPrice: parseFloat(t.lowPrice),
          volume: parseFloat(t.volume),
          quoteVolume: parseFloat(t.quoteVolume),
          trades: parseInt(t.count),
        }));

      const sorted = [...usdt].sort((a, b) => {
        if (sortBy === 'gainers') return b.changePct - a.changePct;
        if (sortBy === 'losers') return a.changePct - b.changePct;
        return b.quoteVolume - a.quoteVolume;
      });

      setGainers(sorted.slice(0, limit));
    } catch (err: any) {
      setError(err.message || '扫描失败');
    } finally {
      setLoading(false);
    }
  }, [sortBy, limit]);

  const hotColor = (pct: number) => {
    if (pct > 20) return '#ef4444';
    if (pct > 10) return '#f97316';
    if (pct > 5) return '#f59e0b';
    if (pct >= 0) return '#22c55e';
    return '#64748b';
  };

  return (
    <div className="lab-panel">
      {/* 配置 */}
      <div className="bt-config">
        <div className="config-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr auto' }}>
          <div className="config-field">
            <label>分析周期</label>
            <select value={interval} onChange={(e) => setInterval_(e.target.value as KlineInterval)}>
              <option value="1h">1小时</option>
              <option value="4h">4小时</option>
              <option value="1d">日线</option>
            </select>
          </div>
          <div className="config-field">
            <label>排序</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
              <option value="gainers">🔥 涨幅榜</option>
              <option value="losers">❄️ 跌幅榜</option>
              <option value="volume">💹 成交额榜</option>
            </select>
          </div>
          <div className="config-field">
            <label>数量</label>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
            </select>
          </div>
          <button className="btn-run" onClick={scan} disabled={loading} style={{ alignSelf: 'flex-end' }}>
            {loading ? '⏳ 扫描中...' : '🔍 扫描今日热点'}
          </button>
        </div>
      </div>

      {error && <div className="status-bar error">{error}</div>}

      {/* 涨幅榜列表 */}
      <div className="bt-result" style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h4 style={{ margin: 0, fontSize: 14 }}>
            {sortBy === 'gainers' ? '🔥 今日涨幅榜' : sortBy === 'losers' ? '❄️ 今日跌幅榜' : '💹 成交额排行'}
          </h4>
          {gainers.length > 0 && (
            <span style={{ fontSize: 11, color: '#64748b' }}>
              共 {gainers.length} 个 | 点击查看深度分析
            </span>
          )}
        </div>

        {!loading && gainers.length === 0 && !error && (
          <div className="status-bar info">点击「扫描今日热点」获取实时的热门币种</div>
        )}

        {/* 涨幅榜表格 — 可点击 */}
        <div className="table-container">
          <table className="trades-table">
            <thead>
              <tr>
                <th>#</th>
                <th>品种</th>
                <th>价格</th>
                <th>24h涨跌</th>
                <th>最高</th>
                <th>最低</th>
                <th>成交量</th>
                <th>成交额</th>
              </tr>
            </thead>
            <tbody>
              {gainers.map((g, i) => {
                const isSelected = selectedGainer?.symbol === g.symbol;
                const isHot = g.changePct > 10;
                return (
                  <tr
                    key={g.symbol}
                    onClick={() => setSelectedGainer(isSelected ? null : g)}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(59,130,246,0.08)' : 'transparent',
                      transition: 'background 0.2s',
                    }}
                  >
                    <td style={{
                      color: i < 3 ? '#f59e0b' : '#64748b',
                      fontWeight: i < 3 ? 700 : 400,
                    }}>
                      {i + 1}
                      {isHot && ' 🔥'}
                    </td>
                    <td style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {g.base}
                      {isHot && <span style={{ fontSize: 10, color: '#ef4444' }}>HOT</span>}
                    </td>
                    <td>${fmtPrice(g.lastPrice)}</td>
                    <td style={{
                      color: g.changePct >= 0 ? '#ef4444' : '#22c55e',
                      fontWeight: 700,
                    }}>
                      {g.changePct >= 0 ? '+' : ''}{g.changePct.toFixed(2)}%
                    </td>
                    <td>${fmtPrice(g.highPrice)}</td>
                    <td>${fmtPrice(g.lowPrice)}</td>
                    <td>{fmtVolume(g.volume)}</td>
                    <td style={{ color: '#94a3b8' }}>{fmtVolume(g.quoteVolume)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 选中币种的深度分析 */}
      {selectedGainer && (
        <GainerDetail
          gainer={selectedGainer}
          interval={interval}
          onClose={() => setSelectedGainer(null)}
        />
      )}
    </div>
  );
}
