/**
 * 市场捕捉 — 一体化行情监控 · 扫描发现 · 深度分析
 * 合并：市场扫描 + 智能分析 + MTF分析，重新优化交互流程
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { fetchKlines, type KlineData, type KlineInterval } from '../lib/exchange';
import { analyzeMarket, type MarketAnalysisResult } from '../lib/marketAnalysis';
import { analyzeMultiTimeframe, type MtfAnalysisResult, type MtfConsensus } from '../lib/mtfAnalysis';
import {
  scanBollingerSqueeze, scanVolumeBreakout, scanSmartVolume,
  scanConsecutiveCandles, scanFullAnalysis,
  scanAccumulationBreakout,
  type ScanResult, type AccumulationBreakoutResult,
} from '../lib/marketScanner';
import { createPlanFromSignal } from '../lib/tradePlan';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import './StrategyLab.css';
import './MarketCapture.css';

// ==================== 类型定义 ====================

interface Ticker24h {
  symbol: string;
  priceChangePercent: string;
  lastPrice: string;
  volume: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
}

type ScanTool = 'ticker' | 'tech' | 'scan' | 'analysis';

type AnalysisMode = 'single' | 'mtf';

const ALL_INTERVALS: KlineInterval[] = ['1h', '4h', '1d'];
const INTERVAL_LABELS: Record<string, string> = { '1h': '1小时', '4h': '4小时', '1d': '日线' };

// ==================== 快速行情看板 ====================

function MarketHeat({ tickers }: { tickers: Ticker24h[] }) {
  const topGainers = useMemo(() =>
    [...tickers]
      .filter((t) => t.symbol.endsWith('USDT'))
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 5),
    [tickers]
  );
  const topLosers = useMemo(() =>
    [...tickers]
      .filter((t) => t.symbol.endsWith('USDT'))
      .sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent))
      .slice(0, 5),
    [tickers]
  );
  const topVolume = useMemo(() =>
    [...tickers]
      .filter((t) => t.symbol.endsWith('USDT'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 5),
    [tickers]
  );

  const pctColor = (v: string) => {
    const n = parseFloat(v);
    return { color: n >= 0 ? '#ef4444' : '#22c55e', text: n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%` };
  };
  const fmtVol = (v: string) => {
    const n = parseFloat(v);
    return n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
  };
  const fmtPrice = (v: string) => parseFloat(v).toFixed(2);

  const MiniList = ({
    title, data, type,
  }: {
    title: string;
    data: Ticker24h[];
    type: 'gain' | 'loss' | 'vol';
  }) => (
    <div className="mc-heat-card">
      <div className="mc-heat-title">{title}</div>
      <div className="mc-heat-list">
        {data.map((t, i) => (
          <div key={t.symbol} className="mc-heat-row" style={{ cursor: 'pointer' }}>
            <span className="mc-heat-rank" style={{ color: i < 3 ? '#f59e0b' : '#64748b' }}>{i + 1}</span>
            <span className="mc-heat-symbol">{t.symbol.replace('USDT', '')}</span>
            {type === 'vol' ? (
              <span className="mc-heat-value" style={{ color: '#94a3b8' }}>{fmtVol(t.quoteVolume)}</span>
            ) : (
              <span className={`mc-heat-value ${type === 'gain' ? 'mc-up' : 'mc-down'}`}>
                {pctColor(t.priceChangePercent).text}
              </span>
            )}
            <span className="mc-heat-price">${fmtPrice(t.lastPrice)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mc-heat-grid">
      <MiniList title="🔥 涨幅 TOP5" data={topGainers} type="gain" />
      <MiniList title="❄️ 跌幅 TOP5" data={topLosers} type="loss" />
      <MiniList title="💹 成交量 TOP5" data={topVolume} type="vol" />
    </div>
  );
}

// ==================== 扫描工具面板 ====================

type TechScanType = 'breakout' | 'squeeze' | 'volume' | 'smart' | 'candle' | 'full';
type TickerSort = 'gainers' | 'losers' | 'volume';

function ScanPanel({ onSelectSymbol }: { onSelectSymbol: (symbol: string) => void }) {
  const [activeTool, setActiveTool] = useState<ScanTool>('ticker');
  const [tickerSort, setTickerSort] = useState<TickerSort>('gainers');
  const [tickerLimit, setTickerLimit] = useState(20);
  const [tickers, setTickers] = useState<Ticker24h[]>([]);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [tickerError, setTickerError] = useState<string | null>(null);

  const [techType, setTechType] = useState<TechScanType>('breakout');
  const [techLimit, setTechLimit] = useState(20);
  const [techLoading, setTechLoading] = useState(false);
  const [techResults, setTechResults] = useState<ScanResult[]>([]);
  const [techError, setTechError] = useState<string | null>(null);

  // 涨跌幅榜
  const scanTicker = useCallback(async () => {
    setTickerLoading(true);
    setTickerError(null);
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Ticker24h[] = await res.json();
      const usdt = data.filter((t) => t.symbol.endsWith('USDT'));
      const sorted = [...usdt].sort((a, b) => {
        if (tickerSort === 'gainers') return parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent);
        else if (tickerSort === 'losers') return parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent);
        else return parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume);
      });
      setTickers(sorted.slice(0, tickerLimit));
    } catch (e: any) {
      setTickerError(e.message);
    } finally {
      setTickerLoading(false);
    }
  }, [tickerSort, tickerLimit]);

  // 技术扫描
  const scanTech = useCallback(async () => {
    setTechLoading(true);
    setTechError(null);
    setTechResults([]);
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const allTickers: Ticker24h[] = await res.json();
      const symbols = allTickers.filter((t) => t.symbol.endsWith('USDT')).map((t) => t.symbol);
      const batchSize = 50;
      const allResults: ScanResult[] = [];
      const limitKlines = techType === 'breakout' || techType === 'full' ? 100 : 50;
      const interval = '1h';

      for (let start = 0; start < Math.min(symbols.length, 100); start += batchSize) {
        const batch = symbols.slice(start, start + batchSize);
        const promises = batch.map(async (sym) => {
          try {
            const raw = await (await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limitKlines}`)).json();
            const data: KlineData[] = (raw as any[][]).map((k) => ({
              time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
              low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]), closeTime: k[6],
            }));
            if (data.length < (techType === 'breakout' ? 50 : 30)) return null;

            switch (techType) {
              case 'squeeze': return scanBollingerSqueeze(data, sym);
              case 'volume': return scanVolumeBreakout(data, sym);
              case 'smart': return scanSmartVolume(data, sym);
              case 'candle': return scanConsecutiveCandles(data, sym, 'bullish', 3, 2.0);
              case 'breakout': return scanAccumulationBreakout(data, sym);
              case 'full': return scanFullAnalysis(data, sym);
              default: return null;
            }
          } catch { return null; }
        });
        const batchResults = (await Promise.all(promises)).filter((r): r is ScanResult => r !== null);
        allResults.push(...batchResults);
      }
      allResults.sort((a, b) => b.score - a.score);
      setTechResults(allResults.slice(0, techLimit));
    } catch (e: any) {
      setTechError(e.message);
    } finally {
      setTechLoading(false);
    }
  }, [techType, techLimit]);

  const handleClickSymbol = useCallback((symbol: string) => {
    if (activeTool !== 'ticker') {
      // 点击扫描结果，打开分析
      onSelectSymbol(symbol);
    }
  }, [activeTool, onSelectSymbol]);

  const pctColor = (v: string) => {
    const n = parseFloat(v);
    return { color: n >= 0 ? '#ef4444' : '#22c55e', text: n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%` };
  };
  const fmtVol = (v: string) => {
    const n = parseFloat(v);
    return n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
  };
  const fmtPrice = (v: string) => parseFloat(v).toFixed(2);

  return (
    <div className="mc-scan-panel">
      {/* 工具切换 */}
      <div className="mc-scan-tabs">
        <button
          className={`lab-tab small ${activeTool === 'ticker' ? 'active' : ''}`}
          onClick={() => setActiveTool('ticker')}
        >
          📊 涨跌幅榜
        </button>
        <button
          className={`lab-tab small ${activeTool === 'tech' ? 'active' : ''}`}
          onClick={() => setActiveTool('tech')}
        >
          🔍 技术扫描
        </button>
        <button
          className={`lab-tab small ${activeTool === 'analysis' ? 'active' : ''}`}
          onClick={() => setActiveTool('analysis')}
        >
          📐 智能分析
        </button>
      </div>

      {/* 涨跌幅榜 */}
      {activeTool === 'ticker' && (
        <div>
          <div className="bt-config" style={{ marginBottom: 12, padding: 12 }}>
            <div className="config-grid" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
              <div className="config-field">
                <label>排序</label>
                <select value={tickerSort} onChange={(e) => setTickerSort(e.target.value as TickerSort)}>
                  <option value="gainers">📈 涨幅榜</option>
                  <option value="losers">📉 跌幅榜</option>
                  <option value="volume">💹 成交量榜</option>
                </select>
              </div>
              <div className="config-field">
                <label>数量</label>
                <select value={tickerLimit} onChange={(e) => setTickerLimit(Number(e.target.value))}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
              <button className="btn-run" onClick={scanTicker} disabled={tickerLoading} style={{ alignSelf: 'flex-end' }}>
                {tickerLoading ? '⏳' : '🔍 扫描'}
              </button>
            </div>
          </div>
          {tickerError && <div className="status-bar error">{tickerError}</div>}
          {tickers.length > 0 && (
            <div className="table-container">
              <table className="trades-table">
                <thead>
                  <tr>
                    <th>#</th><th>品种</th><th>价格</th><th>24h涨跌</th><th>最高</th><th>最低</th><th>成交量</th><th>成交额</th>
                  </tr>
                </thead>
                <tbody>
                  {tickers.map((t, i) => {
                    const { text, color } = pctColor(t.priceChangePercent);
                    return (
                      <tr key={t.symbol} onClick={() => onSelectSymbol(t.symbol)} style={{ cursor: 'pointer' }}>
                        <td style={{ color: i < 3 ? '#f59e0b' : '#64748b', fontWeight: i < 3 ? 700 : 400 }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{t.symbol.replace('USDT', '')}</td>
                        <td>{fmtPrice(t.lastPrice)}</td>
                        <td style={{ color, fontWeight: 600 }}>{text}</td>
                        <td>{fmtPrice(t.highPrice)}</td>
                        <td>{fmtPrice(t.lowPrice)}</td>
                        <td>{fmtVol(t.volume)}</td>
                        <td style={{ color: '#94a3b8' }}>{fmtVol(t.quoteVolume)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!tickerLoading && tickers.length === 0 && !tickerError && (
            <div className="status-bar info" style={{ marginTop: 12 }}>点击「扫描」获取实时行情</div>
          )}
        </div>
      )}

      {/* 技术扫描 */}
      {activeTool === 'tech' && (
        <div>
          <div className="bt-config" style={{ marginBottom: 12, padding: 12 }}>
            <div className="config-grid" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
              <div className="config-field">
                <label>扫描类型</label>
                <select value={techType} onChange={(e) => setTechType(e.target.value as TechScanType)}>
                  <option value="breakout">🔥 蓄势突破</option>
                  <option value="squeeze">📊 布林带挤压</option>
                  <option value="volume">💹 成交量突破</option>
                  <option value="smart">🧠 智能信号</option>
                  <option value="candle">🕯️ K线形态</option>
                </select>
              </div>
              <div className="config-field">
                <label>数量</label>
                <select value={techLimit} onChange={(e) => setTechLimit(Number(e.target.value))}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                </select>
              </div>
              <button className="btn-run" onClick={scanTech} disabled={techLoading} style={{ alignSelf: 'flex-end' }}>
                {techLoading ? '⏳ 扫描中...' : '🔍 扫描'}
              </button>
            </div>
            {techLoading && <p className="optimizing-hint" style={{ margin: '8px 0 0' }}>正在扫描 100 个交易对...</p>}
          </div>
          {techError && <div className="status-bar error">{techError}</div>}
          {techResults.length > 0 && (
            <div className="bt-result">
              <h3>
                扫描结果
                <span className="result-period" style={{ marginLeft: 8 }}>{techResults.length} 个</span>
              </h3>
              <div className="table-container" style={{ marginTop: 8 }}>
                <table className="trades-table">
                  <thead>
                    <tr>
                      <th>评分</th><th>品种</th>
                      {techType === 'breakout' && <th>阶段</th>}
                      <th>信号</th>
                      {techType === 'breakout' && <th>明细</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {techResults.map((r) => {
                      const brk = techType === 'breakout' ? (r as AccumulationBreakoutResult) : null;
                      const phaseColor = brk?.phase === 'both' ? '#ef4444'
                        : brk?.phase === 'accumulating' ? '#f59e0b'
                        : brk?.phase === 'breaking_out' ? '#22c55e' : '#64748b';
                      const phaseLabel = brk?.phase === 'both' ? '🔥 爆发'
                        : brk?.phase === 'accumulating' ? '⏳ 蓄势'
                        : brk?.phase === 'breaking_out' ? '🚀 突破' : '➖';
                      return (
                        <tr key={r.symbol} onClick={() => onSelectSymbol(r.symbol)} style={{ cursor: 'pointer' }}>
                          <td>
                            <span className={`score-badge-sm ${r.score >= 7 ? 'high' : r.score >= 4 ? 'mid' : 'low'}`}>
                              {r.score.toFixed(1)}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{r.symbol.replace('USDT', '')}</td>
                          {techType === 'breakout' && (
                            <td>
                              <span style={{ color: phaseColor, fontWeight: 600, fontSize: 12, padding: '2px 6px', background: `${phaseColor}15`, borderRadius: 4 }}>
                                {phaseLabel}
                              </span>
                            </td>
                          )}
                          <td>
                            <div className="signal-list">
                              {r.signals.map((s, i) => <span key={i} className="signal-tag">{s}</span>)}
                            </div>
                          </td>
                          {techType === 'breakout' && brk && (
                            <td style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                              蓄{brk.accumulationScore.toFixed(1)} / 突{brk.breakoutScore.toFixed(1)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!techLoading && techResults.length === 0 && !techError && (
            <div className="status-bar info" style={{ marginTop: 12 }}>选择扫描类型后点击「扫描」</div>
          )}
        </div>
      )}

      {/* 智能分析（搜索入口） */}
      {activeTool === 'analysis' && (
        <div>
          <div className="bt-config" style={{ marginBottom: 12, padding: 12 }}>
            <div className="config-grid" style={{ gridTemplateColumns: '1fr auto' }}>
              <div className="config-field">
                <label>输入交易对</label>
                <SearchInput
                  placeholder="输入币种名称，如 BTC、ETH、SOL..."
                  onSearch={(sym) => {
                    const fullSym = sym.includes('USDT') ? sym.toUpperCase() : `${sym.toUpperCase()}USDT`;
                    onSelectSymbol(fullSym);
                  }}
                />
              </div>
            </div>
          </div>
          <p className="status-bar info" style={{ marginBottom: 10, fontSize: 12 }}>
            支持任意 USDT 交易对，也可以直接点击下面的热门品种快速查看
          </p>
          <div className="mc-analyze-quick">
            {['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'SUIUSDT', 'PEPEUSDT'].map((sym) => (
              <button
                key={sym}
                className="mc-quick-btn"
                onClick={() => onSelectSymbol(sym)}
              >
                {sym.replace('USDT', '')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 搜索输入框组件（回车触发搜索） =====
function SearchInput({ placeholder, onSearch }: { placeholder: string; onSearch: (value: string) => void }) {
  const [value, setValue] = useState('');
  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter' && value.trim()) {
      onSearch(value.trim());
    }
  };
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{ flex: 1 }}
      />
      <button
        className="btn-run"
        onClick={() => value.trim() && onSearch(value.trim())}
        disabled={!value.trim()}
        style={{ padding: '6px 16px', fontSize: 12 }}
      >
        🔍 分析
      </button>
    </div>
  );
}

// ==================== 深度分析面板 ====================

function AnalysisPanel({ symbol: externalSymbol, onScrollToPlans }: { symbol: string; onScrollToPlans: () => void }) {
  const [symbol, setSymbol] = useState(externalSymbol);
  const [mode, setMode] = useState<AnalysisMode>('single');
  const [interval, setInterval_] = useState<KlineInterval>('4h');
  const [days, setDays] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [singleAnalysis, setSingleAnalysis] = useState<MarketAnalysisResult | null>(null);
  const [mtfResult, setMtfResult] = useState<MtfAnalysisResult | null>(null);
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);

  // 当外部传入的 symbol 变化时同步
  useEffect(() => {
    if (externalSymbol) {
      setSymbol(externalSymbol);
    }
  }, [externalSymbol]);

  const handleAnalyze = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setSingleAnalysis(null);
    setMtfResult(null);
    setCurrentPrice(null);

    const fullSymbol = symbol.includes('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;

    try {
      // 统一获取当前实时价格（24hr ticker）
      let livePrice: number | null = null;
      try {
        const tickerRes = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${fullSymbol}`);
        if (tickerRes.ok) {
          const tickerData = await tickerRes.json();
          livePrice = parseFloat(tickerData.lastPrice);
          setCurrentPrice(livePrice);
        }
      } catch { /* 实时价格获取失败不影响核心分析 */ }

      if (mode === 'single') {
        const endTime = Date.now();
        const startTime = endTime - days * 24 * 60 * 60 * 1000;
        const data = await fetchKlines({ symbol: fullSymbol, interval, startTime, endTime, limit: 1000 });
        if (data.length < 30) {
          setError('K线数据不足');
          return;
        }
        setKlines(data);
        const result = analyzeMarket(data, fullSymbol, interval);
        // 用实时价格覆盖K线收盘价
        if (livePrice) {
          result.currentPrice = livePrice;
        }
        setSingleAnalysis(result);
      } else {
        const dataMap = new Map<KlineInterval, KlineData[]>();
        await Promise.all(
          ALL_INTERVALS.map(async (iv) => {
            try {
              const endTime = Date.now();
              const startTime = endTime - 90 * 24 * 60 * 60 * 1000;
              const klines = await fetchKlines({ symbol: fullSymbol, interval: iv, startTime, endTime, limit: 500 });
              if (klines.length >= 50) dataMap.set(iv, klines);
            } catch { /* skip */ }
          })
        );
        if (dataMap.size === 0) {
          setError('未能获取任何周期数据');
          return;
        }
        setMtfResult(analyzeMultiTimeframe(dataMap, fullSymbol, livePrice ?? undefined));
      }
    } catch (err: any) {
      setError(err.message || '分析失败');
    } finally {
      setLoading(false);
    }
  }, [symbol, mode, interval, days]);

  // 创建交易计划
  const handleCreatePlan = useCallback(() => {
    if (mode === 'single' && singleAnalysis?.opportunities[0]) {
      const op = singleAnalysis.opportunities[0];
      createPlanFromSignal({
        symbol: singleAnalysis.symbol,
        direction: op.direction,
        entryZone: op.entryZone,
        stopLoss: op.stopLoss,
        takeProfit: op.takeProfit,
        sourceInterval: interval,
        rationale: `来自智能分析 — ${op.reason}`,
      });
      onScrollToPlans();
    } else if (mode === 'mtf' && mtfResult?.opportunities[0]) {
      const op = mtfResult.opportunities[0];
      createPlanFromSignal({
        symbol: mtfResult.symbol,
        direction: op.direction,
        entryZone: op.entryZone,
        stopLoss: op.stopLoss,
        takeProfit: op.takeProfit,
        sourceScanType: 'mtf',
        mtfScore: mtfResult.consensus.score,
        rationale: `来自MTF分析 — ${op.reason}`,
      });
      onScrollToPlans();
    }
  }, [mode, singleAnalysis, mtfResult, interval, onScrollToPlans]);

  // 信号徽章
  const SignalBadge = ({ action, score }: { action: string; score: number }) => {
    const SIGNAL_COLORS: Record<string, string> = {
      STRONG_BUY: '#22c55e', BUY: '#4ade80', NEUTRAL: '#f59e0b', SELL: '#fb923c', STRONG_SELL: '#ef4444',
    };
    const SIGNAL_LABELS: Record<string, string> = {
      STRONG_BUY: '强烈买入', BUY: '买入', NEUTRAL: '中性', SELL: '卖出', STRONG_SELL: '强烈卖出',
    };
    const color = SIGNAL_COLORS[action] || '#64748b';
    return (
      <span style={{ background: `${color}20`, color, border: `1px solid ${color}40`, borderRadius: 8, padding: '4px 14px', fontWeight: 700, fontSize: 14, display: 'inline-block' }}>
        {SIGNAL_LABELS[action] || action} ({score > 0 ? '+' : ''}{score})
      </span>
    );
  };

  const LevelBar = ({ level }: { level: { price: number; type: string; strength: number; source: string; hits: number } }) => {
    const isSupport = level.type === 'support';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', borderLeft: `3px solid ${isSupport ? '#22c55e' : '#ef4444'}`, marginBottom: 2, fontSize: 11 }}>
        <span style={{ fontWeight: 600, width: 80 }}>{level.price.toFixed(2)}</span>
        <span style={{ background: isSupport ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: isSupport ? '#22c55e' : '#ef4444', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 500 }}>
          {isSupport ? '支撑' : '阻力'} {level.strength}/5
        </span>
        <span style={{ color: '#64748b', fontSize: 10, flex: 1 }}>{level.source}</span>
        <span style={{ color: '#94a3b8', fontSize: 10 }}>触碰 {level.hits} 次</span>
      </div>
    );
  };

  const ALIGNMENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    STRONG_BULLISH: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e', border: 'rgba(34,197,94,0.4)' },
    BULLISH: { bg: 'rgba(34,197,94,0.08)', text: '#4ade80', border: 'rgba(34,197,94,0.25)' },
    NEUTRAL: { bg: 'rgba(245,158,11,0.08)', text: '#f59e0b', border: 'rgba(245,158,11,0.25)' },
    BEARISH: { bg: 'rgba(239,68,68,0.08)', text: '#fb923c', border: 'rgba(239,68,68,0.25)' },
    STRONG_BEARISH: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444', border: 'rgba(239,68,68,0.4)' },
  };
  const ALIGNMENT_LABELS: Record<string, string> = {
    STRONG_BULLISH: '强烈看多', BULLISH: '偏多', NEUTRAL: '中性', BEARISH: '偏空', STRONG_BEARISH: '强烈看空',
  };

  if (!symbol) {
    return (
      <div className="mc-analysis-placeholder">
        <div className="mc-empty-state">
          <span style={{ fontSize: 48, opacity: 0.2 }}>📊</span>
          <h3 style={{ color: '#64748b', margin: '12px 0 4px' }}>点击扫描结果查看深度分析</h3>
          <p style={{ color: '#4a5568', fontSize: 13 }}>在扫描结果中点击任意品种，即可展开单周期/MFT分析</p>
        </div>
      </div>
    );
  }

  const fullSymbol = symbol.includes('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;

  return (
    <div className="mc-analysis-panel">
      <div className="mc-analysis-header">
        <div className="mc-analysis-symbol">
          <span className="mc-analysis-name">{fullSymbol.replace('USDT', '')}</span>
          <span className="mc-analysis-full">{fullSymbol}</span>
          {currentPrice && (
            <span className="mc-analysis-price" style={{
              fontSize: 18, fontWeight: 800, color: '#e2e8f0', marginLeft: 14,
            }}>
              ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400, marginLeft: 6 }}>实时</span>
            </span>
          )}
        </div>
        <div className="mc-analysis-controls">
          <div className="mc-analysis-mode">
            <button
              className={`lab-tab small ${mode === 'single' ? 'active' : ''}`}
              onClick={() => setMode('single')}
            >
              📊 单周期
            </button>
            <button
              className={`lab-tab small ${mode === 'mtf' ? 'active' : ''}`}
              onClick={() => setMode('mtf')}
            >
              🔬 多周期 (MTF)
            </button>
          </div>
          {mode === 'single' && (
            <div className="mc-analysis-config">
              <select value={interval} onChange={(e) => setInterval_(e.target.value as KlineInterval)} style={{ background: '#11121a', border: '1px solid #2d2e3d', borderRadius: 4, color: '#e2e8f0', padding: '4px 8px', fontSize: 12, marginRight: 6 }}>
                <option value="1h">1小时</option>
                <option value="4h">4小时</option>
                <option value="1d">日线</option>
              </select>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ background: '#11121a', border: '1px solid #2d2e3d', borderRadius: 4, color: '#e2e8f0', padding: '4px 8px', fontSize: 12, marginRight: 6 }}>
                <option value={30}>30天</option>
                <option value={60}>60天</option>
                <option value={90}>90天</option>
              </select>
            </div>
          )}
          <button className="btn-run" style={{ padding: '4px 14px', fontSize: 12 }} onClick={handleAnalyze} disabled={loading}>
            {loading ? '⏳' : '🔍 分析'}
          </button>
        </div>
      </div>

      {error && <div className="status-bar error" style={{ margin: '8px 0' }}>{error}</div>}

      {/* 单周期分析结果 */}
      {mode === 'single' && singleAnalysis && (
        <div className="mc-analysis-content">
          <div className="mc-analysis-summary" style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, marginBottom: 12 }}>
            {singleAnalysis.summary}
          </div>

          <div className="mc-analysis-columns">
            {/* 左列：信号 + 市场结构 */}
            <div className="mc-analysis-card">
              <h4 style={{ fontSize: 13, marginBottom: 8 }}>信号 & 结构</h4>
              <div style={{ marginBottom: 10 }}>
                <SignalBadge action={singleAnalysis.signal.action} score={singleAnalysis.signal.score} />
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                <div>趋势方向: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{singleAnalysis.structure.trend === 'BULLISH' ? '多头' : singleAnalysis.structure.trend === 'BEARISH' ? '空头' : '震荡'}</span></div>
                <div>趋势强度: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{singleAnalysis.structure.strength}/100</span></div>
                <div>ADX: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{singleAnalysis.structure.adx.toFixed(1)}</span></div>
                <div>波动率: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{singleAnalysis.structure.volatility === 'HIGH' ? '高' : singleAnalysis.structure.volatility === 'MEDIUM' ? '中' : '低'}</span></div>
                <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>{singleAnalysis.structure.phase}</div>
              </div>

              {singleAnalysis.signal.reasons.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>信号理由</div>
                  {singleAnalysis.signal.reasons.map((r, i) => (
                    <div key={i} style={{ fontSize: 11, color: '#94a3b8', paddingLeft: 10, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: '#3b82f6' }}>•</span>{r}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 右列：关键水平 */}
            <div className="mc-analysis-card">
              <h4 style={{ fontSize: 13, marginBottom: 8 }}>关键水平</h4>
              {singleAnalysis.keyLevels.length > 0 ? (
                singleAnalysis.keyLevels.map((l, i) => <LevelBar key={i} level={l} />)
              ) : (
                <div style={{ fontSize: 12, color: '#64748b' }}>无有效关键水平</div>
              )}
            </div>
          </div>

          {/* 交易机会 */}
          {singleAnalysis.opportunities.length > 0 && (
            <div className="mc-analysis-card" style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h4 style={{ fontSize: 13, margin: 0 }}>交易机会</h4>
                <button
                  onClick={handleCreatePlan}
                  style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#3b82f6', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
                >
                  + 创建计划
                </button>
              </div>
              {singleAnalysis.opportunities.map((op, i) => (
                <div key={i} className="mc-opportunity-row">
                  <span style={{ color: op.direction === 'LONG' ? '#ef4444' : '#22c55e', fontWeight: 700, fontSize: 13, minWidth: 40 }}>
                    {op.direction === 'LONG' ? '做多' : '做空'}
                  </span>
                  <span style={{ fontSize: 11, color: '#64748b', minWidth: 60 }}>
                    置信 {op.confidence}%
                  </span>
                  <span style={{ fontSize: 11 }}>
                    入场 <span style={{ color: '#e2e8f0' }}>{op.entryZone.low.toFixed(2)}~{op.entryZone.high.toFixed(2)}</span>
                  </span>
                  <span style={{ fontSize: 11 }}>
                    止损 <span style={{ color: '#ef4444' }}>{op.stopLoss.toFixed(2)}</span>
                  </span>
                  <span style={{ fontSize: 11 }}>
                    止盈 <span style={{ color: '#22c55e' }}>{op.takeProfit.map((t) => t.toFixed(2)).join('/')}</span>
                  </span>
                  <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, minWidth: 50 }}>
                    RR 1:{op.riskReward.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* K线图 */}
          {klines.length > 0 && (
            <div className="chart-card" style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 13 }}>价格走势</h4>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={klines.slice(-60).map((k) => ({ time: new Date(k.time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }), close: k.close }))}>
                  <defs>
                    <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={9} />
                  <YAxis stroke="#64748b" fontSize={9} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d', color: '#e2e8f0' }} />
                  <Area type="monotone" dataKey="close" stroke="#3b82f6" fill="url(#priceGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* MTF 分析结果 */}
      {mode === 'mtf' && mtfResult && (
        <div className="mc-analysis-content">
          <div className="mc-analysis-summary" style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, marginBottom: 12 }}>
            {mtfResult.summary}
          </div>

          <div className="mc-analysis-columns">
            {/* 一致性徽章 */}
            <div className="mc-analysis-card">
              <h4 style={{ fontSize: 13, marginBottom: 8 }}>多周期一致性</h4>
              <div style={{
                background: (ALIGNMENT_COLORS[mtfResult.consensus.alignment] || ALIGNMENT_COLORS.NEUTRAL).bg,
                border: `1px solid ${(ALIGNMENT_COLORS[mtfResult.consensus.alignment] || ALIGNMENT_COLORS.NEUTRAL).border}`,
                borderRadius: 8,
                padding: '10px 14px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: (ALIGNMENT_COLORS[mtfResult.consensus.alignment] || ALIGNMENT_COLORS.NEUTRAL).text }}>
                  {mtfResult.consensus.score > 0 ? '+' : ''}{mtfResult.consensus.score.toFixed(0)}
                </span>
                <div>
                  <div style={{ fontWeight: 700, color: (ALIGNMENT_COLORS[mtfResult.consensus.alignment] || ALIGNMENT_COLORS.NEUTRAL).text, fontSize: 13 }}>
                    {ALIGNMENT_LABELS[mtfResult.consensus.alignment]}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{mtfResult.consensus.description}</div>
                </div>
              </div>
            </div>

            {/* 各周期 */}
            <div className="mc-analysis-card">
              <h4 style={{ fontSize: 13, marginBottom: 8 }}>各周期状态</h4>
              {mtfResult.timeframeAnalyses.map((a) => {
                const trendColor = a.trendDirection === 'BULLISH' ? '#ef4444' : a.trendDirection === 'BEARISH' ? '#22c55e' : '#f59e0b';
                const trendText = a.trendDirection === 'BULLISH' ? '涨' : a.trendDirection === 'BEARISH' ? '跌' : '横';
                return (
                  <div key={a.interval} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11 }}>
                    <span style={{ fontWeight: 700, minWidth: 40, color: '#e2e8f0' }}>{INTERVAL_LABELS[a.interval]}</span>
                    <span style={{ background: `${trendColor}15`, color: trendColor, padding: '1px 6px', borderRadius: 3, fontWeight: 600, fontSize: 10 }}>
                      {trendText}
                    </span>
                    <div style={{ flex: 1, height: 4, background: '#2d2e3d', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${a.trendStrength}%`, height: '100%', background: trendColor, borderRadius: 2 }} />
                    </div>
                    <span style={{ color: '#64748b', minWidth: 30, textAlign: 'right' }}>{a.trendStrength}</span>
                    <span style={{ color: a.emaAlignment ? '#22c55e' : '#64748b' }}>{a.emaAlignment ? 'EMA✅' : '—'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 突破验证 */}
          <div className="mc-analysis-card" style={{ marginTop: 12 }}>
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>
              突破验证: <span style={{ color: mtfResult.breakoutValidation.isValid ? '#22c55e' : '#f59e0b' }}>
                {mtfResult.breakoutValidation.isValid ? '✅ 有效' : '⚠️ 存疑'}
              </span>
            </h4>
            {mtfResult.breakoutValidation.confirmations.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: '#22c55e', marginBottom: 2, fontWeight: 600 }}>确认信号</div>
                {mtfResult.breakoutValidation.confirmations.map((c, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#94a3b8', paddingLeft: 10, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#22c55e' }}>✓</span>{c}
                  </div>
                ))}
              </div>
            )}
            {mtfResult.breakoutValidation.warnings.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 2, fontWeight: 600 }}>风险提示</div>
                {mtfResult.breakoutValidation.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#94a3b8', paddingLeft: 10, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#f59e0b' }}>!</span>{w}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* MTF 交易机会 */}
          {mtfResult.opportunities.length > 0 && (
            <div className="mc-analysis-card" style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h4 style={{ fontSize: 13, margin: 0 }}>交易机会</h4>
                <button
                  onClick={handleCreatePlan}
                  style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#3b82f6', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
                >
                  + 创建计划
                </button>
              </div>
              {mtfResult.opportunities.map((op, i) => (
                <div key={i} className="mc-opportunity-row">
                  <span style={{ color: op.direction === 'LONG' ? '#ef4444' : '#22c55e', fontWeight: 700, fontSize: 13, minWidth: 40 }}>
                    {op.direction === 'LONG' ? '做多' : '做空'}
                  </span>
                  <span style={{ fontSize: 11, color: '#64748b', minWidth: 60 }}>
                    置信 {op.confidence}%
                  </span>
                  <span style={{ fontSize: 11 }}>
                    入场 <span style={{ color: '#e2e8f0' }}>{op.entryZone.low.toFixed(2)}~{op.entryZone.high.toFixed(2)}</span>
                  </span>
                  <span style={{ fontSize: 11 }}>
                    止损 <span style={{ color: '#ef4444' }}>{op.stopLoss.toFixed(2)}</span>
                  </span>
                  <span style={{ fontSize: 11 }}>
                    止盈 <span style={{ color: '#22c55e' }}>{op.takeProfit.map((t) => t.toFixed(2)).join('/')}</span>
                  </span>
                  <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, minWidth: 50 }}>
                    RR 1:{op.riskReward.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && !singleAnalysis && !mtfResult && !error && (
        <div className="status-bar info" style={{ marginTop: 12, textAlign: 'center' }}>
          点击「分析」按钮开始分析
        </div>
      )}
    </div>
  );
}

// ==================== 主页面 ====================

export default function MarketCapture() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [tickers, setTickers] = useState<Ticker24h[]>([]);
  const [heatLoading, setHeatLoading] = useState(false);
  const [planCreatedMsg, setPlanCreatedMsg] = useState(false);
  const [planKey, setPlanKey] = useState(0);

  // 加载行情数据
  useEffect(() => {
    let cancelled = false;
    setHeatLoading(true);
    fetch('https://fapi.binance.com/fapi/v1/ticker/24hr')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        if (!cancelled) {
          setTickers(data);
          setHeatLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setHeatLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSymbolClick = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
  }, []);

  const handleCreatePlan = useCallback(() => {
    setPlanCreatedMsg(true);
    setPlanKey((k) => k + 1);
    setTimeout(() => setPlanCreatedMsg(false), 3000);
  }, []);

  return (
    <div className="market-capture-page">
      {/* 页面标题 */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">🎯 市场捕捉</h1>
          <p className="page-subtitle">
            行情看板 · 扫描发现 · 深度分析 — 机会从发现到计划一气呵成
          </p>
        </div>
        <div className="page-header-actions">
          {planCreatedMsg && <span className="source-tag success">✅ 交易计划已创建</span>}
        </div>
      </div>

      {/* 行情看板 */}
      <div className="mc-section">
        <div className="mc-section-header">
          <h3 className="mc-section-title">🔥 市场热力图</h3>
          <span className="mc-section-hint">24小时涨跌幅排行，点击品种进入分析</span>
        </div>
        {tickers.length > 0 ? (
          <MarketHeat tickers={tickers} />
        ) : (
          <div className="status-bar info" style={{ textAlign: 'center', padding: 20 }}>
            {heatLoading ? '加载行情数据...' : '点击下方扫描获取行情数据'}
          </div>
        )}
      </div>

      {/* 扫描 + 分析 上下结构 */}
      <div className="mc-main-layout">
        {/* 左侧：扫描工具 */}
        <div className="mc-left">
          <div className="mc-section">
            <div className="mc-section-header">
              <h3 className="mc-section-title">🔍 扫描发现</h3>
              <span className="mc-section-hint">选择扫描方式，点击结果查看深度分析</span>
            </div>
            <ScanPanel onSelectSymbol={handleSymbolClick} />
          </div>
        </div>

        {/* 右侧：深度分析 */}
        <div className="mc-right">
          <div className="mc-section">
            <div className="mc-section-header">
              <h3 className="mc-section-title">📊 深度分析</h3>
              <span className="mc-section-hint">{selectedSymbol ? `分析 ${selectedSymbol}` : '点击扫描结果中的品种开始分析'}</span>
            </div>
            <AnalysisPanel symbol={selectedSymbol} onScrollToPlans={handleCreatePlan} />
          </div>
        </div>
      </div>
    </div>
  );
}
