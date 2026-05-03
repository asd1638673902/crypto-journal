/**
 * 通知面板
 * 顶部铃铛按钮 + 下拉通知列表 + 设置弹窗
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getNotificationHistory, getNotificationSettings, saveNotificationSettings,
  markNotificationRead, markAllNotificationsRead, clearNotificationHistory,
  requestNotificationPermission, hasNotificationPermission,
  startAutoScan, stopAutoScan, restartAutoScan,
  type NotificationRecord, type NotificationSettings,
} from '../lib/notifications';

interface Props {
  /** 强制刷新触发器 */
  refreshKey?: number;
}

export default function NotificationPanel({ refreshKey = 0 }: Props) {
  const [showPanel, setShowPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState<NotificationRecord[]>([]);
  const [settings, setSettings_] = useState<NotificationSettings>(getNotificationSettings());
  const [permGranted, setPermGranted] = useState(hasNotificationPermission());

  const loadData = useCallback(() => {
    setHistory(getNotificationHistory());
    setSettings_(getNotificationSettings());
    setPermGranted(hasNotificationPermission());
  }, []);

  useEffect(() => { loadData(); }, [refreshKey, loadData]);

  // 点击外部关闭面板
  useEffect(() => {
    if (!showPanel) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.notification-panel-wrapper')) setShowPanel(false);
    };
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [showPanel]);

  const unreadCount = history.filter(r => !r.read).length;

  const handleToggleEnabled = async () => {
    const newEnabled = !settings.enabled;
    if (newEnabled) {
      const granted = await requestNotificationPermission();
      setPermGranted(granted);
      if (!granted) {
        alert('请在浏览器设置中允许通知权限');
        return;
      }
    }
    const updated = { ...settings, enabled: newEnabled };
    setSettings_(updated);
    saveNotificationSettings(updated);
    if (newEnabled) startAutoScan();
    else stopAutoScan();
  };

  const handleIntervalChange = (val: number) => {
    const updated = { ...settings, intervalMinutes: val };
    setSettings_(updated);
    saveNotificationSettings(updated);
    restartAutoScan();
  };

  const handleScoreChange = (val: number) => {
    const updated = { ...settings, minScore: val };
    setSettings_(updated);
    saveNotificationSettings(updated);
  };

  const handleBreakoutScoreChange = (val: number) => {
    const updated = { ...settings, minBreakoutScore: val };
    setSettings_(updated);
    saveNotificationSettings(updated);
  };

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}小时前`;
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="notification-panel-wrapper" style={{ position: 'relative', display: 'inline-block' }}>
      {/* 铃铛按钮 */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowPanel(!showPanel); }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 18, position: 'relative', padding: '4px 8px',
          color: '#94a3b8',
        }}
        title="通知"
      >
        {settings.enabled ? '🔔' : '🔕'}
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 2,
            background: '#ef4444', color: '#fff',
            borderRadius: '50%', width: 16, height: 16,
            fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* 下拉面板 */}
      {showPanel && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 1000,
          width: 380, maxHeight: 480,
          background: '#1a1b23', border: '1px solid #2d2e3d',
          borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          {/* 面板头部 */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px', borderBottom: '1px solid #2d2e3d',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
              🔔 通知 {unreadCount > 0 && `(${unreadCount})`}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => { markAllNotificationsRead(); loadData(); }}
                style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 11 }}
              >全部已读</button>
              <button
                onClick={() => { clearNotificationHistory(); loadData(); }}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 11 }}
              >清空</button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: 0 }}
              >⚙️</button>
            </div>
          </div>

          {/* 设置面板 */}
          {showSettings && (
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #2d2e3d', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ color: '#94a3b8' }}>通知开关</span>
                <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, cursor: 'pointer' }}>
                  <input type="checkbox" checked={settings.enabled} onChange={handleToggleEnabled} style={{ display: 'none' }} />
                  <span style={{
                    position: 'absolute', inset: 0, borderRadius: 10,
                    background: settings.enabled ? '#22c55e' : '#475569',
                    transition: 'background 0.2s',
                  }}>
                    <span style={{
                      position: 'absolute', top: 2, left: settings.enabled ? 18 : 2,
                      width: 16, height: 16, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s',
                    }} />
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: '#94a3b8' }}>扫描间隔</span>
                <select
                  value={settings.intervalMinutes}
                  onChange={(e) => handleIntervalChange(Number(e.target.value))}
                  style={{ background: '#25263a', color: '#e2e8f0', border: '1px solid #2d2e3d', borderRadius: 4, padding: '2px 6px', fontSize: 11 }}
                >
                  <option value={60}>1 小时</option>
                  <option value={240}>4 小时</option>
                  <option value={480}>8 小时</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: '#94a3b8' }}>最低综合评分</span>
                <input type="number" value={settings.minScore} min={1} max={10} step={0.5}
                  onChange={(e) => handleScoreChange(Number(e.target.value))}
                  style={{ width: 50, background: '#25263a', color: '#e2e8f0', border: '1px solid #2d2e3d', borderRadius: 4, padding: '2px 6px', fontSize: 11, textAlign: 'center' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: '#94a3b8' }}>最低突破分</span>
                <input type="number" value={settings.minBreakoutScore} min={1} max={10} step={0.5}
                  onChange={(e) => handleBreakoutScoreChange(Number(e.target.value))}
                  style={{ width: 50, background: '#25263a', color: '#e2e8f0', border: '1px solid #2d2e3d', borderRadius: 4, padding: '2px 6px', fontSize: 11, textAlign: 'center' }} />
              </div>

              {!permGranted && settings.enabled && (
                <div style={{ color: '#f59e0b', fontSize: 10, marginTop: 4 }}>
                  ⚠️ 浏览器通知权限未开启，请允许通知
                </div>
              )}
            </div>
          )}

          {/* 通知列表 */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {history.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#475569', fontSize: 12 }}>
                暂无通知
                {settings.enabled
                  ? '\n启用后将在后台扫描蓄势突破'
                  : '\n请先开启通知并设置扫描间隔'}
              </div>
            ) : (
              [...history].reverse().slice(0, 30).map((r) => (
                <div
                  key={r.id}
                  onClick={() => { markNotificationRead(r.id); loadData(); }}
                  style={{
                    padding: '8px 14px',
                    borderBottom: '1px solid #2d2e3d',
                    cursor: 'pointer',
                    background: r.read ? 'transparent' : 'rgba(59,130,246,0.05)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                      {!r.read && <span style={{ color: '#3b82f6', marginRight: 4 }}>●</span>}
                      {r.title}
                    </span>
                    <span style={{ fontSize: 10, color: '#64748b' }}>{fmtTime(r.timestamp)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.body}</div>
                </div>
              ))
            )}
          </div>

          {/* 底部状态 */}
          <div style={{
            padding: '6px 14px', borderTop: '1px solid #2d2e3d',
            fontSize: 10, color: '#475569', textAlign: 'center',
          }}>
            {settings.enabled
              ? `⏱ 每 ${settings.intervalMinutes} 分钟自动扫描 | 最低评分 ≥ ${settings.minScore}`
              : '🔕 通知未启用'}
          </div>
        </div>
      )}
    </div>
  );
}
