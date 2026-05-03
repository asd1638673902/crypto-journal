import { NavLink, Outlet } from 'react-router-dom';
import { getApiKey } from '../../lib/exchange';
import { getSyncLogs, getTrades } from '../../lib/db';
import './Layout.css';

function Layout() {
  const hasApiKey = !!getApiKey();
  const syncLogs = getSyncLogs();
  const allTrades = getTrades();

  const lastSuccessfulSync = syncLogs
    .filter((l) => l.status === 'success' || l.status === 'partial')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const totalSynced = allTrades.filter(
    (t) => t.exchange === 'binance' && t.orderId && !t.orderId.startsWith('mock'),
  ).length;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">CryptoJournal</span>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            <span className="nav-icon">📊</span>
            仪表盘
          </NavLink>
          <NavLink to="/trades" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            <span className="nav-icon">📋</span>
            交易记录
          </NavLink>
          <NavLink to="/strategies" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            <span className="nav-icon">🎯</span>
            策略管理
          </NavLink>
          <NavLink to="/sync" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            <span className="nav-icon">🔄</span>
            交易所同步
          </NavLink>
          <NavLink to="/strategy-lab" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            <span className="nav-icon">🧪</span>
            策略实验室
          </NavLink>
          <NavLink to="/market-capture" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            <span className="nav-icon">🎯</span>
            市场捕捉
          </NavLink>
          <NavLink to="/ai-review" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            <span className="nav-icon">🤖</span>
            AI复盘助理
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className={`sync-status ${hasApiKey ? 'connected' : ''}`}>
            {hasApiKey ? (
              <>
                <span className="status-dot connected" />
                <div className="sync-status-text">
                  <span>币安已连接</span>
                  {totalSynced > 0 && <span className="sync-count">{totalSynced} 笔</span>}
                  {lastSuccessfulSync && (
                    <span className="sync-time">
                      {new Date(lastSuccessfulSync.createdAt).toLocaleDateString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                      })}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <span className="status-dot" />
                未连接交易所
              </>
            )}
          </div>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
