import { useState, useMemo } from 'react';
import { getStrategies, addStrategy, updateStrategy, deleteStrategy, getTrades } from '../lib/db';
import type { Strategy, Trade } from '../lib/types';
import './Strategies.css';

interface StrategyStats {
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxWin: number;
  maxLoss: number;
  avgPnl: number;
  avgScore: number;
}

function calcStrategyStats(trades: Trade[], strategyId: string): StrategyStats {
  const related = trades.filter((t) => t.strategyId === strategyId && t.status === 'CLOSED');
  const count = related.length;

  const wins = related.filter((t) => (t.pnl || 0) > 0);
  const losses = related.filter((t) => (t.pnl || 0) < 0);
  const totalPnl = related.reduce((s, t) => s + (t.pnl || 0), 0);

  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0) / losses.length)
    : 0;

  const maxWin = wins.length > 0 ? Math.max(...wins.map((t) => t.pnl || 0)) : 0;
  const maxLoss = losses.length > 0 ? Math.max(...losses.map((t) => Math.abs(t.pnl || 0))) : 0;

  const scoredTrades = related.filter((t) => t.executionScore);
  const avgScore = scoredTrades.length > 0
    ? scoredTrades.reduce((s, t) => s + (t.executionScore || 0), 0) / scoredTrades.length
    : 0;

  return {
    tradeCount: count,
    wins: wins.length,
    losses: losses.length,
    winRate: count > 0 ? (wins.length / count) * 100 : 0,
    totalPnl,
    avgWin,
    avgLoss,
    profitFactor: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    maxWin,
    maxLoss,
    avgPnl: count > 0 ? totalPnl / count : 0,
    avgScore,
  };
}

