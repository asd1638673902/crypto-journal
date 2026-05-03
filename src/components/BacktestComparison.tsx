/**
 * 回测结果对比组件
 * 支持多个策略/参数的回测结果并排对比
 */

import type { BacktestResult } from '../lib/strategyMetrics';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface ComparisonEntry {
  id: string;
  label: string;
  result: BacktestResult;
}

interface Props {
  entries: ComparisonEntry[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

const METRIC_LABELS: Record<string, string> = {
  totalPnlPercent: '总收益率 %',
  totalPnlUsdt: '总盈亏 USDT',
  winRate: '胜率 %',
  profitFactor: '盈亏比',
  sharpeRatio: '夏普比率',
  sortinoRatio: '索提诺比率',
  calmarRatio: '卡玛比率',
  maxDrawdownPercent: '最大回撤 %',
  totalTrades: '交易笔数',
  expectancy: '期望值',
  avgWin: '平均盈利',
  avgLoss: '平均亏损',
};

/** 返回字符串表示的指标值 */
function getMetricValue(r: BacktestResult, key: string): string {
  const v = (r as any)[key];
  if (v === undefined || v === null) return '-';
  if (typeof v === 'number') {
    if (['totalPnlPercent', 'winRate', 'maxDrawdownPercent', 'avgWin', 'avgLoss', 'expectancy'].includes(key)) {
      return v.toFixed(2);
    }
    if (['totalPnlUsdt'].includes(key)) {
      return v.toFixed(2);
    }
    if (['sharpeRatio', 'sortinoRatio', 'calmarRatio'].includes(key)) {
      return v.toFixed(2);
    }
    return String(v);
  }
  if (key === 'profitFactor' && v === Infinity) return '∞';
  return String(v);
}

/** 根据值返回颜色 */
function getMetricColor(key: string, value: number): string {
  if (['totalPnlPercent', 'totalPnlUsdt', 'avgWin', 'expectancy', 'profitFactor'].includes(key)) {
    return value >= 0 ? '#ef4444' : '#22c55e';
  }
  if (['winRate', 'sharpeRatio', 'sortinoRatio', 'calmarRatio'].includes(key)) {
    return value >= 0 ? '#ef4444' : '#22c55e';
  }
  if (['maxDrawdownPercent', 'avgLoss'].includes(key)) {
    return '#ef4444';
  }
  return '#e2e8f0';
}

export default function BacktestComparison({ entries, onRemove, onClearAll }: Props) {
  if (entries.length === 0) return null;

  // 构建对比图表数据（权益曲线叠加）
  const equityData: { trade: string; [key: string]: any }[] = [];
  const maxLen = Math.max(...entries.map((e) => e.result.equityUsdtCurve.length));
  for (let i = 0; i < maxLen; i++) {
    const point: any = { trade: `#${i + 1}` };
    for (const entry of entries) {
      const curve = entry.result.equityUsdtCurve;
      point[entry.label] = i < curve.length ? curve[i].equity : null;
    }
    equityData.push(point);
  }

  const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

  return (
    <div className="bt-comparison">
      <div className="comparison-header">
        <h3>📊 回测结果对比 ({entries.length} 个)</h3>
        <button className="btn-clear" onClick={onClearAll}>清空全部</button>
      </div>

      {/* 权益曲线叠加图 */}
      {equityData.length > 0 && (
        <div className="chart-card" style={{ marginTop: 8 }}>
          <h4>权益曲线对比</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={equityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
              <XAxis dataKey="trade" stroke="#64748b" fontSize={9} />
              <YAxis stroke="#64748b" fontSize={9} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}K` : v.toFixed(0)} />
              <Tooltip contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d', color: '#e2e8f0' }} />
              <Legend />
              {entries.map((entry, i) => (
                <Bar key={entry.id} dataKey={entry.label} fill={COLORS[i % COLORS.length]} opacity={0.8} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 指标对比表 */}
      <div className="table-container" style={{ marginTop: 12 }}>
        <table className="comparison-table">
          <thead>
            <tr>
              <th>指标</th>
              {entries.map((entry, i) => (
                <th key={entry.id} style={{ color: COLORS[i % COLORS.length] }}>
                  {entry.label}
                  <button className="btn-remove" onClick={() => onRemove(entry.id)} title="移除">×</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(METRIC_LABELS).map(([key, label]) => (
              <tr key={key}>
                <td className="metric-name">{label}</td>
                {entries.map((entry, i) => {
                  const v = (entry.result as any)[key];
                  const color = typeof v === 'number' ? getMetricColor(key, v) : undefined;
                  const bestKey = ['totalPnlPercent', 'totalPnlUsdt', 'winRate', 'profitFactor', 'sharpeRatio', 'sortinoRatio', 'calmarRatio', 'expectancy'];
                  const isBest = bestKey.includes(key) && typeof v === 'number' &&
                    v === Math.max(...entries.map(e => (e.result as any)[key]).filter((x: any) => typeof x === 'number'));
                  return (
                    <td key={entry.id} style={{ color, fontWeight: isBest ? 700 : 400 }}>
                      {getMetricValue(entry.result, key)}
                      {isBest && key !== 'maxDrawdownPercent' && ' 👑'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 交易明细摘要 */}
      {entries.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', color: '#64748b', fontSize: 13 }}>📋 查看各结果交易明细摘要</summary>
          {entries.map((entry) => (
            <div key={entry.id} className="comparison-detail" style={{ marginTop: 8, padding: 8, background: '#1a1b23', borderRadius: 6 }}>
              <strong style={{ color: COLORS[entries.indexOf(entry) % COLORS.length] }}>{entry.label}</strong>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0' }}>
                周期: {new Date(entry.result.startTime).toLocaleDateString('zh-CN')} → {new Date(entry.result.endTime).toLocaleDateString('zh-CN')}
                &nbsp;|&nbsp; {entry.result.totalBars} 根K线
              </p>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                最优交易: <span style={{ color: '#ef4444' }}>+{entry.result.bestTrade}</span>
                &nbsp;|&nbsp; 最差交易: <span style={{ color: '#22c55e' }}>{entry.result.worstTrade}</span>
                &nbsp;|&nbsp; 平均持有: {entry.result.avgHoldingBars} K线
              </div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
