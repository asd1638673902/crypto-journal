import { Link } from 'react-router-dom';
import { getTrades, deleteTrade } from '../lib/db';
import { formatPrice, getPnlColor, getScoreColor, calcExecutionScore } from '../lib/calculations';
import { useState, useMemo } from 'react';
import './Trades.css';

type DirectionFilter = 'ALL' | 'LONG' | 'SHORT';
type StatusFilter = 'ALL' | 'CLOSED' | 'OPEN';
type SourceFilter = 'ALL' | 'EXCHANGE' | 'MANUAL' | 'MOCK';

/** 判断一笔交易的来源 */
function getTradeSource(trade: { exchange: string; orderId?: string }): SourceFilter {
  if (trade.exchange === 'binance' && trade.orderId && !trade.orderId.startsWith('mock')) return 'EXCHANGE';
  if (trade.orderId?.startsWith('mock')) return 'MOCK';
  return 'MANUAL';
}

export default function Trades() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [symbolFilter, setSymbolFilter] = useState('ALL');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('EXCHANGE');

  const allTrades = useMemo(
    () =>
      getTrades().sort(
        (a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime(),
      ),
    [refreshKey],
  );

  // 提取所有品种（去重 + 排序）
  const symbols = useMemo(() => {
    const set = new Set(allTrades.map((t) => t.symbol));
    return ['ALL', ...Array.from(set).sort()];
  }, [allTrades]);

  // 应用筛选
  const filteredTrades = useMemo(() => {
    return allTrades.filter((t) => {
      if (symbolFilter !== 'ALL' && t.symbol !== symbolFilter) return false;
      if (directionFilter !== 'ALL' && t.direction !== directionFilter) return false;
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (sourceFilter !== 'ALL' && getTradeSource(t) !== sourceFilter) return false;
      return true;
    });
  }, [allTrades, symbolFilter, directionFilter, statusFilter, sourceFilter]);

  const hasActiveFilter = symbolFilter !== 'ALL' || directionFilter !== 'ALL' || statusFilter !== 'ALL' || sourceFilter !== 'ALL';

  // 数据源统计（基于筛选结果）
  const exchangeTrades = filteredTrades.filter(
    (t) => t.exchange === 'binance' && t.orderId && !t.orderId.startsWith('mock'),
  );
  const mockTrades = filteredTrades.filter((t) => t.orderId?.startsWith('mock'));
  const manualTrades = filteredTrades.length - exchangeTrades.length - mockTrades.length;

  // 筛选结果汇总
  const filteredPnl = filteredTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const filteredWins = filteredTrades.filter((t) => (t.pnl || 0) > 0).length;

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (confirm('确定删除这笔交易？')) {
      deleteTrade(id);
      setRefreshKey((k) => k + 1);
    }
  };

  const clearFilters = () => {
    setSymbolFilter('ALL');
    setDirectionFilter('ALL');
    setStatusFilter('ALL');
    setSourceFilter('ALL');
  };

  return (
    <div className="trades-page">
      {/* 页头 */}
      <div className="page-header">
        <div>
          <h1 className="page-title">交易记录</h1>
          <p className="trades-subtitle">
            共 {allTrades.length} 笔交易
            {exchangeTrades.length > 0 && (
              <span className="source-tag exchange">交易所 {exchangeTrades.length}</span>
            )}
            {manualTrades > 0 && (
              <span className="source-tag manual">手动 {manualTrades}</span>
            )}
            {mockTrades.length > 0 && (
              <span className="source-tag mock">模拟 {mockTrades.length}</span>
            )}
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn-refresh"
            onClick={() => setRefreshKey((k) => k + 1)}
            title="刷新数据"
          >
            🔄
          </button>
          <Link to="/trades/new" className="btn-primary">
            + 新建交易
          </Link>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="filter-bar">
        <div className="filter-group">
          <label className="filter-label">品种</label>
          <div className="filter-select-wrapper">
            <select
              className="filter-select"
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s === 'ALL' ? '全部品种' : s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="filter-group">
          <label className="filter-label">方向</label>
          <div className="filter-buttons">
            {([
              { value: 'ALL' as const, label: '全部' },
              { value: 'LONG' as const, label: '做多' },
              { value: 'SHORT' as const, label: '做空' },
            ]).map((opt) => (
              <button
                key={opt.value}
                className={`filter-btn ${directionFilter === opt.value ? 'active' : ''}`}
                onClick={() => setDirectionFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <label className="filter-label">状态</label>
          <div className="filter-buttons">
            {([
              { value: 'ALL' as const, label: '全部' },
              { value: 'CLOSED' as const, label: '已平仓' },
              { value: 'OPEN' as const, label: '持仓中' },
            ]).map((opt) => (
              <button
                key={opt.value}
                className={`filter-btn ${statusFilter === opt.value ? 'active' : ''}`}
                onClick={() => setStatusFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <label className="filter-label">来源</label>
          <div className="filter-buttons">
            {([
              { value: 'ALL' as const, label: '全部' },
              { value: 'EXCHANGE' as const, label: '交易所' },
              { value: 'MANUAL' as const, label: '手动' },
              { value: 'MOCK' as const, label: '模拟' },
            ]).map((opt) => (
              <button
                key={opt.value}
                className={`filter-btn source-${opt.value.toLowerCase()} ${sourceFilter === opt.value ? 'active' : ''}`}
                onClick={() => setSourceFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 筛选结果摘要 */}
        <div className="filter-summary">
          <span className="filter-result-count">
            显示 {filteredTrades.length}/{allTrades.length} 笔
          </span>
          {filteredTrades.length > 0 && (
            <>
              <span className="filter-result-pnl" style={{ color: filteredPnl >= 0 ? '#ef4444' : '#22c55e' }}>
                {filteredPnl >= 0 ? '+' : ''}{filteredPnl.toFixed(0)} USDT
              </span>
              <span className="filter-result-wins">
                {filteredWins}胜/{filteredTrades.length - filteredWins}负
              </span>
            </>
          )}
          {hasActiveFilter && (
            <button className="filter-clear" onClick={clearFilters}>
              清除筛选 ✕
            </button>
          )}
        </div>
      </div>

      {/* 表格/空状态 */}
      {allTrades.length === 0 ? (
        <div className="empty-state">
          <p>还没有交易记录</p>
          <Link to="/trades/new" className="btn-primary">
            录入第一笔交易
          </Link>
        </div>
      ) : filteredTrades.length === 0 ? (
        <div className="empty-state">
          <p>没有符合条件的交易</p>
          <button className="btn-primary" onClick={clearFilters}>
            清除筛选条件
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="trades-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>品种</th>
                <th>方向</th>
                <th>杠杆</th>
                <th>开仓价</th>
                <th>平仓价</th>
                <th>盈亏</th>
                <th>执行分</th>
                <th>来源</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((trade) => {
                const score = calcExecutionScore({ trade, review: null });
                const isFromExchange =
                  trade.exchange === 'binance' && trade.orderId && !trade.orderId.startsWith('mock');
                const isMock = trade.orderId?.startsWith('mock');

                return (
                  <tr key={trade.id} className={trade.isLuckyTrade ? 'lucky-row' : ''}>
                    <td className="time-cell">
                      {new Date(trade.entryTime).toLocaleDateString('zh-CN')}
                      <br />
                      <span className="time-sub">
                        {new Date(trade.entryTime).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>
                    <td className="symbol-cell">
                      <Link to={`/trades/${trade.id}`} className="symbol-link">
                        {trade.symbol}
                      </Link>
                    </td>
                    <td>
                      <span className={`dir-badge ${trade.direction.toLowerCase()}`}>
                        {trade.direction === 'LONG' ? '多' : '空'}
                      </span>
                    </td>
                    <td>{trade.leverage}x</td>
                    <td>{formatPrice(trade.entryPrice)}</td>
                    <td>{trade.exitPrice ? formatPrice(trade.exitPrice) : '-'}</td>
                    <td className="pnl-cell" style={{ color: getPnlColor(trade.pnl || 0) }}>
                      {trade.pnl !== undefined ? (
                        <>
                          {(trade.pnl >= 0 ? '+' : '') + trade.pnl.toFixed(2)}
                          {trade.isLuckyTrade && <span className="lucky-tag">⚠️侥幸</span>}
                        </>
                      ) : (
                        <span className="open-tag">持仓中</span>
                      )}
                    </td>
                    <td>
                      {score > 0 ? (
                        <span className="score-badge" style={{ background: getScoreColor(score) }}>
                          {score}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      {isFromExchange ? (
                        <span className="source-tag exchange">交易所</span>
                      ) : isMock ? (
                        <span className="source-tag mock">模拟</span>
                      ) : (
                        <span className="source-tag manual">手动</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-tag ${trade.status.toLowerCase()}`}>
                        {trade.status === 'CLOSED'
                          ? '已平仓'
                          : trade.status === 'OPEN'
                            ? '持仓中'
                            : '已取消'}
                      </span>
                    </td>
                    <td>
                      <Link to={`/trades/${trade.id}`} className="action-link">
                        查看
                      </Link>
                      <button
                        onClick={(e) => handleDelete(trade.id, e)}
                        className="action-btn danger"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
