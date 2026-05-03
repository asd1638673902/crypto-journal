/**
 * 交易计划面板
 * 创建、管理、复盘交易计划，支持计划 vs 实际对比
 */

import { useState, useCallback, useMemo } from 'react';
import {
  getTradePlans, addTradePlan, updateTradePlan, deleteTradePlan,
  closePlan, cancelPlan, getPlanStats, createPlanFromSignal,
  type TradePlan, type TradePlanStatus, type SetupType,
} from '../lib/tradePlan';

const STATUS_LABELS: Record<TradePlanStatus, { label: string; color: string; bg: string }> = {
  PLANNED:  { label: '计划中', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  ACTIVE:   { label: '执行中', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  CLOSED:   { label: '已结束', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  CANCELLED:{ label: '已取消', color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
};

const SETUP_OPTIONS: { value: SetupType; label: string }[] = [
  { value: 'BREAKOUT', label: '🔥 突破' },
  { value: 'PULLBACK', label: '📉 回调' },
  { value: 'TREND_FOLLOW', label: '📈 趋势跟随' },
  { value: 'REVERSAL', label: '🔄 反转' },
  { value: 'RANGE', label: '➡️ 区间' },
  { value: 'MTF_CONFLUENCE', label: '🔬 多周期共振' },
  { value: 'OTHER', label: '其他' },
];

function StatusBadge({ status }: { status: TradePlanStatus }) {
  const s = STATUS_LABELS[status];
  return (
    <span style={{
      background: s.bg,
      color: s.color,
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
}

// ==================== 统计概览 ====================

function PlanStatsView() {
  const stats = useMemo(() => getPlanStats(), []);
  const [key, setKey] = useState(0);

  const refresh = useCallback(() => setKey((k) => k + 1), []);

  const cards = [
    { label: '总计划', value: stats.total, color: '#e2e8f0' },
    { label: '计划中', value: stats.planned, color: '#3b82f6' },
    { label: '执行中', value: stats.active, color: '#f59e0b' },
    { label: '已结束', value: stats.closed, color: '#22c55e' },
    { label: '已取消', value: stats.cancelled, color: '#64748b' },
    { label: '计划执行率', value: `${stats.planFollowedRate.toFixed(0)}%`, color: '#8b5cf6' },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
      gap: 10,
      marginBottom: 16,
    }}>
      {cards.map((c) => (
        <div key={c.label} style={{
          background: '#1a1b23',
          border: '1px solid #2d2e3d',
          borderRadius: 8,
          padding: '10px 12px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: c.color }}>{c.value}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{c.label}</div>
        </div>
      ))}
    </div>
  );
}

// ==================== 新建/编辑计划弹窗 ====================

interface PlanFormData {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  setupType: SetupType;
  plannedEntry: string;
  plannedStopLoss: string;
  plannedTakeProfit1: string;
  plannedTakeProfit2: string;
  plannedPositionSize: string;
  plannedRiskPercent: string;
  plannedLeverage: string;
  triggerConditions: string;
  invalidationConditions: string;
  rationale: string;
  notes: string;
}

const defaultForm: PlanFormData = {
  symbol: '',
  direction: 'LONG',
  setupType: 'BREAKOUT',
  plannedEntry: '',
  plannedStopLoss: '',
  plannedTakeProfit1: '',
  plannedTakeProfit2: '',
  plannedPositionSize: '',
  plannedRiskPercent: '1',
  plannedLeverage: '1',
  triggerConditions: '',
  invalidationConditions: '',
  rationale: '',
  notes: '',
};

function PlanModal({
  plan,
  onClose,
  onSave,
}: {
  plan?: TradePlan;
  onClose: () => void;
  onSave: () => void;
}) {
  const [form, setForm] = useState<PlanFormData>(() => {
    if (!plan) return defaultForm;
    return {
      symbol: plan.symbol,
      direction: plan.direction,
      setupType: plan.setupType,
      plannedEntry: String(plan.plannedEntry),
      plannedStopLoss: String(plan.plannedStopLoss),
      plannedTakeProfit1: String(plan.plannedTakeProfit[0] ?? ''),
      plannedTakeProfit2: String(plan.plannedTakeProfit[1] ?? ''),
      plannedPositionSize: plan.plannedPositionSize ? String(plan.plannedPositionSize) : '',
      plannedRiskPercent: plan.plannedRiskPercent ? String(plan.plannedRiskPercent) : '1',
      plannedLeverage: plan.plannedLeverage ? String(plan.plannedLeverage) : '1',
      triggerConditions: plan.triggerConditions.join('\n'),
      invalidationConditions: plan.invalidationConditions.join('\n'),
      rationale: plan.rationale,
      notes: plan.notes ?? '',
    };
  });

  const handleSubmit = useCallback(() => {
    const tps = [form.plannedTakeProfit1, form.plannedTakeProfit2]
      .filter((s) => s && !isNaN(Number(s)))
      .map(Number);

    const payload = {
      symbol: form.symbol.toUpperCase(),
      direction: form.direction,
      setupType: form.setupType,
      status: (plan?.status ?? 'PLANNED') as TradePlanStatus,
      plannedEntry: Number(form.plannedEntry) || 0,
      plannedStopLoss: Number(form.plannedStopLoss) || 0,
      plannedTakeProfit: tps,
      plannedPositionSize: form.plannedPositionSize ? Number(form.plannedPositionSize) : undefined,
      plannedRiskPercent: Number(form.plannedRiskPercent) || undefined,
      plannedLeverage: Number(form.plannedLeverage) || undefined,
      triggerConditions: form.triggerConditions.split('\n').filter((s) => s.trim()),
      invalidationConditions: form.invalidationConditions.split('\n').filter((s) => s.trim()),
      rationale: form.rationale,
      notes: form.notes || undefined,
    };

    if (plan) {
      updateTradePlan(plan.id, payload);
    } else {
      addTradePlan(payload);
    }
    onSave();
    onClose();
  }, [form, plan, onClose, onSave]);

  const fieldStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  };
  const labelStyle: React.CSSProperties = { fontSize: 12, color: '#94a3b8', fontWeight: 500 };
  const inputStyle: React.CSSProperties = {
    background: '#11121a',
    border: '1px solid #2d2e3d',
    borderRadius: 6,
    padding: '8px 10px',
    color: '#e2e8f0',
    fontSize: 13,
    outline: 'none',
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      padding: 16,
    }}>
      <div style={{
        background: '#1a1b23',
        border: '1px solid #2d2e3d',
        borderRadius: 12,
        width: '100%',
        maxWidth: 520,
        maxHeight: '90vh',
        overflow: 'auto',
        padding: 20,
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#e2e8f0' }}>
          {plan ? '编辑交易计划' : '新建交易计划'}
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>品种 *</label>
            <input style={inputStyle} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="BTCUSDT" />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>方向</label>
            <select style={inputStyle} value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as 'LONG' | 'SHORT' })}>
              <option value="LONG">做多</option>
              <option value="SHORT">做空</option>
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>形态类型</label>
            <select style={inputStyle} value={form.setupType} onChange={(e) => setForm({ ...form, setupType: e.target.value as SetupType })}>
              {SETUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>计划入场价 *</label>
            <input style={inputStyle} type="number" value={form.plannedEntry} onChange={(e) => setForm({ ...form, plannedEntry: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>止损价 *</label>
            <input style={inputStyle} type="number" value={form.plannedStopLoss} onChange={(e) => setForm({ ...form, plannedStopLoss: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>止盈1</label>
            <input style={inputStyle} type="number" value={form.plannedTakeProfit1} onChange={(e) => setForm({ ...form, plannedTakeProfit1: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>止盈2</label>
            <input style={inputStyle} type="number" value={form.plannedTakeProfit2} onChange={(e) => setForm({ ...form, plannedTakeProfit2: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>风险%</label>
            <input style={inputStyle} type="number" step={0.1} value={form.plannedRiskPercent} onChange={(e) => setForm({ ...form, plannedRiskPercent: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>杠杆</label>
            <input style={inputStyle} type="number" value={form.plannedLeverage} onChange={(e) => setForm({ ...form, plannedLeverage: e.target.value })} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>触发条件（每行一条）</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.triggerConditions} onChange={(e) => setForm({ ...form, triggerConditions: e.target.value })} placeholder="例如：价格突破前高&#10;成交量放大2倍以上" />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>失效条件（每行一条）</label>
            <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} value={form.invalidationConditions} onChange={(e) => setForm({ ...form, invalidationConditions: e.target.value })} placeholder="例如：跌破支撑位&#10;ADX回落至20以下" />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>交易理由</label>
            <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>备注</label>
            <textarea style={{ ...inputStyle, minHeight: 40, resize: 'vertical' }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid #2d2e3d',
              color: '#94a3b8',
              padding: '8px 16px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.symbol || !form.plannedEntry || !form.plannedStopLoss}
            style={{
              background: '#3b82f6',
              border: 'none',
              color: '#fff',
              padding: '8px 20px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              opacity: (!form.symbol || !form.plannedEntry || !form.plannedStopLoss) ? 0.5 : 1,
            }}
          >
            {plan ? '保存修改' : '创建计划'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 计划详情抽屉 ====================

function PlanDetailDrawer({ plan, onClose, onUpdate }: { plan: TradePlan; onClose: () => void; onUpdate: () => void }) {
  const risk = Math.abs(plan.plannedEntry - plan.plannedStopLoss);
  const reward = plan.plannedTakeProfit.length > 0 ? Math.abs(plan.plannedTakeProfit[0] - plan.plannedEntry) : 0;
  const plannedRR = risk > 0 ? reward / risk : 0;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      justifyContent: 'flex-end',
      zIndex: 100,
    }}>
      <div style={{
        background: '#1a1b23',
        borderLeft: '1px solid #2d2e3d',
        width: '100%',
        maxWidth: 440,
        height: '100%',
        overflow: 'auto',
        padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#e2e8f0' }}>计划详情</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 18, color: '#e2e8f0' }}>{plan.symbol}</span>
          <span style={{
            background: plan.direction === 'LONG' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            color: plan.direction === 'LONG' ? '#22c55e' : '#ef4444',
            padding: '2px 10px',
            borderRadius: 4,
            fontWeight: 700,
            fontSize: 12,
          }}>
            {plan.direction === 'LONG' ? '做多' : '做空'}
          </span>
          <StatusBadge status={plan.status} />
        </div>

        {/* 计划参数 */}
        <div style={{ background: '#11121a', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>计划参数</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div><span style={{ color: '#64748b' }}>入场:</span> <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{plan.plannedEntry.toFixed(4)}</span></div>
            <div><span style={{ color: '#64748b' }}>止损:</span> <span style={{ color: '#ef4444', fontWeight: 600 }}>{plan.plannedStopLoss.toFixed(4)}</span></div>
            <div><span style={{ color: '#64748b' }}>止盈:</span> <span style={{ color: '#22c55e', fontWeight: 600 }}>{plan.plannedTakeProfit.map((t) => t.toFixed(2)).join(' / ')}</span></div>
            <div><span style={{ color: '#64748b' }}>风险回报:</span> <span style={{ color: '#f59e0b', fontWeight: 700 }}>1 : {plannedRR.toFixed(1)}</span></div>
            {plan.plannedRiskPercent && <div><span style={{ color: '#64748b' }}>风险%:</span> <span style={{ color: '#e2e8f0' }}>{plan.plannedRiskPercent}%</span></div>}
            {plan.plannedLeverage && <div><span style={{ color: '#64748b' }}>杠杆:</span> <span style={{ color: '#e2e8f0' }}>{plan.plannedLeverage}x</span></div>}
          </div>
        </div>

        {/* 触发/失效条件 */}
        {plan.triggerConditions.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4, fontWeight: 600 }}>触发条件</div>
            {plan.triggerConditions.map((c, i) => (
              <div key={i} style={{ fontSize: 12, color: '#94a3b8', padding: '3px 0', paddingLeft: 12, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0, color: '#22c55e' }}>•</span>{c}
              </div>
            ))}
          </div>
        )}

        {plan.invalidationConditions.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4, fontWeight: 600 }}>失效条件</div>
            {plan.invalidationConditions.map((c, i) => (
              <div key={i} style={{ fontSize: 12, color: '#94a3b8', padding: '3px 0', paddingLeft: 12, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0, color: '#ef4444' }}>•</span>{c}
              </div>
            ))}
          </div>
        )}

        {plan.rationale && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4, fontWeight: 600 }}>交易理由</div>
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{plan.rationale}</div>
          </div>
        )}

        {plan.notes && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4, fontWeight: 600 }}>备注</div>
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{plan.notes}</div>
          </div>
        )}

        {/* 计划 vs 实际 */}
        {plan.executionDeviation && (
          <div style={{
            background: plan.executionDeviation.planFollowed ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
            border: `1px solid ${plan.executionDeviation.planFollowed ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: plan.executionDeviation.planFollowed ? '#22c55e' : '#f59e0b', marginBottom: 8 }}>
              {plan.executionDeviation.planFollowed ? '✅ 按计划执行' : '⚠️ 偏离计划'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
              <div><span style={{ color: '#64748b' }}>入场偏离:</span> <span style={{ color: '#e2e8f0' }}>{plan.executionDeviation.entryDeviationPercent.toFixed(2)}%</span></div>
              <div><span style={{ color: '#64748b' }}>止损偏离:</span> <span style={{ color: '#e2e8f0' }}>{plan.executionDeviation.stopDeviationPercent.toFixed(2)}%</span></div>
              <div><span style={{ color: '#64748b' }}>止盈偏离:</span> <span style={{ color: '#e2e8f0' }}>{plan.executionDeviation.tpDeviationPercent.toFixed(2)}%</span></div>
            </div>
            {plan.executionDeviation.deviations.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {plan.executionDeviation.deviations.map((d, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#f59e0b' }}>• {d}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 实际操作结果 */}
        {plan.actualPnl !== undefined && (
          <div style={{ background: '#11121a', borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>实际结果</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
              <div><span style={{ color: '#64748b' }}>实际入场:</span> <span style={{ color: '#e2e8f0' }}>{plan.actualEntry?.toFixed(4)}</span></div>
              <div><span style={{ color: '#64748b' }}>实际出场:</span> <span style={{ color: '#e2e8f0' }}>{plan.actualExit?.toFixed(4)}</span></div>
              <div><span style={{ color: '#64748b' }}>盈亏:</span>
                <span style={{ color: (plan.actualPnl ?? 0) >= 0 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
                  {(plan.actualPnl ?? 0) >= 0 ? '+' : ''}{plan.actualPnl?.toFixed(2)} USDT
                </span>
              </div>
              <div><span style={{ color: '#64748b' }}>盈亏%:</span>
                <span style={{ color: (plan.actualPnlPercent ?? 0) >= 0 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
                  {(plan.actualPnlPercent ?? 0) >= 0 ? '+' : ''}{plan.actualPnlPercent?.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {plan.status === 'PLANNED' && (
            <button
              onClick={() => { updateTradePlan(plan.id, { status: 'ACTIVE' }); onUpdate(); }}
              style={{ background: '#f59e0b', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >
              标记为执行中
            </button>
          )}
          {plan.status === 'ACTIVE' && (
            <button
              onClick={() => {
                const entry = prompt('实际入场价:', String(plan.plannedEntry));
                const exit = prompt('实际出场价:', String(plan.plannedTakeProfit[0] ?? plan.plannedEntry));
                if (entry && exit) {
                  const en = Number(entry);
                  const ex = Number(exit);
                  const pnl = plan.direction === 'LONG' ? (ex - en) * (plan.plannedPositionSize || 1) : (en - ex) * (plan.plannedPositionSize || 1);
                  const pnlPct = en > 0 ? ((ex - en) / en) * 100 * (plan.direction === 'LONG' ? 1 : -1) : 0;
                  closePlan(plan.id, { actualEntry: en, actualExit: ex, actualPnl: pnl, actualPnlPercent: pnlPct });
                  onUpdate();
                }
              }}
              style={{ background: '#22c55e', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >
              标记为结束
            </button>
          )}
          {(plan.status === 'PLANNED' || plan.status === 'ACTIVE') && (
            <button
              onClick={() => { cancelPlan(plan.id, '手动取消'); onUpdate(); }}
              style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
            >
              取消计划
            </button>
          )}
          <button
            onClick={() => { deleteTradePlan(plan.id); onUpdate(); onClose(); }}
            style={{ background: 'transparent', border: '1px solid #64748b', color: '#64748b', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 主面板 ====================

export default function TradePlanPanel() {
  const [filter, setFilter] = useState<TradePlanStatus | 'ALL'>('ALL');
  const [plans, setPlans] = useState<TradePlan[]>(() => getTradePlans());
  const [modalPlan, setModalPlan] = useState<TradePlan | undefined>(undefined);
  const [detailPlan, setDetailPlan] = useState<TradePlan | null>(null);
  const [showModal, setShowModal] = useState(false);

  const refresh = useCallback(() => {
    setPlans(getTradePlans());
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return plans;
    return plans.filter((p) => p.status === filter);
  }, [plans, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [filtered]);

  return (
    <div className="lab-panel">
      {/* 统计 */}
      <PlanStatsView />

      {/* 筛选 + 新建 */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['ALL', 'PLANNED', 'ACTIVE', 'CLOSED', 'CANCELLED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                background: filter === s ? '#3b82f6' : '#1a1b23',
                border: `1px solid ${filter === s ? '#3b82f6' : '#2d2e3d'}`,
                color: filter === s ? '#fff' : '#94a3b8',
                padding: '5px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: filter === s ? 600 : 400,
              }}
            >
              {s === 'ALL' ? '全部' : STATUS_LABELS[s].label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setModalPlan(undefined); setShowModal(true); }}
          style={{
            background: '#3b82f6',
            border: 'none',
            color: '#fff',
            padding: '6px 16px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            marginLeft: 'auto',
          }}
        >
          + 新建计划
        </button>
      </div>

      {/* 列表 */}
      {sorted.length === 0 ? (
        <div className="status-bar info" style={{ textAlign: 'center', padding: '40px 20px' }}>
          {filter === 'ALL' ? '暂无交易计划，点击「新建计划」开始制定你的第一个交易计划' : `暂无「${STATUS_LABELS[filter]?.label || filter}」状态的计划`}
        </div>
      ) : (
        <div className="table-container">
          <table className="trades-table">
            <thead>
              <tr>
                <th>品种</th>
                <th>方向</th>
                <th>形态</th>
                <th>入场 / 止损</th>
                <th>止盈</th>
                <th>状态</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((plan) => {
                const risk = Math.abs(plan.plannedEntry - plan.plannedStopLoss);
                const reward = plan.plannedTakeProfit.length > 0 ? Math.abs(plan.plannedTakeProfit[0] - plan.plannedEntry) : 0;
                const rr = risk > 0 ? reward / risk : 0;
                return (
                  <tr
                    key={plan.id}
                    onClick={() => setDetailPlan(plan)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ fontWeight: 600, color: '#e2e8f0' }}>{plan.symbol}</td>
                    <td>
                      <span style={{
                        color: plan.direction === 'LONG' ? '#ef4444' : '#22c55e',
                        fontWeight: 600,
                        fontSize: 12,
                      }}>
                        {plan.direction === 'LONG' ? '多' : '空'}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        {SETUP_OPTIONS.find((o) => o.value === plan.setupType)?.label ?? plan.setupType}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      <div><span style={{ color: '#e2e8f0' }}>{plan.plannedEntry.toFixed(2)}</span></div>
                      <div><span style={{ color: '#ef4444' }}>{plan.plannedStopLoss.toFixed(2)}</span></div>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      <div style={{ color: '#22c55e' }}>{plan.plannedTakeProfit.map((t) => t.toFixed(2)).join(' / ')}</div>
                      <div style={{ color: '#f59e0b', fontSize: 11 }}>RR 1:{rr.toFixed(1)}</div>
                    </td>
                    <td><StatusBadge status={plan.status} /></td>
                    <td style={{ fontSize: 11, color: '#64748b' }}>
                      {new Date(plan.createdAt).toLocaleDateString('zh-CN')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 弹窗 */}
      {showModal && (
        <PlanModal
          plan={modalPlan}
          onClose={() => setShowModal(false)}
          onSave={refresh}
        />
      )}

      {/* 详情抽屉 */}
      {detailPlan && (
        <PlanDetailDrawer
          plan={detailPlan}
          onClose={() => setDetailPlan(null)}
          onUpdate={refresh}
        />
      )}
    </div>
  );
}
