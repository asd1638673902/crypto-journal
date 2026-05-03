/**
 * 多时间框架（MTF）分析面板
 * 展示各周期趋势一致性、共振信号、假突破过滤
 */

import { useState, useCallback } from 'react';
import { fetchKlines, type KlineData, type KlineInterval } from '../lib/exchange';
import { analyzeMultiTimeframe, type MtfAnalysisResult, type MtfConsensus } from '../lib/mtfAnalysis';

const INTERVALS: KlineInterval[] = ['1h', '4h', '1d'];
const INTERVAL_LABELS: Record<string, string> = { '1h': '1小时', '4h': '4小时', '1d': '日线' };

const ALIGNMENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  STRONG_BULLISH: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e', border: 'rgba(34,197,94,0.4)' },
  BULLISH:        { bg: 'rgba(34,197,94,0.08)', text: '#4ade80', border: 'rgba(34,197,94,0.25)' },
  NEUTRAL:        { bg: 'rgba(245,158,11,0.08)', text: '#f59e0b', border: 'rgba(245,158,11,0.25)' },
  BEARISH:        { bg: 'rgba(239,68,68,0.08)',  text: '#fb923c', border: 'rgba(239,68,68,0.25)' },
  STRONG_BEARISH: { bg: 'rgba(239,68,68,0.15)',  text: '#ef4444', border: 'rgba(239,68,68,0.4)' },
};

const ALIGNMENT_LABELS: Record<string, string> = {
  STRONG_BULLISH: '强烈看多',
  BULLISH: '偏多',
  NEUTRAL: '中性',
  BEARISH: '偏空',
  STRONG_BEARISH: '强烈看空',
};

function ConsensusBadge({ consensus }: { consensus: MtfConsensus }) {
  const style = ALIGNMENT_COLORS[consensus.alignment] || ALIGNMENT_COLORS.NEUTRAL;
  return (
    <div style={{
      background: style.bg,
      border: `1px solid ${style.border}`,
      borderRadius: 8,
      padding: '10px 16px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <span style={{ fontSize: 24, fontWeight: 800, color: style.text }}>
        {consensus.score > 0 ? '+' : ''}{consensus.score.toFixed(0)}
      </span>
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontWeight: 700, color: style.text, fontSize: 14 }}>
          {ALIGNMENT_LABELS[consensus.alignment]}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', maxWidth: 280 }}>
          {consensus.description}
        </div>
      </div>
    </div>
  );
}

