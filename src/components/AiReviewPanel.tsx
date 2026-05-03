/**
 * AI 复盘助理面板
 * 月度报告 · 错误模式 · 情绪分析 · 改进建议
 */

import { useMemo, useState } from 'react';
import { getTrades, getReviews } from '../lib/db';
import { analyzeTrades } from '../lib/aiReview';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell,
} from 'recharts';

const SCORE_COLORS = ['#ef4444', '#ef4444', '#f59e0b', '#22c55e', '#22c55e', '#22c55e'];

export default function AiReviewPanel() {
  const [tab, setTab] = useState<'overview' | 'errors' | 'emotions' | 'symbols'>('overview');
  const [activeMonth, setActiveMonth] = useState<string | null>(null);

  const result = useMemo(() => {
    const trades = getTrades();
    const reviews = getReviews();
    return analyzeTrades(trades, reviews);
  }, []);

  const { currentMonth, summary, monthlyReports, topErrors, emotionPatterns, symbolPerformance, scoreTrend, improvementTips, monthOverMonth } = result;

  // 月度选择
  const selectedMonth = activeMonth || (currentMonth?.yearMonth ?? '');
  const selectedReport = monthlyReports.find(m => m.yearMonth === selectedMonth) || currentMonth;

  const fmtPnl = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  const pnlColor = (v: number) => v >= 0 ? '#ef4444' : '#22c55e';

  return (
    <div className="lab-panel">
      {/* 标题 */}
      <div className="page-header" style={{ marginBottom: 12 }}>
        <h1 className="page-title" style={{ fontSize: 16 }}>🤖 AI 复盘助理</h1>
        <p className="page-subtitle" style={{ fontSize: 12 }}>
          基于 {monthlyReports.reduce((s, m) => s + m.totalTrades, 0)} 笔已平仓交易 + {improvementTips.length} 条分析维度
        </p>
      </div>

      {/* 综合摘要 */}
      <div className="bt-result" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', lineHeight: 1.7 }}>{summary}</p>
          </div>
          {currentMonth && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: pnlColor(currentMonth.totalPnl) }}>
                {fmtPnl(currentMonth.totalPnl)} USDT
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                本月 {currentMonth.wins}胜/{currentMonth.losses}负
              </div>
            </div>
          )}
        </div>
        {monthOverMonth && (
          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11 }}>
            <span style={{ color: '#64748b' }}>
              环比盈亏: <span style={{ color: monthOverMonth.pnlChange >= 0 ? '#ef4444' : '#22c55e' }}>
                {monthOverMonth.pnlChange >= 0 ? '↑' : '↓'}{Math.abs(monthOverMonth.pnlChange)}%
              </span>
            </span>
            <span style={{ color: '#64748b' }}>
              胜率: <span style={{ color: monthOverMonth.winRateChange >= 0 ? '#ef4444' : '#22c55e' }}>
                {monthOverMonth.winRateChange >= 0 ? '+' : ''}{monthOverMonth.winRateChange}%
              </span>
            </span>
            <span style={{ color: '#64748b' }}>
              执行分: <span style={{ color: monthOverMonth.scoreChange >= 0 ? '#22c55e' : '#ef4444' }}>
                {monthOverMonth.scoreChange >= 0 ? '+' : ''}{monthOverMonth.scoreChange}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* 标签页 */}
      <div className="scanner-subtabs" style={{ marginBottom: 8 }}>
        <button className={`lab-tab small ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          📈 月度总览
        </button>
        <button className={`lab-tab small ${tab === 'errors' ? 'active' : ''}`} onClick={() => setTab('errors')}>
          ❌ 错误模式
        </button>
        <button className={`lab-tab small ${tab === 'emotions' ? 'active' : ''}`} onClick={() => setTab('emotions')}>
          🧠 情绪分析
        </button>
        <button className={`lab-tab small ${tab === 'symbols' ? 'active' : ''}`} onClick={() => setTab('symbols')}>
          📦 品种表现
        </button>
      </div>

      {/* ===== 月度总览 ===== */}
      {tab === 'overview' && (
        <>
          {/* 月度选择 */}
          {monthlyReports.length > 1 && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
              {[...monthlyReports].reverse().slice(0, 6).map(m => (
                <button
                  key={m.yearMonth}
                  onClick={() => setActiveMonth(m.yearMonth)}
                  style={{
                    padding: '3px 10px', border: `1px solid ${m.yearMonth === selectedMonth ? '#3b82f6' : '#2d2e3d'}`,
                    background: m.yearMonth === selectedMonth ? 'rgba(59,130,246,0.15)' : 'transparent',
                    color: m.yearMonth === selectedMonth ? '#60a5fa' : '#94a3b8',
                    borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {/* 月度卡片 */}
          {selectedReport && (
            <div className="metrics-grid" style={{ marginBottom: 8 }}>
              <div className="metric-card" style={{ borderLeft: `3px solid ${pnlColor(selectedReport.totalPnl)}` }}>
                <span className="metric-value" style={{ color: pnlColor(selectedReport.totalPnl), fontSize: 18 }}>
                  {fmtPnl(selectedReport.totalPnl)} USDT
                </span>
                <span className="metric-label">总盈亏</span>
              </div>
              <div className="metric-card">
                <span className="metric-value" style={{ fontSize: 18 }}>{selectedReport.winRate}%</span>
                <span className="metric-label">胜率 ({selectedReport.wins}/{selectedReport.totalTrades})</span>
              </div>
              <div className="metric-card">
                <span className="metric-value" style={{ fontSize: 18 }}>{selectedReport.avgScore}</span>
                <span className="metric-label">平均执行分</span>
              </div>
              <div className="metric-card">
                <span className="metric-value" style={{ fontSize: 16, color: '#f59e0b' }}>
                  {selectedReport.luckyCount}
                </span>
                <span className="metric-label">侥幸交易</span>
              </div>
            </div>
          )}

          {/* 月度盈亏柱状图 */}
          {monthlyReports.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 8 }}>
              <h4 style={{ margin: '0 0 6px 0', fontSize: 13, color: '#94a3b8' }}>月度盈亏趋势</h4>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyReports}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <Tooltip contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d', color: '#e2e8f0' }}
                    formatter={(v: number) => [`${v.toFixed(2)} USDT`, '盈亏']} />
                  <Bar dataKey="totalPnl" radius={[4, 4, 0, 0]}>
                    {monthlyReports.map((m, i) => (
                      <Cell key={i} fill={m.totalPnl >= 0 ? '#ef4444' : '#22c55e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 评分趋势图 */}
          {scoreTrend.length > 1 && (
            <div className="chart-card" style={{ marginBottom: 8 }}>
              <h4 style={{ margin: '0 0 6px 0', fontSize: 13, color: '#94a3b8' }}>执行分趋势</h4>
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={scoreTrend}>
                  <defs>
                    <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d2e3d" />
                  <XAxis dataKey="period" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={10} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: '#1a1b23', border: '1px solid #2d2e3d' }} />
                  <Area type="monotone" dataKey="avgScore" stroke="#3b82f6" strokeWidth={2} fill="url(#scoreGradient)" dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 最佳/最差交易 */}
          {selectedReport && (selectedReport.bestTrade || selectedReport.worstTrade) && (
            <div className="bt-result" style={{ marginBottom: 8 }}>
              <h4 style={{ margin: '0 0 6px 0', fontSize: 13, color: '#94a3b8' }}>🏆 本月明星 & 😰 本月踩坑</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {selectedReport.bestTrade && (
                  <div style={{ background: 'rgba(239,68,68,0.05)', borderRadius: 8, padding: 10, border: '1px solid rgba(239,68,68,0.15)' }}>
                    <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>🏆 最佳交易</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>
                      {selectedReport.bestTrade.symbol.replace('USDT', '')}
                    </div>
                    <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
                      +{selectedReport.bestTrade.pnl} USDT
                    </div>
                  </div>
                )}
                {selectedReport.worstTrade && (
                  <div style={{ background: 'rgba(34,197,94,0.05)', borderRadius: 8, padding: 10, border: '1px solid rgba(34,197,94,0.15)' }}>
                    <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>😰 最差交易</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>
                      {selectedReport.worstTrade.symbol.replace('USDT', '')}
                    </div>
                    <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
                      {selectedReport.worstTrade.pnl} USDT
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== 错误模式 ===== */}
      {tab === 'errors' && (
        <>
          {topErrors.length > 0 ? (
            <>
              <div className="bt-result" style={{ marginBottom: 8 }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#94a3b8' }}>📊 错误分布</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {topErrors.map((err) => (
                    <div key={err.errorKey}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                        <span style={{ color: '#e2e8f0' }}>{err.label}</span>
                        <span style={{ color: '#64748b' }}>{err.count}次（{err.percentage}%）</span>
                      </div>
                      <div style={{ height: 8, background: '#2d2e3d', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{
                          width: `${err.percentage}%`, height: '100%',
                          background: err.percentage > 30 ? '#ef4444' : err.percentage > 15 ? '#f59e0b' : '#3b82f6',
                          borderRadius: 4, transition: 'width 0.5s',
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 改进建议 */}
              <div className="bt-result">
                <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#94a3b8' }}>💡 改进建议</h4>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#cbd5e1', lineHeight: 1.8 }}>
                  {improvementTips.map((tip, i) => (
                    <li key={i}>{tip.replace(/\*\*/g, '')}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <div className="status-bar info" style={{ marginTop: 16 }}>
              暂无复盘数据。请先完成交易评估，AI 将自动分析你的常见错误。
            </div>
          )}
        </>
      )}

      {/* ===== 情绪分析 ===== */}
      {tab === 'emotions' && (
        <>
          {emotionPatterns.length > 0 ? (
            <>
              <div className="bt-result" style={{ marginBottom: 8 }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#94a3b8' }}>🧠 情绪分布</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {emotionPatterns.map((em) => (
                    <div key={em.emotionKey} style={{
                      background: 'rgba(59,130,246,0.05)', borderRadius: 8, padding: 10,
                      border: '1px solid rgba(59,130,246,0.1)',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{em.label}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 4 }}>
                        <span style={{ color: '#64748b' }}>出现 {em.count} 次</span>
                        <span style={{ color: em.avgScore >= 4 ? '#22c55e' : em.avgScore >= 3 ? '#f59e0b' : '#ef4444' }}>
                          情绪分 {em.avgScore.toFixed(1)}/5
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bt-result">
                <h4 style={{ margin: '0 0 6px 0', fontSize: 13, color: '#94a3b8' }}>📊 情绪 vs 执行分</h4>
                <p style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
                  情绪直接影响交易执行质量。冷静 (calm) 和自信 (confident) 时执行分通常较高，
                  而恐惧 (fear) 和沮丧 (frustrated) 时容易犯错。
                  {emotionPatterns.find(e => e.emotionKey === 'fear' || e.emotionKey === 'fomo') && (
                    ' 建议在出现这些情绪时暂停交易，等情绪平复后再入场。'
                  )}
                </p>
              </div>
            </>
          ) : (
            <div className="status-bar info" style={{ marginTop: 16 }}>
              暂无情绪数据。请在交易复盘中记录情绪状态。
            </div>
          )}
        </>
      )}

      {/* ===== 品种表现 ===== */}
      {tab === 'symbols' && (
        <>
          {symbolPerformance.length > 0 ? (
            <div className="bt-result">
              <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#94a3b8' }}>📦 品种盈亏明细</h4>
              <div className="table-container">
                <table className="trades-table">
                  <thead>
                    <tr>
                      <th>品种</th>
                      <th>交易次数</th>
                      <th>胜率</th>
                      <th>总盈亏</th>
                      <th>执行分</th>
                      <th>表现</th>
                    </tr>
                  </thead>
                  <tbody>
                    {symbolPerformance.map((s) => (
                      <tr key={s.symbol}>
                        <td style={{ fontWeight: 600 }}>{s.symbol}</td>
                        <td>{s.trades}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ width: 40, height: 5, background: '#2d2e3d', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${s.winRate}%`, height: '100%', background: s.winRate >= 50 ? '#ef4444' : '#22c55e', borderRadius: 3 }} />
                            </div>
                            <span>{s.winRate}%</span>
                          </div>
                        </td>
                        <td style={{ color: pnlColor(s.totalPnl), fontWeight: 600 }}>{fmtPnl(s.totalPnl)}</td>
                        <td>
                          <span style={{
                            padding: '1px 6px', borderRadius: 4, fontSize: 11,
                            background: s.avgScore >= 70 ? 'rgba(34,197,94,0.15)' : s.avgScore >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                            color: s.avgScore >= 70 ? '#22c55e' : s.avgScore >= 40 ? '#f59e0b' : '#ef4444',
                          }}>
                            {s.avgScore}
                          </span>
                        </td>
                        <td>
                          {s.totalPnl > 0 && s.winRate >= 50 ? (
                            <span style={{ color: '#22c55e', fontSize: 11 }}>✅ 擅长</span>
                          ) : s.totalPnl < 0 ? (
                            <span style={{ color: '#f59e0b', fontSize: 11 }}>⚠️ 需谨慎</span>
                          ) : (
                            <span style={{ color: '#64748b', fontSize: 11 }}>➖ 中性</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="status-bar info" style={{ marginTop: 16 }}>
              暂无已平仓交易数据。
            </div>
          )}
        </>
      )}
    </div>
  );
}
