/**
 * 交易复盘表单组件
 * 支持评分、错误点标记、改进计划、情绪标签、文字复盘
 */

import { useState, useEffect } from 'react';
import type { TradeReview } from '../lib/types';
import { upsertReview } from '../lib/db';
import './TradeReviewForm.css';

const SCORE_OPTIONS = [
  { value: 1, label: '很差' },
  { value: 2, label: '较差' },
  { value: 3, label: '一般' },
  { value: 4, label: '较好' },
  { value: 5, label: '很好' },
];

const ERROR_OPTIONS = [
  { value: 'entry_logic', label: '开仓逻辑错误', icon: '🎯' },
  { value: 'stop_loss', label: '止损设置不合理', icon: '🛑' },
  { value: 'over_position', label: '仓位过大', icon: '🏋️' },
  { value: 'emotional', label: '情绪化交易', icon: '😤' },
  { value: 'premature_exit', label: '过早止盈', icon: '🏃' },
  { value: 'no_stop', label: '扛单不止损', icon: '💀' },
  { value: 'fomo', label: 'FOMO 追涨杀跌', icon: '🔥' },
  { value: 'revenge', label: '报复性交易', icon: '⚔️' },
];

const EMOTION_OPTIONS = [
  { value: 'calm', label: '冷静', icon: '😌' },
  { value: 'confident', label: '自信', icon: '😎' },
  { value: 'fear', label: '恐惧', icon: '😨' },
  { value: 'greed', label: '贪婪', icon: '🤑' },
  { value: 'fomo', label: '害怕错过', icon: '😰' },
  { value: 'anxious', label: '焦虑', icon: '😟' },
  { value: 'frustrated', label: '沮丧', icon: '😞' },
  { value: 'hesitant', label: '犹豫', icon: '🤔' },
];

interface Props {
  tradeId: string;
  initialReview?: TradeReview | null;
  onSaved?: () => void;
}

