import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { getTradeById, getReviewByTradeId, getStrategies } from '../lib/db';
import { calcExecutionScore, detectLuckyTrade } from '../lib/calculations';
import { updateTrade } from '../lib/db';
import TradeReviewForm from '../components/TradeReviewForm';
import KlineChart from '../components/KlineChart';
import './TradeDetail.css';

const ERROR_LABELS: Record<string, string> = {
  entry_logic: '开仓逻辑错误',
  stop_loss: '止损设置不合理',
  over_position: '仓位过大',
  emotional: '情绪化交易',
  premature_exit: '过早止盈',
  no_stop: '扛单不止损',
  fomo: 'FOMO 追涨杀跌',
  revenge: '报复性交易',
};

const EMOTION_LABELS: Record<string, string> = {
  calm: '😌 冷静',
  confident: '😎 自信',
  fear: '😨 恐惧',
  greed: '🤑 贪婪',
  fomo: '😰 害怕错过',
  anxious: '😟 焦虑',
  frustrated: '😞 沮丧',
  hesitant: '🤔 犹豫',
};

export default function TradeDetail() {
  const { id } = useParams<{ id: string }>();
  const [refreshKey, setRefreshKey] = useState(0);

  if (!id) return <div className="not-found">无效交易 ID</div>;

  const trade = getTradeById(id);
  if (!trade) return <div className="not-found">未找到该交易</div>;

  const review = getReviewByTradeId(id);
  const score = calcExecutionScore({ trade, review: review ?? null });
  const luckyResult = detectLuckyTrade({
    pnl: trade.pnl,
    direction: trade.direction,
    entryPrice: trade.entryPrice,
    stopLoss: trade.stopLoss,
    maePercent: trade.maePercent,
  });

  // 关联策略
  const strategies = getStrategies();
  const linkedStrategy = trade.strategyId ? strategies.find((s) => s.id === trade.strategyId) : null;

  const isLong = trade.direction === 'LONG';
  const entry = trade.entryPrice;
  const stopLoss = trade.stopLoss;
  const takeProfit = trade.takeProfit;
  const exit = trade.exitPrice;

  const allPrices = [entry, stopLoss, takeProfit, exit].filter(Boolean) as number[];
  const minP = allPrices.length > 1 ? Math.min(...allPrices) * 0.999 : entry * 0.99;
  const maxP = allPrices.length > 1 ? Math.max(...allPrices) * 1.001 : entry * 1.01;
  const range = maxP - minP;

  const priceY = (price: number): number => 100 - ((price - minP) / range) * 100;

  const fmt = (v: number) => {
    if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (v >= 100) return v.toFixed(2);
    if (v >= 1) return v.toFixed(4);
    return v.toFixed(6);
  };

  const getPnlColor = (pnl: number) => (pnl >= 0 ? '#ef4444' : '#22c55e');
  const getScoreColor = (s: number) => (s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444');

  const handleStrategyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    updateTrade(trade.id, { strategyId: val || undefined });
    setRefreshKey((k) => k + 1);
  };

  const handleReviewSaved = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="trade-detail-page" key={refreshKey}>
      <Link to="/trades" className="back-link">
        ← 返回交易列表
      </Link>

      {/* 页头 */}
      <div className="detail-header">
        <div>
          <h1 className="detail-title">
            {trade.symbol}
            <span className={`dir-badge ${trade.direction.toLowerCase()}`}>
              {isLong ? '多' : '空'} {trade.leverage}x
            </span>
          </h1>
          <p className="detail-time">
            {new Date(trade.entryTime).toLocaleString('zh-CN')}
            {trade.exitTime && ` → ${new Date(trade.exitTime).toLocaleString('zh-CN')}`}
          </p>
        </div>
        <div className="detail-pnl" style={{ color: getPnlColor(trade.pnl || 0) }}>
          {(trade.pnl || 0) >= 0 ? '+' : ''}
          {(trade.pnl || 0).toFixed(2)} USDT
          <span className="pnl-percent">
            {(trade.pnlPercent || 0).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* 侥幸警告 */}
      {(trade.isLuckyTrade || luckyResult.isLucky) && (
        <div className="lucky-alert">
          <span className="alert-icon">⚠️</span>
          <div>
            <strong>这是一笔侥幸交易！</strong>
            <p>{trade.luckyReason || luckyResult.reason}</p>
            <p className="alert-hint">这笔盈利不代表你的交易能力强，下次可能没这么幸运。</p>
          </div>
        </div>
      )}

      {/* 信息网格 + 执行评估 */}
      <div className="detail-grid">
        <div className="detail-card">
          <h3>交易信息</h3>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">开仓价</span>
              <span className="info-value">{fmt(entry)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">平仓价</span>
              <span className="info-value">{exit ? fmt(exit) : '-'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">止损价</span>
              <span className="info-value" style={stopLoss ? {} : { color: '#ef4444' }}>
                {stopLoss ? fmt(stopLoss) : '未设置 ⚠️'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">止盈价</span>
              <span className="info-value">{takeProfit ? fmt(takeProfit) : '未设置'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">仓位大小</span>
              <span className="info-value">{trade.positionSize}</span>
            </div>
            <div className="info-item">
              <span className="info-label">杠杆</span>
              <span className="info-value">{trade.leverage}x</span>
            </div>
            <div className="info-item">
              <span className="info-label">手续费</span>
              <span className="info-value">{trade.fee?.toFixed(2) ?? '-'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">保证金</span>
              <span className="info-value">{trade.margin?.toFixed(2) ?? '-'} USDT</span>
            </div>
            <div className="info-item">
              <span className="info-label">持有时间</span>
              <span className="info-value">
                {trade.holdingSeconds
                  ? trade.holdingSeconds > 3600
                    ? `${(trade.holdingSeconds / 3600).toFixed(1)} 小时`
                    : `${Math.floor(trade.holdingSeconds / 60)} 分钟`
                  : '-'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">状态</span>
              <span className={`status-tag ${trade.status.toLowerCase()}`}>
                {trade.status === 'CLOSED' ? '已平仓' : trade.status === 'OPEN' ? '持仓中' : '已取消'}
              </span>
            </div>
          </div>

          {/* 关联策略 */}
          <div className="strategy-link-section">
            <label className="info-label">关联策略</label>
            <select
              className="strategy-select"
              value={trade.strategyId ?? ''}
              onChange={handleStrategyChange}
            >
              <option value="">无策略</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.isActive ? '' : '(停用)'}
                </option>
              ))}
            </select>
            {linkedStrategy && (
              <div className="linked-strategy-info">
                {linkedStrategy.description && <p>{linkedStrategy.description}</p>}
              </div>
            )}
          </div>
        </div>

        <div className="detail-card">
          <h3>执行评估</h3>
          <div className="score-display">
            <div
              className="score-circle"
              style={{ borderColor: getScoreColor(score), color: getScoreColor(score) }}
            >
              {score}
            </div>
            <span className="score-label">执行分</span>
          </div>

          {review && (
            <div className="review-score-detail">
              <div className="mini-score-row">
                <span>入场</span>
                <span className="mini-stars">
                  {'★'.repeat(review.entryScore ?? 0)}
                  {'☆'.repeat(5 - (review.entryScore ?? 0))}
                </span>
              </div>
              <div className="mini-score-row">
                <span>出场</span>
                <span className="mini-stars">
                  {'★'.repeat(review.exitScore ?? 0)}
                  {'☆'.repeat(5 - (review.exitScore ?? 0))}
                </span>
              </div>
              <div className="mini-score-row">
                <span>仓位</span>
                <span className="mini-stars">
                  {'★'.repeat(review.positionScore ?? 0)}
                  {'☆'.repeat(5 - (review.positionScore ?? 0))}
                </span>
              </div>
              <div className="mini-score-row">
                <span>情绪</span>
                <span className="mini-stars">
                  {'★'.repeat(review.emotionScore ?? 0)}
                  {'☆'.repeat(5 - (review.emotionScore ?? 0))}
                </span>
              </div>
              <div className="mini-score-row">
                <span>计划</span>
                <span className="mini-stars">
                  {'★'.repeat(review.planExecutionScore ?? 0)}
                  {'☆'.repeat(5 - (review.planExecutionScore ?? 0))}
                </span>
              </div>
            </div>
          )}

          {/* MAE/MFE */}
          <div className="mae-mfe">
            <div className="mae-item">
              <span className="mae-label">MAE（最大不利变动）</span>
              <span className="mae-value" style={{ color: '#ef4444' }}>
                -{trade.mae ? fmt(trade.mae) : '-'}
                {trade.maePercent ? ` (-${trade.maePercent.toFixed(2)}%)` : ''}
              </span>
            </div>
            <div className="mae-item">
              <span className="mae-label">MFE（最大有利变动）</span>
              <span className="mae-value" style={{ color: '#22c55e' }}>
                +{trade.mfe ? fmt(trade.mfe) : '-'}
                {trade.mfePercent ? ` (+${trade.mfePercent.toFixed(2)}%)` : ''}
              </span>
            </div>
          </div>

          <div className="price-chart">
            <div className="price-bar">
              {stopLoss && (
                <div className="price-line stop-loss" style={{ top: `${priceY(stopLoss)}%` }}>
                  <span>SL {fmt(stopLoss)}</span>
                </div>
              )}
              <div className="price-line entry" style={{ top: `${priceY(entry)}%` }}>
                <span>开仓 {fmt(entry)}</span>
              </div>
              {takeProfit && (
                <div className="price-line take-profit" style={{ top: `${priceY(takeProfit)}%` }}>
                  <span>TP {fmt(takeProfit)}</span>
                </div>
              )}
              {exit && (
                <div className="price-line exit" style={{ top: `${priceY(exit)}%` }}>
                  <span>平仓 {fmt(exit)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 复盘摘要（如果有） */}
      {review && (
        <div className="review-summary">
          <div className="detail-card">
            <h3>复盘摘要</h3>
            {review.errors && review.errors.length > 0 && (
              <div className="summary-section">
                <span className="summary-label">错误点</span>
                <div className="error-tags">
                  {review.errors.map((e) => (
                    <span key={e} className="error-tag">
                      {ERROR_LABELS[e] || e}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {review.improvementPlan && (
              <div className="summary-section">
                <span className="summary-label">改进计划</span>
                <p className="summary-text">{review.improvementPlan}</p>
              </div>
            )}
            {review.emotions && review.emotions.length > 0 && (
              <div className="summary-section">
                <span className="summary-label">交易情绪</span>
                <div className="emotion-tags">
                  {review.emotions.map((e) => (
                    <span key={e} className="emotion-tag">
                      {EMOTION_LABELS[e] || e}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="summary-section">
              <span className="summary-label">按计划执行</span>
              <span className={`plan-badge ${review.followedPlan ? 'yes' : 'no'}`}>
                {review.followedPlan ? '✅ 是' : '❌ 否'}
              </span>
            </div>
            {review.whatWentWell && (
              <div className="summary-section">
                <span className="summary-label">做得好的地方</span>
                <p className="summary-text">{review.whatWentWell}</p>
              </div>
            )}
            {review.whatWentWrong && (
              <div className="summary-section">
                <span className="summary-label">做得不好的地方</span>
                <p className="summary-text">{review.whatWentWrong}</p>
              </div>
            )}
            {review.lessonsLearned && (
              <div className="summary-section">
                <span className="summary-label">经验教训</span>
                <p className="summary-text">{review.lessonsLearned}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* K线复盘（独立显示，无需复盘数据） */}
      <div className="detail-card">
        <h3>📊 市场K线复盘</h3>
        <KlineChart trade={trade} />
      </div>

      {/* 交易笔记 */}
      {trade.notes && (
        <div className="detail-card">
          <h3>交易笔记</h3>
          <p className="notes-text">{trade.notes}</p>
        </div>
      )}

      {/* 复盘表单 */}
      <TradeReviewForm
        tradeId={trade.id}
        initialReview={review}
        onSaved={handleReviewSaved}
      />
    </div>
  );
}