function TimeframeRow({ analysis }: { analysis: MtfAnalysisResult['timeframeAnalyses'][0] }) {
  const trendColor = analysis.trendDirection === 'BULLISH' ? '#ef4444' : analysis.trendDirection === 'BEARISH' ? '#22c55e' : '#f59e0b';
  const trendText = analysis.trendDirection === 'BULLISH' ? '涨' : analysis.trendDirection === 'BEARISH' ? '跌' : '横';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 12px',
      background: '#1a1b23',
      borderRadius: 6,
      marginBottom: 6,
      fontSize: 13,
    }}>
      <span style={{ fontWeight: 700, color: '#e2e8f0', minWidth: 50 }}>{INTERVAL_LABELS[analysis.interval]}</span>
      <span style={{
        background: `${trendColor}15`,
        color: trendColor,
        padding: '2px 8px',
        borderRadius: 4,
        fontWeight: 600,
        fontSize: 12,
      }}>
        {trendText}
      </span>
      <div style={{ flex: 1, minWidth: 80 }}>
        <div style={{
          height: 6,
          background: '#2d2e3d',
          borderRadius: 3,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${analysis.trendStrength}%`,
            height: '100%',
            background: trendColor,
            borderRadius: 3,
            transition: 'width 0.5s ease',
          }} />
        </div>
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>强度 {analysis.trendStrength}/100</div>
      </div>
      <span style={{ color: analysis.emaAlignment ? '#22c55e' : '#64748b', fontSize: 11, whiteSpace: 'nowrap' }}>
        {analysis.emaAlignment ? '✅ EMA排列' : '— EMA排列'}
      </span>
      <span style={{ color: '#94a3b8', fontSize: 11, minWidth: 70, textAlign: 'right' }}>
        ${analysis.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function BreakoutCard({ validation }: { validation: MtfAnalysisResult['breakoutValidation'] }) {
  return (
    <div style={{
      background: '#1a1b23',
      border: `1px solid ${validation.isValid ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
      borderRadius: 8,
      padding: 12,
      marginTop: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{validation.isValid ? '✅' : '⚠️'}</span>
        <span style={{ fontWeight: 700, color: validation.isValid ? '#22c55e' : '#f59e0b' }}>
          突破验证: {validation.isValid ? '有效' : '存疑'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
          置信度 {validation.confidence}%
        </span>
      </div>

      {validation.confirmations.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4, fontWeight: 600 }}>确认信号</div>
          {validation.confirmations.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: '#94a3b8', paddingLeft: 12, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 2, top: 2, color: '#22c55e' }}>✓</span>
              {c}
            </div>
          ))}
        </div>
      )}

      {validation.warnings.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4, fontWeight: 600 }}>风险提示</div>
          {validation.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: '#94a3b8', paddingLeft: 12, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 2, top: 2, color: '#f59e0b' }}>!</span>
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OpportunityCard({ op, index }: { op: MtfAnalysisResult['opportunities'][0]; index: number }) {
  const isLong = op.direction === 'LONG';
  return (
    <div style={{
      background: '#1a1b23',
      border: `1px solid ${isLong ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{
          background: isLong ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: isLong ? '#22c55e' : '#ef4444',
          padding: '2px 10px',
          borderRadius: 4,
          fontWeight: 700,
          fontSize: 13,
        }}>
          {isLong ? '做多' : '做空'}
        </span>
        <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{op.symbol}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
          置信度 {op.confidence}% | 主周期 {INTERVAL_LABELS[op.primaryInterval]}
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
        gap: 8,
        fontSize: 12,
        marginBottom: 8,
      }}>
        <div style={{ background: '#11121a', padding: '6px 8px', borderRadius: 4 }}>
          <div style={{ color: '#64748b', fontSize: 10 }}>入场区间</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600 }}>
            {op.entryZone.low.toFixed(2)} ~ {op.entryZone.high.toFixed(2)}
          </div>
        </div>
        <div style={{ background: '#11121a', padding: '6px 8px', borderRadius: 4 }}>
          <div style={{ color: '#64748b', fontSize: 10 }}>止损</div>
          <div style={{ color: '#ef4444', fontWeight: 600 }}>{op.stopLoss.toFixed(2)}</div>
        </div>
        <div style={{ background: '#11121a', padding: '6px 8px', borderRadius: 4 }}>
          <div style={{ color: '#64748b', fontSize: 10 }}>止盈</div>
          <div style={{ color: '#22c55e', fontWeight: 600 }}>{op.takeProfit.map((t) => t.toFixed(2)).join(' / ')}</div>
        </div>
        <div style={{ background: '#11121a', padding: '6px 8px', borderRadius: 4 }}>
          <div style={{ color: '#64748b', fontSize: 10 }}>风险回报比</div>
          <div style={{ color: '#f59e0b', fontWeight: 700 }}>1 : {op.riskReward.toFixed(1)}</div>
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
        {op.reason}
      </div>
    </div>
  );
}

export default function MtfAnalysisPanel() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MtfAnalysisResult | null>(null);

  const handleAnalyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const dataMap = new Map<KlineInterval, KlineData[]>();

      // 并行获取三个周期的K线
      await Promise.all(
        INTERVALS.map(async (interval) => {
          try {
            const endTime = Date.now();
            const startTime = endTime - 90 * 24 * 60 * 60 * 1000; // 90天
            const klines = await fetchKlines({ symbol, interval, startTime, endTime, limit: 500 });
            if (klines.length >= 50) {
              dataMap.set(interval, klines);
            }
          } catch (e) {
            console.warn(`[MTF] 获取 ${interval} 数据失败`, e);
          }
        })
      );

      if (dataMap.size === 0) {
        setError('未能获取任何周期数据，请检查网络连接');
        return;
      }

      const analysis = analyzeMultiTimeframe(dataMap, symbol);
      setResult(analysis);
    } catch (err: any) {
      setError(err.message || '多时间框架分析失败');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  return (
    <div className="lab-panel">
      <div className="bt-config">
        <div className="config-grid" style={{ gridTemplateColumns: '1fr auto' }}>
          <div className="config-field">
            <label>品种</label>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="如 BTCUSDT"
            />
          </div>
          <button className="btn-run" onClick={handleAnalyze} disabled={loading} style={{ alignSelf: 'flex-end' }}>
            {loading ? '⏳ 分析中...' : '🔬 MTF 深度分析'}
          </button>
        </div>
        {loading && (
          <p className="optimizing-hint">正在并行获取 1小时 / 4小时 / 日线 数据...</p>
        )}
      </div>

      {error && <div className="status-bar error">{error}</div>}

      {result && (
        <div className="bt-result" style={{ marginTop: 12 }}>
          {/* 一致性评分 */}
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 8, fontSize: 16 }}>多周期一致性</h3>
            <ConsensusBadge consensus={result.consensus} />
          </div>

          {/* 各周期详情 */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8, fontSize: 14, color: '#94a3b8' }}>各周期状态</h4>
            {result.timeframeAnalyses.map((a) => (
              <TimeframeRow key={a.interval} analysis={a} />
            ))}
          </div>

          {/* 突破验证 */}
          <BreakoutCard validation={result.breakoutValidation} />

          {/* 交易机会 */}
          {result.opportunities.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8, fontSize: 14, color: '#94a3b8' }}>交易机会 ({result.opportunities.length})</h4>
              {result.opportunities.map((op, i) => (
                <OpportunityCard key={i} op={op} index={i} />
              ))}
            </div>
          )}

          {/* 摘要 */}
          <div className="status-bar info" style={{ marginTop: 16, fontSize: 12 }}>
            {result.summary}
          </div>
        </div>
      )}

      {!loading && !result && !error && (
        <div className="status-bar info" style={{ marginTop: 16 }}>
          输入品种后点击「MTF 深度分析」，系统将并行分析 1小时 / 4小时 / 日线 三个周期的趋势一致性
        </div>
      )}
    </div>
  );
}
