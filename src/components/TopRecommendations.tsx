/**
 * 最推荐买入/卖出面板
 * 扫描多个热门币种，按信号强度排序
 */

import { useState, useCallback } from 'react';
import { fetchKlines, type KlineInterval } from '../lib/exchange';
import { analyzeMarket, rankRecommendations, type SymbolRecommendation } from '../lib/marketAnalysis';
import type { MarketAnalysisResult } from '../lib/marketAnalysis';

/** 热门币种列表（Binance USDT 交易对） */
const POPULAR_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 'FILUSDT',
  'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'PEPEUSDT',
  'INJUSDT', 'TIAUSDT', 'SEIUSDT', 'NEARUSDT', 'FTMUSDT',
];

const INTERVAL_LABELS: Record<string, string> = {
  '15m': '15分钟', '1h': '1小时', '4h': '4小时', '1d': '日线',
};

function RecommendationCard({ rec, rank, type }: { rec: SymbolRecommendation; rank: number; type: 'buy' | 'sell' }) {
  const isBuy = type === 'buy';
  const borderColor = isBuy
    ? ['#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#dcfce7'][rank]
    : ['#ef4444', '#f87171', '#fca5a5', '#fecaca', '#fee2e2'][rank];

  return (
    <div className="rec-card" style={{
      background: '#1a1b23',
      border: `1px solid ${borderColor}40`,
      borderRadius: 8,
      padding: '10px 12px',
      marginBottom: 6,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      {/* 排名 */}
      <div style={{
        width: 24, height: 24,
        borderRadius: '50%',
        background: `${borderColor}20`,
        color: borderColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 12,
        flexShrink: 0,
      }}>
        {rank + 1}
      </div>

      {/* 品种 */}
      <div style={{ minWidth: 80 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>
          {rec.symbol.replace('USDT', '')}
        </div>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          ${rec.price.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
        </div>
      </div>

      {/* 信号强度进度条 */}
      <div style={{ flex: 1, minWidth: 80 }}>
        <div style={{
          height: 16,
          background: '#2d2e3d',
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            width: `${Math.abs(rec.score)}%`,
            height: '100%',
            background: isBuy ? '#22c55e' : '#ef4444',
            borderRadius: 8,
            transition: 'width 0.3s',
          }} />
        </div>
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, textAlign: 'right' }}>
          {rec.score > 0 ? '+' : ''}{Math.abs(rec.score)}
        </div>
      </div>

      {/* 信号标签 */}
      <div style={{
        fontSize: 11,
        color: borderColor,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        padding: '2px 6px',
        background: `${borderColor}15`,
        borderRadius: 4,
        minWidth: 50,
        textAlign: 'center',
      }}>
        {isBuy ? '买入' : '卖出'}
      </div>

      {/* 趋势 */}
      <div style={{
        fontSize: 11,
        color: rec.structure.trend === 'BULLISH' ? '#22c55e' : rec.structure.trend === 'BEARISH' ? '#ef4444' : '#f59e0b',
        whiteSpace: 'nowrap',
        minWidth: 45,
        textAlign: 'center',
      }}>
        {rec.structure.trend === 'BULLISH' ? '📈 多' : rec.structure.trend === 'BEARISH' ? '📉 空' : '➡️ 盘'}
      </div>
    </div>
  );
}

interface Props {
  onSelectSymbol?: (symbol: string) => void;
}

export default function TopRecommendations({ onSelectSymbol }: Props) {
  const [interval, setInterval_] = useState<KlineInterval>('4h');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topBuys, setTopBuys] = useState<SymbolRecommendation[]>([]);
  const [topSells, setTopSells] = useState<SymbolRecommendation[]>([]);
  const [scanProgress, setScanProgress] = useState('');

  const handleScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setScanProgress('正在获取数据...');

    try {
      const endTime = Date.now();
      const startTime = endTime - 60 * 24 * 60 * 60 * 1000; // 60天
      const analyses = new Map<string, MarketAnalysisResult>();
      let completed = 0;

      // 分批并行拉取
      const BATCH_SIZE = 5;
      for (let batch = 0; batch < POPULAR_SYMBOLS.length; batch += BATCH_SIZE) {
        const batchSymbols = POPULAR_SYMBOLS.slice(batch, batch + BATCH_SIZE);
        const batchPromises = batchSymbols.map(async (symbol) => {
          try {
            const klines = await fetchKlines({ symbol, interval, startTime, endTime, limit: 500 });
            if (klines.length >= 50) {
              const result = analyzeMarket(klines, symbol, interval);
              analyses.set(symbol, result);
            }
          } catch {
            // 单个币种失败不影响整体
          }
        });
        await Promise.all(batchPromises);
        completed += batchSymbols.length;
        setScanProgress(`扫描进度: ${completed}/${POPULAR_SYMBOLS.length}`);
      }

      const { topBuys: buys, topSells: sells } = rankRecommendations(analyses);
      setTopBuys(buys);
      setTopSells(sells);
      setScanProgress(`完成 — 分析 ${analyses.size} 个币种`);
    } catch (err: any) {
      setError(err.message || '扫描失败');
    } finally {
      setLoading(false);
    }
  }, [interval]);

  return (
    <div className="bt-result" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 15 }}>🎯 最推荐买卖 — 热门币种扫描</h4>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={interval}
            onChange={(e) => setInterval_(e.target.value as KlineInterval)}
            style={{
              background: '#1a1b23',
              color: '#e2e8f0',
              border: '1px solid #2d2e3d',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 12,
            }}
          >
            <option value="1h">1小时</option>
            <option value="4h">4小时</option>
            <option value="1d">日线</option>
          </select>
          <button
            className="btn-run"
            onClick={handleScan}
            disabled={loading}
            style={{ padding: '6px 14px', fontSize: 12 }}
          >
            {loading ? '⏳ 扫描中...' : '🔍 扫描'}
          </button>
        </div>
      </div>

      {scanProgress && (
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px 0' }}>{scanProgress}</p>
      )}

      {error && <div className="status-bar error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 最推荐买入 */}
        <div>
          <h5 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
            🟢 最推荐买入
            {topBuys.length > 0 && <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>({topBuys.length})</span>}
          </h5>
          {loading && !topBuys.length ? (
            <p style={{ color: '#64748b', fontSize: 12 }}>扫描中...</p>
          ) : topBuys.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: 12 }}>暂无推荐，请点击扫描</p>
          ) : (
            topBuys.map((rec, i) => (
              <div key={rec.symbol} onClick={() => onSelectSymbol?.(rec.symbol)} style={{ cursor: onSelectSymbol ? 'pointer' : 'default' }}>
                <RecommendationCard rec={rec} rank={i} type="buy" />
              </div>
            ))
          )}
        </div>

        {/* 最推荐卖出 */}
        <div>
          <h5 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
            🔴 最推荐卖出
            {topSells.length > 0 && <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>({topSells.length})</span>}
          </h5>
          {loading && !topSells.length ? (
            <p style={{ color: '#64748b', fontSize: 12 }}>扫描中...</p>
          ) : topSells.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: 12 }}>暂无推荐，请点击扫描</p>
          ) : (
            topSells.map((rec, i) => (
              <div key={rec.symbol} onClick={() => onSelectSymbol?.(rec.symbol)} style={{ cursor: onSelectSymbol ? 'pointer' : 'default' }}>
                <RecommendationCard rec={rec} rank={i} type="sell" />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
