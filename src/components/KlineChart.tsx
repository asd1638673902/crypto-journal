/**
 * 真实K线复盘图组件
 * 支持币安API获取的15m/1h K线 + 开平仓/止损/止盈标记
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchKlines, type KlineData, type KlineInterval } from '../lib/exchange';
import type { Trade } from '../lib/types';
import './KlineChart.css';

interface Props {
  trade: Trade;
}

type Period = '15m' | '1h';

const PERIODS: { key: Period; label: string }[] = [
  { key: '15m', label: '15分钟' },
  { key: '1h', label: '1小时' },
];

export default function KlineChart({ trade }: Props) {
  const [period, setPeriod] = useState<Period>('15m');
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entryTime = new Date(trade.entryTime).getTime();
  const exitTime = trade.exitTime ? new Date(trade.exitTime).getTime() : Date.now();

  // 获取K线数据
  const loadKlines = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      // 在交易前后各扩展30%的时间范围，以便看到更多上下文
      const duration = exitTime - entryTime;
      const padding = Math.max(duration * 0.3, 3600000); // 最少1小时padding
      const startTime = entryTime - padding;
      const endTime = exitTime + padding;

      const data = await fetchKlines({
        symbol: trade.symbol,
        interval: p as KlineInterval,
        startTime,
        endTime,
        limit: 500,
      });
      setKlines(data);
    } catch (err: any) {
      setError(err.message || '获取K线数据失败');
      setKlines([]);
    } finally {
      setLoading(false);
    }
  }, [trade.symbol, entryTime, exitTime]);

  useEffect(() => {
    loadKlines(period);
  }, [period, loadKlines]);

  // 渲染K线图
  return (
    <div className="kline-chart-wrapper">
      {/* 标题 + 周期切换 */}
      <div className="kline-header">
        <span className="kline-title">
          {trade.symbol} K线复盘
          <span className="kline-subtitle">
            {new Date(trade.entryTime).toLocaleString('zh-CN')} → {trade.exitTime ? new Date(trade.exitTime).toLocaleString('zh-CN') : '持仓中'}
          </span>
        </span>
        <div className="kline-periods">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={`period-btn ${period === p.key ? 'active' : ''}`}
              onClick={() => setPeriod(p.key)}
              disabled={loading}
            >
              {p.label}
            </button>
          ))}
          <button
            className="refresh-btn"
            onClick={() => loadKlines(period)}
            disabled={loading}
            title="刷新K线数据"
          >
            {loading ? '⏳' : '🔄'}
          </button>
        </div>
      </div>

      {/* 加载中/错误 */}
      {loading && (
        <div className="kline-status">
          <span className="spinner" /> 正在获取 {period === '15m' ? '15分钟' : '1小时'} K线数据...
        </div>
      )}
      {error && (
        <div className="kline-status error">
          ❌ {error}
          {trade.exchange !== 'binance' && (
            <span className="kline-hint">（此交易非币安数据，无法获取对应K线）</span>
          )}
        </div>
      )}

      {/* K线图 */}
      {!loading && !error && klines.length > 0 && (
        <KlineCanvas
          klines={klines}
          entryPrice={trade.entryPrice}
          exitPrice={trade.exitPrice}
          stopLoss={trade.stopLoss}
          takeProfit={trade.takeProfit}
          direction={trade.direction}
          entryTime={entryTime}
          exitTime={exitTime}
        />
      )}
      {!loading && !error && klines.length === 0 && (
        <div className="kline-status">暂无可用的K线数据</div>
      )}
    </div>
  );
}

// ==================== K线渲染 ====================

