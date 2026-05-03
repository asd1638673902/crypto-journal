import { getTrades, getReviews, getSyncLogs } from '../lib/db';
import { calcExecutionScore } from '../lib/calculations';
import {
  generateMonthlyPnL,
  generateEquityCurve,
  generateSymbolBreakdown,
} from '../lib/chartData';
import { getApiKey, fetchKlines, type KlineData } from '../lib/exchange';
import { scanAccumulationBreakout, type AccumulationBreakoutResult } from '../lib/marketScanner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, Cell,
} from 'recharts';
import { useMemo, useState, useEffect, useCallback } from 'react';
import './Dashboard.css';
import NotificationPanel from '../components/NotificationPanel';

type SourceFilter = 'ALL' | 'REAL' | 'MOCK';

function getTradeSource(trade: { exchange: string; orderId?: string }): 'REAL' | 'MOCK' | 'MANUAL' {
  if (trade.exchange === 'binance' && trade.orderId && !trade.orderId.startsWith('mock')) return 'REAL';
  if (trade.orderId?.startsWith('mock')) return 'MOCK';
  return 'MANUAL';
}

export default function Dashboard() {
  // 默认显示真实交易（真实 + 手动），可切换到模拟数据或全部
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('REAL');

  // ===== 实时行情 =====
  const [marketTickers, setMarketTickers] = useState<any[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [btcInfo, setBtcInfo] = useState<{ price: number; change: number } | null>(null);
  const [ethInfo, setEthInfo] = useState<{ price: number; change: number } | null>(null);
  const [breakoutCandidates, setBreakoutCandidates] = useState<AccumulationBreakoutResult[]>([]);

  const fetchMarketData = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) { setMarketError('币安API返回错误'); return; }
      const data: any[] = await res.json();
      const usdt = data.filter((t: any) => t.symbol.endsWith('USDT'));
      setMarketTickers(usdt);

      // BTC/ETH
      const btc = usdt.find((t: any) => t.symbol === 'BTCUSDT');
      const eth = usdt.find((t: any) => t.symbol === 'ETHUSDT');
      if (btc) setBtcInfo({ price: parseFloat(btc.lastPrice), change: parseFloat(btc.priceChangePercent) });
      if (eth) setEthInfo({ price: parseFloat(eth.lastPrice), change: parseFloat(eth.priceChangePercent) });

      // 蓄势突破扫描（只扫前30个热门币）
      const top30 = usdt.slice(0, 30);
      const candidates: AccumulationBreakoutResult[] = [];
      const endTime = Date.now();
      const startTime = endTime - 60 * 24 * 60 * 60 * 1000;
      for (const t of top30) {
        try {
          const klines = await fetchKlines({ symbol: t.symbol, interval: '1h', startTime, endTime, limit: 100 });
          if (klines.length >= 50) {
            const result = scanAccumulationBreakout(klines, t.symbol, parseFloat(t.priceChangePercent));
            if (result && result.score >= 5) candidates.push(result);
          }
        } catch { /* skip */ }
      }
      candidates.sort((a, b) => b.score - a.score);
      setBreakoutCandidates(candidates.slice(0, 5));
    } catch { setMarketError('无法连接到币安API，实时行情不可用'); }
    finally { setMarketLoading(false); }
  }, []);

  useEffect(() => { fetchMarketData(); }, []);

  const allTrades = useMemo(() => getTrades(), []);
  const [reviews] = useState(() => getReviews());
  const [syncLogs] = useState(() => getSyncLogs());
  const [hasApiKey] = useState(() => !!getApiKey());

  // 按数据源筛选
  const filteredTrades = useMemo(() => {
    if (sourceFilter === 'ALL') return allTrades;
    return allTrades.filter((t) => {
      const source = getTradeSource(t);
      if (sourceFilter === 'REAL') return source === 'REAL' || source === 'MANUAL';
      if (sourceFilter === 'MOCK') return source === 'MOCK';
      return true;
    });
  }, [allTrades, sourceFilter]);

  const closedTrades = filteredTrades.filter((t) => t.status === 'CLOSED');
  const openTrades = filteredTrades.filter((t) => t.status === 'OPEN');

  // ===== 核心指标 =====
  const totalPnl = useMemo(() => closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0), [closedTrades]);
  const winningTrades = useMemo(() => closedTrades.filter((t) => (t.pnl || 0) > 0), [closedTrades]);
  const losingTrades = useMemo(() => closedTrades.filter((t) => (t.pnl || 0) < 0), [closedTrades]);
  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;

  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades.length
    : 0;
  const avgLoss = losingTrades.length > 0
    ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades.length)
    : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

  const luckyTrades = useMemo(() => closedTrades.filter((t) => t.isLuckyTrade), [closedTrades]);
  const scoredTrades = useMemo(() => closedTrades.filter((t) => t.executionScore), [closedTrades]);
  const avgScore = scoredTrades.length > 0
    ? scoredTrades.reduce((sum, t) => sum + (t.executionScore || 0), 0) / scoredTrades.length
    : 0;

  // ===== 动态图表数据 =====
  const monthlyData = useMemo(() => generateMonthlyPnL(filteredTrades), [filteredTrades]);
  const equityData = useMemo(() => generateEquityCurve(filteredTrades, 10000), [filteredTrades]);
  const symbolData = useMemo(() => generateSymbolBreakdown(filteredTrades), [filteredTrades]);

  // ===== 最近交易 =====
  const recentTrades = useMemo(
    () =>
      [...closedTrades]
        .sort((a, b) => new Date(b.exitTime || b.entryTime).getTime() - new Date(a.exitTime || a.entryTime).getTime())
        .slice(0, 5),
    [closedTrades],
  );

  // ===== 同步状态 =====
  const lastSync = syncLogs
    .filter((l) => l.status === 'success' || l.status === 'partial')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  // 数据源统计
  const realTradesCount = allTrades.filter((t) => getTradeSource(t) !== 'MOCK').length;
  const mockTradesCount = allTrades.filter((t) => getTradeSource(t) === 'MOCK').length;

  const getPnlColor = (pnl: number) => pnl >= 0 ? '#ef4444' : '#22c55e';
  const getScoreColor = (s: number) => s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <div className="dashboard">
      {/* 页头 */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">仪表盘</h1>
          <p className="page-subtitle">
            共 {allTrades.length} 笔交易
            {realTradesCount > 0 && (
              <span className="source-tag real">真实 {realTradesCount} 笔</span>
            )}
            {mockTradesCount > 0 && (
              <span className="source-tag mock">模拟 {mockTradesCount} 笔</span>
            )}
            {lastSync && (
              <span className="last-sync">
                上次同步: {new Date(lastSync.createdAt).toLocaleString('zh-CN')}
              </span>
            )}
          </p>
        </div>
        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NotificationPanel />
          {hasApiKey ? (
            <span className="exchange-status connected">✅ 已连接币安</span>
          ) : (
            <span className="exchange-status disconnected">⛔ 未连接交易所</span>
          )}
        </div>
      </div>

      {/* 数据源筛选 */}
      <div className="dashboard-filter-bar">
        <div className="filter-buttons">
          {([
            { value: 'REAL' as const, label: '✅ 真实交易' },
            { value: 'ALL' as const, label: '全部数据' },
            { value: 'MOCK' as const, label: '模拟数据' },
          ]).map((opt) => (
            <button
              key={opt.value}
              className={`filter-btn ${sourceFilter === opt.value ? 'active' : ''}`}
              onClick={() => setSourceFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="filter-result-count">
          显示 {filteredTrades.length}/{allTrades.length} 笔
        </span>
      </div>

      {/* ===== 实时市场概况 ===== */}
      <div className="market-overview">
        {/* 顶部栏：标题 + 统计 + 刷新 */}
        <div className="market-topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>📊 实时行情</span>
            <div className="market-stats" style={{ display: 'flex', gap: 6 }}>
              {(() => {
                const up = marketTickers.filter((t: any) => parseFloat(t.priceChangePercent) > 0).length;
                const down = marketTickers.filter((t: any) => parseFloat(t.priceChangePercent) < 0).length;
                return (
                  <>
                    <span className="market-stat up" style={{ fontSize: 11, padding: '2px 8px', background: '#25263a', borderRadius: 6, color: '#ef4444' }}>📈 {up}</span>
                    <span className="market-stat down" style={{ fontSize: 11, padding: '2px 8px', background: '#25263a', borderRadius: 6, color: '#22c55e' }}>📉 {down}</span>
                    <span className="market-stat total" style={{ fontSize: 11, padding: '2px 8px', background: '#25263a', borderRadius: 6, color: '#64748b' }}>共 {marketTickers.length}</span>
                    {marketLoading && <span style={{ fontSize: 11, color: '#f59e0b', animation: 'pulse 1s infinite' }}>🔄</span>}
                  </>
                );
              })()}
            </div>
          </div>
          <button
            className="btn-refresh"
            onClick={fetchMarketData}
            disabled={marketLoading}
            style={{
              background: 'rgba(59,130,246,0.1)',
              color: '#60a5fa',
              border: '1px solid rgba(59,130,246,0.2)',
              borderRadius: 6,
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: 11,
              whiteSpace: 'nowrap',
            }}
          >
            {marketLoading ? '⏳' : '🔄 刷新'}
          </button>
        </div>

        {/* API 连接失败提示 */}
        {marketError && (
          <div style={{
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
            borderRadius: 8, padding: '8px 12px', marginBottom: 12,
            fontSize: 12, color: '#f59e0b',
          }}>
            ⚠️ {marketError}（不影响本地交易数据）
          </div>
        )}

        {/* 第一行：热门品种行情卡片 */}
        <div className="market-ticker-row" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {/* BTC */}
          <div className="ticker-card" style={{ background: '#25263a', borderRadius: 8, padding: '6px 10px', minWidth: 120 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>BTC</span>
              {btcInfo && <span className="market-mini-change" style={{ fontSize: 10, color: btcInfo.change >= 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                {btcInfo.change >= 0 ? '+' : ''}{btcInfo.change.toFixed(2)}%
              </span>}
            </div>
            {btcInfo ? (
              <span className="market-mini-price" style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 700, fontFamily: 'monospace' }}>
                ${btcInfo.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            ) : <span style={{ fontSize: 12, color: '#475569' }}>--</span>}
          </div>

          {/* ETH */}
          <div className="ticker-card" style={{ background: '#25263a', borderRadius: 8, padding: '6px 10px', minWidth: 120 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>ETH</span>
              {ethInfo && <span style={{ fontSize: 10, color: ethInfo.change >= 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                {ethInfo.change >= 0 ? '+' : ''}{ethInfo.change.toFixed(2)}%
              </span>}
            </div>
            {ethInfo ? (
              <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 700, fontFamily: 'monospace' }}>
                ${ethInfo.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            ) : <span style={{ fontSize: 12, color: '#475569' }}>--</span>}
          </div>

          {/* 成交量最大 Top 3 */}
          {(() => {
            if (marketTickers.length === 0) return null;
            const topVol = [...marketTickers]
              .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
              .filter((t: any) => t.symbol !== 'BTCUSDT' && t.symbol !== 'ETHUSDT')
              .slice(0, 3);
            return topVol.map((t: any) => {
              const change = parseFloat(t.priceChangePercent);
              return (
                <div key={t.symbol} className="ticker-card" style={{ background: '#25263a', borderRadius: 8, padding: '6px 10px', minWidth: 120 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{t.symbol.replace('USDT', '')}</span>
                    <span style={{ fontSize: 10, color: change >= 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                      {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 700, fontFamily: 'monospace' }}>
                      ${parseFloat(t.lastPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                    <span style={{ fontSize: 9, color: '#475569' }}>💹{(parseFloat(t.quoteVolume) / 1e6).toFixed(0)}M</span>
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {/* 第二行：涨跌榜单并排 */}
        <div className="market-ranking-row" style={{ display: 'flex', gap: 12, marginBottom: 0 }}>
          {/* 暴涨榜 */}
          <div className="ranking-column" style={{ flex: 1, background: '#25263a', borderRadius: 8, padding: '8px 10px' }}>
            <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, marginBottom: 4, display: 'block' }}>🔥 暴涨榜</span>
            {marketTickers.length > 0 ? (
              [...marketTickers]
                .sort((a: any, b: any) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
                .slice(0, 3)
                .map((t: any, i: number) => {
                  const vol = parseFloat(t.quoteVolume);
                  return (
                    <div key={t.symbol} style={{ display: 'flex', alignItems: 'center', fontSize: 11, padding: '2px 0' }}>
                      <span style={{ color: ['#f59e0b', '#94a3b8', '#64748b'][i], fontWeight: 700, minWidth: 14 }}>{i + 1}.</span>
                      <span style={{ fontWeight: 600, margin: '0 4px', flex: 1 }}>{t.symbol.replace('USDT', '')}</span>
                      <span style={{ color: '#ef4444', fontWeight: 700 }}>+{parseFloat(t.priceChangePercent).toFixed(2)}%</span>
                      <span style={{ color: '#475569', fontSize: 10, marginLeft: 6 }}>💹{vol >= 1e9 ? `${(vol/1e9).toFixed(1)}B` : vol >= 1e6 ? `${(vol/1e6).toFixed(0)}M` : `${(vol/1e3).toFixed(0)}K`}</span>
                    </div>
                  );
                })
            ) : (
              <span style={{ fontSize: 11, color: '#475569' }}>点击刷新</span>
            )}
          </div>

          {/* 暴跌榜 */}
          <div className="ranking-column" style={{ flex: 1, background: '#25263a', borderRadius: 8, padding: '8px 10px' }}>
            <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, marginBottom: 4, display: 'block' }}>❄️ 暴跌榜</span>
            {marketTickers.length > 0 ? (
              [...marketTickers]
                .sort((a: any, b: any) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent))
                .slice(0, 3)
                .map((t: any, i: number) => {
                  const vol = parseFloat(t.quoteVolume);
                  return (
                    <div key={t.symbol} style={{ display: 'flex', alignItems: 'center', fontSize: 11, padding: '2px 0' }}>
                      <span style={{ color: ['#22c55e', '#4ade80', '#86efac'][i], fontWeight: 700, minWidth: 14 }}>{i + 1}.</span>
                      <span style={{ fontWeight: 600, margin: '0 4px', flex: 1 }}>{t.symbol.replace('USDT', '')}</span>
                      <span style={{ color: '#22c55e', fontWeight: 700 }}>{parseFloat(t.priceChangePercent).toFixed(2)}%</span>
                      <span style={{ color: '#475569', fontSize: 10, marginLeft: 6 }}>💹{vol >= 1e9 ? `${(vol/1e9).toFixed(1)}B` : vol >= 1e6 ? `${(vol/1e6).toFixed(0)}M` : `${(vol/1e3).toFixed(0)}K`}</span>
                    </div>
                  );
                })
            ) : (
              <span style={{ fontSize: 11, color: '#475569' }}>点击刷新</span>
            )}
          </div>
        </div>

        {/* 第三行：蓄势突破亮点 */}
        {breakoutCandidates.length > 0 && (
          <div style={{ marginTop: 10, borderTop: '1px solid #2d2e3d', paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>🔥 蓄势突破亮点</span>
              <a href="/strategy-lab" style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'none' }}>查看全部 →</a>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {breakoutCandidates.slice(0, 3).map((c) => {
                const phaseColor = c.phase === 'both' ? '#ef4444' : c.phase === 'accumulating' ? '#f59e0b' : '#22c55e';
                const phaseLabel = c.phase === 'both' ? '🔥 爆发' : c.phase === 'accumulating' ? '⏳ 蓄势' : '🚀 突破';
                const changeColor = c.priceChange24h >= 0 ? '#ef4444' : '#22c55e';
                return (
                  <div key={c.symbol} style={{
                    background: '#25263a',
                    border: `1px solid ${phaseColor}30`,
                    borderRadius: 10,
                    padding: '8px 12px',
                    minWidth: 170,
                    flex: '0 1 auto',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>
                        {c.symbol.replace('USDT', '')}
                      </span>
                      <span style={{ fontSize: 10, color: phaseColor, fontWeight: 600, background: `${phaseColor}20`, padding: '1px 6px', borderRadius: 4 }}>
                        {phaseLabel}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: '#64748b' }}>评分 {c.score.toFixed(1)}</span>
                      <span style={{ color: changeColor, fontWeight: 600 }}>
                        {c.priceChange24h >= 0 ? '+' : ''}{c.priceChange24h.toFixed(2)}%
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                      蓄{c.accumulationScore.toFixed(1)} / 突{c.breakoutScore.toFixed(1)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 警告提示：侥幸交易 */}
      {luckyTrades.length > 0 && (
        <div className="lucky-warning">
          <span className="warning-icon">⚠️</span>
          <div>
            <strong>发现 {luckyTrades.length} 笔侥幸交易！</strong>
            <p>这些交易盈利但 MAE 过大，不代表真实交易能力。查看{' '}
              <a href="/trades" className="warning-link">交易记录</a> 了解详情。
            </p>
          </div>
        </div>
      )}

      {/* 核心指标卡片 */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">总盈亏</div>
          <div className="stat-value" style={{ color: getPnlColor(totalPnl) }}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} USDT
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">胜率</div>
          <div className="stat-value">{winRate.toFixed(1)}%</div>
          <div className="stat-sub">{winningTrades.length}/{closedTrades.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">盈亏比</div>
          <div className="stat-value">
            {profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}
          </div>
          <div className="stat-sub">均盈 {avgWin.toFixed(0)} / 均亏 {avgLoss.toFixed(0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">平均执行分</div>
          <div className="stat-value" style={{ color: getScoreColor(avgScore) }}>
            {avgScore.toFixed(0)} 分
          </div>
          <div className="stat-sub">已评分 {scoredTrades.length} 笔</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">已平仓</div>
          <div className="stat-value">{closedTrades.length} 笔</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">持仓中</div>
          <div className="stat-value" style={{ color: '#f59e0b' }}>
            {openTrades.length} 笔
          </div>
        </div>
      </div>

      {/* 图表区 */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>权益曲线</h3>
          {equityData.length <= 1 ? (
            <div className="chart-empty">暂无已平仓交易数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={equityData}>
                <defs>
                  <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
                <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d', color: '#e2e8f0' }}
                  formatter={(value: number, _: string, props: any) => [
                    `${value.toFixed(2)} USDT`,
                    props.payload.tradeLabel || '权益',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#colorEquity)"
                  dot={false}
                  activeDot={{ r: 5, fill: '#3b82f6' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-card">
          <h3>月度盈亏</h3>
          {monthlyData.length === 0 ? (
            <div className="chart-empty">暂无已平仓交易数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
                <XAxis dataKey="month" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d', color: '#e2e8f0' }}
                  formatter={(value: number) => [`${value.toFixed(2)} USDT`, '盈亏']}
                />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {monthlyData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.pnl >= 0 ? '#ef4444' : '#22c55e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 品种盈亏分布 */}
      {symbolData.length > 0 && (
        <div className="chart-card full-width">
          <h3>品种盈亏分布</h3>
          <div className="symbol-breakdown">
            {symbolData.slice(0, 8).map((s) => (
              <div key={s.symbol} className="symbol-bar-row">
                <div className="symbol-bar-label">
                  <span className="symbol-name">{s.symbol}</span>
                  <span className="symbol-count">{s.count}笔</span>
                  <span className="symbol-winrate">{s.winRate.toFixed(0)}%胜率</span>
                </div>
                <div className="symbol-bar-value" style={{ color: getPnlColor(s.pnl) }}>
                  {s.pnl >= 0 ? '+' : ''}{s.pnl.toFixed(0)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最近交易 */}
      <div className="recent-trades">
        <h3>
          最近交易
          <span className="recent-trade-count">最近5笔平仓</span>
        </h3>
        {recentTrades.length === 0 ? (
          <div className="chart-empty">暂无已平仓交易</div>
        ) : (
          <table className="trades-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>品种</th>
                <th>方向</th>
                <th>盈亏</th>
                <th>执行分</th>
                <th>来源</th>
                <th>侥幸?</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((trade) => {
                const review = reviews.find((r) => r.tradeId === trade.id);
                const score = trade.executionScore || calcExecutionScore({ trade, review: review ?? null });
                const source = getTradeSource(trade);
                return (
                  <tr key={trade.id} className={trade.isLuckyTrade ? 'lucky-row' : ''}>
                    <td>{new Date(trade.exitTime || trade.entryTime).toLocaleDateString('zh-CN')}</td>
                    <td className="symbol-cell">{trade.symbol}</td>
                    <td>
                      <span className={`dir-badge ${trade.direction.toLowerCase()}`}>
                        {trade.direction === 'LONG' ? '多' : '空'}
                      </span>
                    </td>
                    <td style={{ color: getPnlColor(trade.pnl || 0), fontWeight: 600 }}>
                      {(trade.pnl || 0) >= 0 ? '+' : ''}{(trade.pnl || 0).toFixed(2)}
                    </td>
                    <td>
                      <span className="score-badge" style={{ background: getScoreColor(score), color: '#fff' }}>
                        {score}
                      </span>
                    </td>
                    <td>
                      {source === 'REAL' ? (
                        <span className="source-tag real">真实</span>
                      ) : source === 'MOCK' ? (
                        <span className="source-tag mock">模拟</span>
                      ) : (
                        <span className="source-tag manual">手动</span>
                      )}
                    </td>
                    <td>
                      {trade.isLuckyTrade && <span className="lucky-badge" title={trade.luckyReason}>⚠️ 侥幸</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