export default function TradeReviewForm({ tradeId, initialReview, onSaved }: Props) {
  const [entryScore, setEntryScore] = useState(initialReview?.entryScore ?? 3);
  const [exitScore, setExitScore] = useState(initialReview?.exitScore ?? 3);
  const [positionScore, setPositionScore] = useState(initialReview?.positionScore ?? 3);
  const [emotionScore, setEmotionScore] = useState(initialReview?.emotionScore ?? 3);
  const [planScore, setPlanScore] = useState(initialReview?.planExecutionScore ?? 3);
  const [errors, setErrors] = useState<string[]>(initialReview?.errors ?? []);
  const [emotions, setEmotions] = useState<string[]>(initialReview?.emotions ?? []);
  const [followedPlan, setFollowedPlan] = useState(initialReview?.followedPlan ?? false);
  const [whatWentWell, setWhatWentWell] = useState(initialReview?.whatWentWell ?? '');
  const [whatWentWrong, setWhatWentWrong] = useState(initialReview?.whatWentWrong ?? '');
  const [lessonsLearned, setLessonsLearned] = useState(initialReview?.lessonsLearned ?? '');
  const [improvementPlan, setImprovementPlan] = useState(initialReview?.improvementPlan ?? '');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 有初始值变更时同步
  useEffect(() => {
    if (initialReview) {
      setEntryScore(initialReview.entryScore ?? 3);
      setExitScore(initialReview.exitScore ?? 3);
      setPositionScore(initialReview.positionScore ?? 3);
      setEmotionScore(initialReview.emotionScore ?? 3);
      setPlanScore(initialReview.planExecutionScore ?? 3);
      setErrors(initialReview.errors ?? []);
      setEmotions(initialReview.emotions ?? []);
      setFollowedPlan(initialReview.followedPlan ?? false);
      setWhatWentWell(initialReview.whatWentWell ?? '');
      setWhatWentWrong(initialReview.whatWentWrong ?? '');
      setLessonsLearned(initialReview.lessonsLearned ?? '');
      setImprovementPlan(initialReview.improvementPlan ?? '');
    }
  }, [initialReview]);

  const toggleError = (v: string) => {
    setErrors((prev) => (prev.includes(v) ? prev.filter((e) => e !== v) : [...prev, v]));
  };

  const toggleEmotion = (v: string) => {
    setEmotions((prev) => (prev.includes(v) ? prev.filter((e) => e !== v) : [...prev, v]));
  };

  const handleSave = () => {
    setSaving(true);
    // 从 errors 推断 biases
    const biases = errors
      .filter((e) => ['fomo', 'revenge', 'premature_exit', 'emotional'].includes(e))
      .map((e) => {
        const map: Record<string, string> = {
          fomo: 'fomo',
          revenge: 'revenge',
          premature_exit: 'premature_exit',
          emotional: 'emotional',
        };
        return map[e] || e;
      });

    upsertReview({
      tradeId,
      entryScore,
      exitScore,
      positionScore,
      emotionScore,
      planExecutionScore: planScore,
      biases,
      errors,
      improvementPlan,
      whatWentWell,
      whatWentWrong,
      lessonsLearned,
      emotions,
      followedPlan,
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved?.();
  };

  const hasReview = !!initialReview;

  return (
    <div className="review-form">
      <div className="review-header">
        <h3>交易复盘</h3>
        {hasReview && <span className="review-badge">已复盘</span>}
      </div>

      {/* 评分 */}
      <div className="review-section">
        <label className="review-section-title">评分维度</label>
        <div className="score-grid">
          {[
            { label: '入场质量', val: entryScore, set: setEntryScore },
            { label: '出场质量', val: exitScore, set: setExitScore },
            { label: '仓位管理', val: positionScore, set: setPositionScore },
            { label: '情绪控制', val: emotionScore, set: setEmotionScore },
            { label: '计划执行', val: planScore, set: setPlanScore },
          ].map((dim) => (
            <div key={dim.label} className="score-dim">
              <span className="score-dim-label">{dim.label}</span>
              <div className="star-group">
                {SCORE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`star-btn ${dim.val >= opt.value ? 'active' : ''}`}
                    onClick={() => dim.set(opt.value)}
                    title={opt.label}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 错误点 */}
      <div className="review-section">
        <label className="review-section-title">
          错误点 <span className="section-hint">（勾选本次交易的错误）</span>
        </label>
        <div className="chip-grid">
          {ERROR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`chip ${errors.includes(opt.value) ? 'active error' : ''}`}
              onClick={() => toggleError(opt.value)}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 改进计划 */}
      <div className="review-section">
        <label className="review-section-title">改进计划</label>
        <textarea
          className="review-textarea"
          placeholder="针对这次交易的错误，你打算怎么改进？..."
          value={improvementPlan}
          onChange={(e) => setImprovementPlan(e.target.value)}
          rows={2}
        />
      </div>

      {/* 情绪标签 */}
      <div className="review-section">
        <label className="review-section-title">
          交易时情绪 <span className="section-hint">（可多选）</span>
        </label>
        <div className="chip-grid">
          {EMOTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`chip ${emotions.includes(opt.value) ? 'active emotion' : ''}`}
              onClick={() => toggleEmotion(opt.value)}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 文字复盘 */}
      <div className="review-section">
        <label className="review-section-title">做得好的地方</label>
        <textarea
          className="review-textarea"
          placeholder="这次交易有哪些值得肯定的执行点？..."
          value={whatWentWell}
          onChange={(e) => setWhatWentWell(e.target.value)}
          rows={2}
        />
      </div>
      <div className="review-section">
        <label className="review-section-title">做得不好的地方</label>
        <textarea
          className="review-textarea"
          placeholder="哪里可以做得更好？..."
          value={whatWentWrong}
          onChange={(e) => setWhatWentWrong(e.target.value)}
          rows={2}
        />
      </div>
      <div className="review-section">
        <label className="review-section-title">经验教训</label>
        <textarea
          className="review-textarea"
          placeholder="从这笔交易中学到了什么？..."
          value={lessonsLearned}
          onChange={(e) => setLessonsLearned(e.target.value)}
          rows={2}
        />
      </div>

      {/* 是否按计划执行 */}
      <div className="review-section">
        <label className="review-section-title">是否按计划执行</label>
        <div className="plan-toggle">
          <button
            className={`toggle-btn ${followedPlan ? 'active yes' : ''}`}
            onClick={() => setFollowedPlan(true)}
          >
            ✅ 是
          </button>
          <button
            className={`toggle-btn ${!followedPlan ? 'active no' : ''}`}
            onClick={() => setFollowedPlan(false)}
          >
            ❌ 否（偏离计划）
          </button>
        </div>
      </div>

      {/* 保存按钮 */}
      <div className="review-actions">
        <button
          className="btn-save-review"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '保存中...' : saved ? '✅ 已保存' : hasReview ? '💾 更新复盘' : '💾 保存复盘'}
        </button>
      </div>
    </div>
  );
}
