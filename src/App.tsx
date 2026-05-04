import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Trades from './pages/Trades';
import NewTrade from './pages/NewTrade';
import TradeDetail from './pages/TradeDetail';
import Strategies from './pages/Strategies';
import Sync from './pages/Sync';
import StrategyLab from './pages/StrategyLab';
import MarketCapture from './pages/MarketCapture';
import TradingEngine from './pages/TradingEngine';
import AiReview from './pages/AiReview';
import { useEffect } from 'react';
import { initMockData, initDatabase } from './lib/db';
import { startAutoScan } from './lib/notifications';

function App() {
  useEffect(() => {
    initMockData(); // 初始化模拟数据
    initDatabase(); // 尝试验迁移到 IndexedDB（静默，失败不影响使用）
    startAutoScan(); // 启动通知扫描（如已启用配置）
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/trades/new" element={<NewTrade />} />
          <Route path="/trades/:id" element={<TradeDetail />} />
          <Route path="/strategies" element={<Strategies />} />
          <Route path="/sync" element={<Sync />} />
          <Route path="/strategy-lab" element={<StrategyLab />} />
          <Route path="/market-capture" element={<MarketCapture />} />
          <Route path="/trading-engine" element={<TradingEngine />} />
          <Route path="/ai-review" element={<AiReview />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