function KlineCanvas({
  klines,
  entryPrice,
  exitPrice,
  stopLoss,
  takeProfit,
  direction,
  entryTime,
  exitTime,
}: {
  klines: KlineData[];
  entryPrice: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  direction: 'LONG' | 'SHORT';
  entryTime: number;
  exitTime: number;
}) {
  const SVG_W = 680;
  const SVG_H = 300;
  const PADDING = { top: 30, right: 20, bottom: 50, left: 65 };

  const chartW = SVG_W - PADDING.left - PADDING.right;
  const chartH = SVG_H - PADDING.top - PADDING.bottom;

  // 价格范围
  const allPrices = klines.flatMap((k) => [k.high, k.low]);
  if (entryPrice) allPrices.push(entryPrice);
  if (exitPrice) allPrices.push(exitPrice);
  if (stopLoss) allPrices.push(stopLoss);
  if (takeProfit) allPrices.push(takeProfit);

  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const range = maxPrice - minPrice || entryPrice * 0.01;
  const padRange = range * 0.08;
  const yMin = minPrice - padRange;
  const yMax = maxPrice + padRange;
  const yRange = yMax - yMin;

  // 成交量范围
  const vols = klines.map((k) => k.volume);
  const maxVol = Math.max(...vols);

  const priceToY = (price: number) => PADDING.top + chartH * (1 - (price - yMin) / yRange);
  const volToH = (vol: number) => (vol / maxVol) * 40;

  const barSpacing = chartW / klines.length;
  const barWidth = Math.max(2, barSpacing * 0.7);
  const gap = klines.length > 60 ? 2 : 4;

  const fmtPrice = (p: number) => {
    if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (p >= 100) return p.toFixed(2);
    if (p >= 1) return p.toFixed(4);
    return p.toFixed(6);
  };

  // 找到开仓/平仓所在的K线索引
  const getCandleIndex = (ts: number) => {
    let idx = klines.findIndex((k) => k.time <= ts && k.closeTime >= ts);
    if (idx === -1) {
      idx = klines.reduce((best, k, i) => {
        const diff = Math.abs(k.time - ts);
        const bestDiff = Math.abs(klines[best].time - ts);
        return diff < bestDiff ? i : best;
      }, 0);
    }
    return idx;
  };

  const entryIdx = getCandleIndex(entryTime);
  const exitIdx = exitPrice ? getCandleIndex(exitTime) : -1;

  const isLong = direction === 'LONG';

  // Y轴刻度
  const yTicks = 6;
  const yStep = yRange / yTicks;

  // X轴标签
  const xLabelCount = Math.min(6, klines.length);
  const xStep = Math.max(1, Math.floor(klines.length / xLabelCount));

  const entryX = PADDING.left + entryIdx * barSpacing + barSpacing / 2;
  const exitX = exitIdx >= 0 ? PADDING.left + exitIdx * barSpacing + barSpacing / 2 : 0;

  return (
    <div className="kline-canvas">
      {/* 图例 */}
      <div className="kline-legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: '#3b82f6' }} /> 开仓 {fmtPrice(entryPrice)}</span>
        {exitPrice && <span className="legend-item"><span className="legend-dot" style={{ background: '#a855f7' }} /> 平仓 {fmtPrice(exitPrice)}</span>}
        {stopLoss && <span className="legend-item"><span className="legend-dot" style={{ background: '#ef4444' }} /> 止损 {fmtPrice(stopLoss)}</span>}
        {takeProfit && <span className="legend-item"><span className="legend-dot" style={{ background: '#22c55e' }} /> 止盈 {fmtPrice(takeProfit)}</span>}
        <span className="legend-item"><span className="legend-dot" style={{ background: isLong ? '#ef4444' : '#22c55e' }} /> {isLong ? '做多' : '做空'}</span>
      </div>

      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Y轴刻度 + 网格线 */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const price = yMin + yStep * i;
          const y = priceToY(price);
          return (
            <g key={i}>
              <line x1={PADDING.left} y1={y} x2={SVG_W - PADDING.right} y2={y} stroke="#2d2e3d" strokeWidth={1} />
              <text x={PADDING.left - 8} y={y + 4} textAnchor="end" fill="#64748b" fontSize={10}>
                {fmtPrice(price)}
              </text>
            </g>
          );
        })}

        {/* K线柱 */}
        {klines.map((k, i) => {
          const x = PADDING.left + i * barSpacing + gap / 2;
          const isUp = k.close >= k.open;
          const color = isUp ? '#ef4444' : '#22c55e';

          const bodyTop = priceToY(Math.max(k.open, k.close));
          const bodyBot = priceToY(Math.min(k.open, k.close));
          const bodyH = Math.max(bodyBot - bodyTop, 1);
          const wickTop = priceToY(k.high);
          const wickBot = priceToY(k.low);

          const cx = x + (barWidth - gap) / 2;

          return (
            <g key={i}>
              {/* 成交量柱（底部） */}
              <rect
                x={cx}
                y={SVG_H - PADDING.bottom + 6 + (40 - volToH(k.volume))}
                width={Math.max(1, barWidth - gap)}
                height={volToH(k.volume)}
                fill={color}
                opacity={0.25}
              />

              {/* 上影线 */}
              <line x1={cx + (barWidth - gap) / 2} y1={wickTop} x2={cx + (barWidth - gap) / 2} y2={bodyTop} stroke={color} strokeWidth={1} />
              {/* 下影线 */}
              <line x1={cx + (barWidth - gap) / 2} y1={bodyBot} x2={cx + (barWidth - gap) / 2} y2={wickBot} stroke={color} strokeWidth={1} />
              {/* 实体 */}
              <rect
                x={cx}
                y={bodyTop}
                width={barWidth - gap}
                height={bodyH}
                fill={color}
                rx={0.5}
              />
            </g>
          );
        })}

        {/* X轴时间标签 */}
        {klines.map((k, i) => {
          if (i % xStep !== 0) return null;
          const x = PADDING.left + i * barSpacing + barSpacing / 2;
          const d = new Date(k.time);
          const label = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
          return (
            <text key={i} x={x} y={SVG_H - PADDING.bottom + 50} textAnchor="middle" fill="#64748b" fontSize={9} transform={`rotate(-30, ${x}, ${SVG_H - PADDING.bottom + 50})`}>
              {label}
            </text>
          );
        })}

        {/* 开仓标记线 */}
        <line x1={entryX} y1={PADDING.top} x2={entryX} y2={SVG_H - PADDING.bottom} stroke="#3b82f6" strokeWidth={2} strokeDasharray="6 3" />
        <rect x={entryX - 30} y={PADDING.top - 12} width={60} height={20} rx={4} fill="#3b82f6" />
        <text x={entryX} y={PADDING.top + 2} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={600}>
          开仓 {fmtPrice(entryPrice)}
        </text>

        {/* 平仓标记线 */}
        {exitPrice && exitIdx >= 0 && (
          <>
            <line x1={exitX} y1={PADDING.top} x2={exitX} y2={SVG_H - PADDING.bottom} stroke="#a855f7" strokeWidth={2} strokeDasharray="6 3" />
            <rect x={exitX - 30} y={PADDING.top + 10} width={60} height={20} rx={4} fill="#a855f7" />
            <text x={exitX} y={PADDING.top + 24} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={600}>
              平仓 {fmtPrice(exitPrice)}
            </text>
          </>
        )}

        {/* 止损线 */}
        {stopLoss && (
          <line x1={PADDING.left} y1={priceToY(stopLoss)} x2={SVG_W - PADDING.right} y2={priceToY(stopLoss)} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.6} />
        )}

        {/* 止盈线 */}
        {takeProfit && (
          <line x1={PADDING.left} y1={priceToY(takeProfit)} x2={SVG_W - PADDING.right} y2={priceToY(takeProfit)} stroke="#22c55e" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.6} />
        )}

        {/* 成交量标签 */}
        <text x={SVG_W - PADDING.right} y={SVG_H - PADDING.bottom + 50} textAnchor="end" fill="#475569" fontSize={9}>
          成交量
        </text>
      </svg>
    </div>
  );
}