export default function Strategies() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // 表单状态
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [entryConditions, setEntryConditions] = useState('');
  const [exitConditions, setExitConditions] = useState('');
  const [riskManagement, setRiskManagement] = useState('');
  const [isActive, setIsActive] = useState(true);

  const allStrategies = useMemo(() => getStrategies(), [refreshKey]);
  const allTrades = useMemo(() => getTrades(), [refreshKey]);

  // 计算每个策略的完整统计数据
  const strategyStatsMap = useMemo(() => {
    const map: Record<string, StrategyStats> = {};
    for (const s of allStrategies) {
      map[s.id] = calcStrategyStats(allTrades, s.id);
    }
    return map;
  }, [allStrategies, allTrades]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setEntryConditions('');
    setExitConditions('');
    setRiskManagement('');
    setIsActive(true);
    setEditingId(null);
    setShowForm(false);
  };

  const openEdit = (s: Strategy) => {
    setName(s.name);
    setDescription(s.description ?? '');
    setEntryConditions(s.entryConditions ?? '');
    setExitConditions(s.exitConditions ?? '');
    setRiskManagement(s.riskManagement ?? '');
    setIsActive(s.isActive);
    setEditingId(s.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const data = {
      name: name.trim(),
      description: description.trim() || undefined,
      entryConditions: entryConditions.trim() || undefined,
      exitConditions: exitConditions.trim() || undefined,
      riskManagement: riskManagement.trim() || undefined,
      isActive,
    };

    if (editingId) {
      updateStrategy(editingId, data);
    } else {
      addStrategy(data);
    }

    resetForm();
    setRefreshKey((k) => k + 1);
  };

  const handleDelete = (id: string) => {
    if (confirm('确定删除此策略？关联此策略的交易不会被删除。')) {
      deleteStrategy(id);
      setRefreshKey((k) => k + 1);
    }
  };

  const handleToggleActive = (s: Strategy) => {
    updateStrategy(s.id, { isActive: !s.isActive });
    setRefreshKey((k) => k + 1);
  };

  const activeStrategies = allStrategies.filter((s) => s.isActive);
  const inactiveStrategies = allStrategies.filter((s) => !s.isActive);
  const totalTrades = allTrades.length;
  const strategizedTrades = allTrades.filter((t) => t.strategyId).length;

  return (
    <div className="strategies-page">
      {/* 页头 */}
      <div className="page-header">
        <div>
          <h1 className="page-title">策略管理</h1>
          <p className="strategies-subtitle">
            {allStrategies.length} 个策略
            {allStrategies.length > 0 && (
              <>
                <span className="source-tag active">{activeStrategies.length} 个启用</span>
                <span className="source-tag inactive">{inactiveStrategies.length} 个停用</span>
                <span className="source-tag info">{strategizedTrades}/{totalTrades} 笔交易关联策略</span>
              </>
            )}
          </p>
        </div>
        <button className="btn-add-strategy" onClick={() => { resetForm(); setShowForm(true); }}>
          + 新建策略
        </button>
      </div>

      {/* 新建/编辑表单 — 弹出卡片 */}
      {showForm && (
        <div className="strategy-form-overlay">
          <div className="strategy-form">
            <div className="form-header">
              <h2>{editingId ? '编辑策略' : '新建策略'}</h2>
              <button className="form-close" onClick={resetForm}>✕</button>
            </div>
            <div className="form-body">
              <div className="form-field">
                <label>策略名称 *</label>
                <input
                  type="text"
                  placeholder="趋势突破、网格交易、..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>策略描述</label>
                <textarea
                  placeholder="简要描述这个策略的核心逻辑..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="form-field">
                <label>开仓条件</label>
                <textarea
                  placeholder="什么情况下入场？例如：价格突破 MA20 + RSI > 50..."
                  value={entryConditions}
                  onChange={(e) => setEntryConditions(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="form-field">
                <label>平仓条件</label>
                <textarea
                  placeholder="什么情况下出场？例如：达到止盈/止损、趋势反转信号..."
                  value={exitConditions}
                  onChange={(e) => setExitConditions(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="form-field">
                <label>风控规则</label>
                <textarea
                  placeholder="仓位控制、单笔最大亏损、日内最大回撤..."
                  value={riskManagement}
                  onChange={(e) => setRiskManagement(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="form-field toggle">
                <label>启用状态</label>
                <button
                  className={`toggle-btn ${isActive ? 'on' : 'off'}`}
                  onClick={() => setIsActive(!isActive)}
                >
                  {isActive ? '🟢 启用中' : '🔴 已停用'}
                </button>
              </div>
            </div>
            <div className="form-actions">
              <button className="btn-cancel" onClick={resetForm}>取消</button>
              <button
                className="btn-save"
                onClick={handleSave}
                disabled={!name.trim()}
              >
                {editingId ? '保存修改' : '创建策略'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 策略列表 */}
      {allStrategies.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎯</div>
          <p>还没有创建策略</p>
          <p className="empty-hint">策略能帮你系统化记录交易规则，复盘时可以对照检查是否按策略执行</p>
          <button className="btn-add-strategy" onClick={() => { resetForm(); setShowForm(true); }}>
            创建第一个策略
          </button>
        </div>
      ) : (
        <div className="strategy-list">
          {/* 启用中的策略 */}
          {activeStrategies.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              stats={strategyStatsMap[s.id]}
              onEdit={() => openEdit(s)}
              onDelete={() => handleDelete(s.id)}
              onToggle={() => handleToggleActive(s)}
            />
          ))}

          {/* 停用的策略 */}
          {inactiveStrategies.length > 0 && (
            <>
              <div className="section-divider">
                <span>已停用策略</span>
              </div>
              {inactiveStrategies.map((s) => (
                <StrategyCard
                  key={s.id}
                  strategy={s}
                  stats={strategyStatsMap[s.id]}
                  onEdit={() => openEdit(s)}
                  onDelete={() => handleDelete(s.id)}
                  onToggle={() => handleToggleActive(s)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// 策略卡片组件
function StrategyCard({
  strategy,
  stats,
  onEdit,
  onDelete,
  onToggle,
}: {
  strategy: Strategy;
  stats: StrategyStats;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const pnlColor = stats.totalPnl >= 0 ? '#ef4444' : '#22c55e';
  const scoreColor = stats.avgScore >= 70 ? '#22c55e' : stats.avgScore >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <div className={`strategy-card ${!strategy.isActive ? 'inactive' : ''}`}>
      <div className="strategy-header">
        <div className="strategy-name-row">
          <h3 className="strategy-name">{strategy.name}</h3>
          <span className={`strategy-status ${strategy.isActive ? 'active' : 'inactive'}`}>
            {strategy.isActive ? '启用' : '停用'}
          </span>
        </div>
        <div className="strategy-actions">
          <button className="action-btn" onClick={onToggle} title={strategy.isActive ? '停用' : '启用'}>
            {strategy.isActive ? '⏸' : '▶️'}
          </button>
          <button className="action-btn" onClick={onEdit}>✏️</button>
          <button className="action-btn danger" onClick={onDelete}>🗑️</button>
        </div>
      </div>

      {strategy.description && (
        <p className="strategy-desc">{strategy.description}</p>
      )}

      <div className="strategy-details">
        {strategy.entryConditions && (
          <div className="strategy-detail">
            <span className="detail-label">📥 开仓条件</span>
            <span className="detail-text">{strategy.entryConditions}</span>
          </div>
        )}
        {strategy.exitConditions && (
          <div className="strategy-detail">
            <span className="detail-label">📤 平仓条件</span>
            <span className="detail-text">{strategy.exitConditions}</span>
          </div>
        )}
        {strategy.riskManagement && (
          <div className="strategy-detail">
            <span className="detail-label">🛡️ 风控规则</span>
            <span className="detail-text">{strategy.riskManagement}</span>
          </div>
        )}
      </div>

      {/* 详细统计数据 */}
      <div className="strategy-stats-grid">
        {/* 第一行：核心指标 */}
        <div className="stats-row primary">
          <div className="stat-cell">
            <span className="stat-cell-value">{stats.tradeCount}</span>
            <span className="stat-cell-label">交易笔数</span>
          </div>
          <div className="stat-cell">
            <span className="stat-cell-value" style={{ color: pnlColor }}>
              {stats.totalPnl >= 0 ? '+' : ''}{stats.totalPnl.toFixed(0)}
            </span>
            <span className="stat-cell-label">总盈亏 USDT</span>
          </div>
          <div className="stat-cell">
            <span className="stat-cell-value" style={{ color: stats.winRate >= 50 ? '#22c55e' : '#ef4444' }}>
              {stats.winRate.toFixed(1)}%
            </span>
            <span className="stat-cell-label">胜率</span>
          </div>
          <div className="stat-cell">
            <span className="stat-cell-value">
              {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
            </span>
            <span className="stat-cell-label">盈亏比</span>
          </div>
          {stats.avgScore > 0 && (
            <div className="stat-cell">
              <span className="stat-cell-value" style={{ color: scoreColor }}>
                {stats.avgScore.toFixed(0)}
              </span>
              <span className="stat-cell-label">平均执行分</span>
            </div>
          )}
        </div>

        {/* 第二行：详细指标 */}
        <div className="stats-row secondary">
          <div className="stat-cell">
            <span className="stat-cell-value" style={{ color: '#ef4444' }}>
              +{stats.avgWin.toFixed(0)}
            </span>
            <span className="stat-cell-label">平均盈利</span>
          </div>
          <div className="stat-cell">
            <span className="stat-cell-value" style={{ color: '#22c55e' }}>
              -{stats.avgLoss.toFixed(0)}
            </span>
            <span className="stat-cell-label">平均亏损</span>
          </div>
          <div className="stat-cell">
            <span className="stat-cell-value">
              {stats.wins}/{stats.losses}
            </span>
            <span className="stat-cell-label">胜/负</span>
          </div>
          <div className="stat-cell">
            <span className="stat-cell-value">
              {stats.avgPnl >= 0 ? '+' : ''}{stats.avgPnl.toFixed(0)}
            </span>
            <span className="stat-cell-label">均盈亏</span>
          </div>
          <div className="stat-cell">
            <span className="stat-cell-value" style={{ color: '#ef4444' }}>
              +{stats.maxWin.toFixed(0)}
            </span>
            <span className="stat-cell-label">最大盈利</span>
          </div>
          <div className="stat-cell">
            <span className="stat-cell-value" style={{ color: '#22c55e' }}>
              -{stats.maxLoss.toFixed(0)}
            </span>
            <span className="stat-cell-label">最大亏损</span>
          </div>
          <div className="stat-cell date-cell">
            <span className="stat-cell-value date">
              {new Date(strategy.createdAt).toLocaleDateString('zh-CN')}
            </span>
            <span className="stat-cell-label">创建日期</span>
          </div>
        </div>
      </div>
    </div>
  );
}
