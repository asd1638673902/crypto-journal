import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addTrade } from '../lib/db';
import { calcPnl, calcPnlPercent } from '../lib/calculations';
import './NewTrade.css';

const COMMON_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',
  'DOGEUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT',
];

export default function NewTrade() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    symbol: 'BTCUSDT',
    direction: 'LONG' as 'LONG' | 'SHORT',
    leverage: 10,
    entryPrice: '',
    exitPrice: '',
    stopLoss: '',
    takeProfit: '',
    positionSize: '',
    margin: '',
    fee: '0',
    entryTime: new Date().toISOString().slice(0, 16),
    exitTime: '',
    status: 'OPEN' as 'OPEN' | 'CLOSED',
    notes: '',
  });

  const [saving, setSaving] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleDirectionToggle = (dir: 'LONG' | 'SHORT') => {
    setForm((prev) => ({ ...prev, direction: dir }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const entryPrice = parseFloat(form.entryPrice);
    const positionSize = parseFloat(form.positionSize);
    const leverage = form.leverage;

    let pnl: number | undefined;
    let pnlPercent: number | undefined;

    if (form.status === 'CLOSED' && form.exitPrice) {
      const exitPrice = parseFloat(form.exitPrice);
      const fee = parseFloat(form.fee) || 0;
      const rawPnl = calcPnl(form.direction, entryPrice, exitPrice, positionSize);
      pnl = rawPnl - fee;
      pnlPercent = calcPnlPercent(pnl, entryPrice, positionSize, leverage);
    }

    const trade = addTrade({
      exchange: 'manual',
      orderId: `manual-${Date.now()}`,
      symbol: form.symbol,
      direction: form.direction,
      leverage,
      entryPrice,
      exitPrice: form.exitPrice ? parseFloat(form.exitPrice) : undefined,
      stopLoss: form.stopLoss ? parseFloat(form.stopLoss) : undefined,
      takeProfit: form.takeProfit ? parseFloat(form.takeProfit) : undefined,
      positionSize,
      margin: form.margin ? parseFloat(form.margin) : undefined,
      fee: parseFloat(form.fee) || 0,
      entryTime: new Date(form.entryTime).toISOString(),
      exitTime: form.exitTime ? new Date(form.exitTime).toISOString() : undefined,
      pnl,
      pnlPercent,
      status: form.status,
      isLuckyTrade: false,
      notes: form.notes || undefined,
    });

    setSaving(false);
    navigate(`/trades/${trade.id}`);
  };

  return (
    <div className="new-trade-page">
      <h1 className="page-title">新建交易</h1>

      <form className="trade-form" onSubmit={handleSubmit}>
        {/* 品种 + 方向 */}
        <div className="form-row">
          <div className="form-group">
            <label>交易对</label>
            <select name="symbol" value={form.symbol} onChange={handleChange}>
              {COMMON_SYMBOLS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>方向</label>
            <div className="direction-toggle">
              <button
                type="button"
                className={`toggle-btn ${form.direction === 'LONG' ? 'active-long' : ''}`}
                onClick={() => handleDirectionToggle('LONG')}
              >
                ⬆ 多
              </button>
              <button
                type="button"
                className={`toggle-btn ${form.direction === 'SHORT' ? 'active-short' : ''}`}
                onClick={() => handleDirectionToggle('SHORT')}
              >
                ⬇ 空
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>杠杆 (x)</label>
            <input
              type="number"
              name="leverage"
              value={form.leverage}
              onChange={handleChange}
              min={1}
              max={125}
            />
          </div>
        </div>

        {/* 价格 */}
        <div className="form-row">
          <div className="form-group">
            <label>开仓价 (USDT)</label>
            <input
              type="number"
              name="entryPrice"
              value={form.entryPrice}
              onChange={handleChange}
              step="any"
              required
            />
          </div>
          <div className="form-group">
            <label>平仓价 (USDT)</label>
            <input
              type="number"
              name="exitPrice"
              value={form.exitPrice}
              onChange={handleChange}
              step="any"
              disabled={form.status === 'OPEN'}
            />
          </div>
          <div className="form-group">
            <label>止损价</label>
            <input
              type="number"
              name="stopLoss"
              value={form.stopLoss}
              onChange={handleChange}
              step="any"
            />
          </div>
          <div className="form-group">
            <label>止盈价</label>
            <input
              type="number"
              name="takeProfit"
              value={form.takeProfit}
              onChange={handleChange}
              step="any"
            />
          </div>
        </div>

        {/* 仓位 */}
        <div className="form-row">
          <div className="form-group">
            <label>仓位大小 (币)</label>
            <input
              type="number"
              name="positionSize"
              value={form.positionSize}
              onChange={handleChange}
              step="any"
              required
            />
          </div>
          <div className="form-group">
            <label>保证金 (USDT，可选)</label>
            <input
              type="number"
              name="margin"
              value={form.margin}
              onChange={handleChange}
              step="any"
            />
          </div>
          <div className="form-group">
            <label>手续费</label>
            <input
              type="number"
              name="fee"
              value={form.fee}
              onChange={handleChange}
              step="any"
            />
          </div>
        </div>

        {/* 时间 */}
        <div className="form-row">
          <div className="form-group">
            <label>开仓时间</label>
            <input
              type="datetime-local"
              name="entryTime"
              value={form.entryTime}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label>平仓时间</label>
            <input
              type="datetime-local"
              name="exitTime"
              value={form.exitTime}
              onChange={handleChange}
              disabled={form.status === 'OPEN'}
            />
          </div>
          <div className="form-group">
            <label>状态</label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
            >
              <option value="OPEN">持仓中</option>
              <option value="CLOSED">已平仓</option>
            </select>
          </div>
        </div>

        {/* 笔记 */}
        <div className="form-group full-width">
          <label>交易笔记</label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={3}
            placeholder="记录入场理由、市场情况..."
          />
        </div>

        {/* 提交 */}
        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={() => navigate('/trades')}>
            取消
          </button>
          <button type="submit" className="btn-submit" disabled={saving}>
            {saving ? '保存中...' : '保存交易'}
          </button>
        </div>
      </form>
    </div>
  );
}
