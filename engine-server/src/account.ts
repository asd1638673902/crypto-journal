/**
 * 账户管理 — 余额、持仓、历史
 */
import { readTable, writeTable, appendToTable } from './db.js';

export interface AccountState {
  initialBalance: number;
  currentBalance: number;
  availableBalance: number;
  usedMargin: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalFeesPaid: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
}

export interface Position {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  leverage: number;
  margin: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  stopLoss: number;
  takeProfit: number[];
  openTime: string;
}

export interface AccountEntry {
  timestamp: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
}

const TAKER_FEE = 0.0004;

let _idCounter = 0;
function genId(): string {
  _idCounter++;
  return `pos-${Date.now().toString(36)}-${_idCounter}`;
}

export function initAccount(balance: number = 10000): AccountState {
  const account: AccountState = {
    initialBalance: balance,
    currentBalance: balance,
    availableBalance: balance,
    usedMargin: 0,
    unrealizedPnl: 0,
    totalPnl: 0,
    totalFeesPaid: 0,
    totalTrades: 0,
    winCount: 0,
    lossCount: 0,
  };
  writeTable('account', [account]);
  writeTable('positions', []);
  writeTable('account_history', []);
  addHistory('DEPOSIT', balance, `初始入金 ${balance} USDT`);
  return account;
}

export function getAccount(): AccountState {
  const data = readTable<AccountState>('account');
  if (data.length === 0) return initAccount();
  return data[0];
}

function saveAccount(account: AccountState): void {
  writeTable('account', [account]);
}

export function getPositions(): Position[] {
  return readTable<Position>('positions');
}

function savePositions(positions: Position[]): void {
  writeTable('positions', positions);
}

export function getHistory(): AccountEntry[] {
  return readTable<AccountEntry>('account_history');
}

function addHistory(type: string, amount: number, desc: string): void {
  const entry: AccountEntry = {
    timestamp: new Date().toISOString(),
    type,
    amount: Math.round(amount * 100) / 100,
    balanceAfter: getAccount().currentBalance,
    description: desc,
  };
  const data = readTable<AccountEntry>('account_history');
  data.unshift(entry);
  if (data.length > 500) data.splice(500);
  writeTable('account_history', data);
}

export function openPosition(params: {
  symbol: string; direction: 'LONG' | 'SHORT'; entryPrice: number;
  quantity: number; leverage: number; stopLoss: number; takeProfit: number[];
}): { position: Position; fee: number } | null {
  const account = getAccount();
  const positionValue = params.entryPrice * params.quantity;
  const margin = positionValue / params.leverage;
  const fee = positionValue * TAKER_FEE;

  if (account.availableBalance < margin + fee) return null;

  const liqPrice = params.direction === 'LONG'
    ? params.entryPrice * (1 - 1 / params.leverage + 0.005)
    : params.entryPrice * (1 + 1 / params.leverage - 0.005);

  const position: Position = {
    id: genId(),
    symbol: params.symbol,
    direction: params.direction,
    entryPrice: params.entryPrice,
    currentPrice: params.entryPrice,
    quantity: params.quantity,
    leverage: params.leverage,
    margin: Math.round(margin * 100) / 100,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    stopLoss: params.stopLoss,
    takeProfit: params.takeProfit,
    openTime: new Date().toISOString(),
  };

  const positions = getPositions();
  positions.push(position);
  savePositions(positions);

  account.usedMargin += margin;
  account.availableBalance -= (margin + fee);
  account.totalFeesPaid += fee;
  account.totalTrades++;
  saveAccount(account);

  addHistory('FEE', -fee, `${params.symbol} 开仓手续费`);
  addHistory('TRADE_OPEN', -margin, `开仓 ${params.symbol} ${params.direction} @ ${params.entryPrice} (${params.leverage}x)`);

  return { position, fee };
}

export function closePosition(positionId: string, exitPrice: number): {
  pnl: number; fee: number; isWin: boolean;
} | null {
  const positions = getPositions();
  const idx = positions.findIndex(p => p.id === positionId);
  if (idx === -1) return null;

  const pos = positions[idx];
  const positionValue = exitPrice * pos.quantity;
  const fee = positionValue * TAKER_FEE;
  const priceDiff = pos.direction === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
  const pnl = priceDiff * pos.quantity - fee;
  const account = getAccount();

  account.usedMargin -= pos.margin;
  account.currentBalance += pnl;
  account.totalPnl += pnl;
  account.totalFeesPaid += fee;
  if (pnl > 0) account.winCount++;
  else account.lossCount++;
  account.availableBalance = account.currentBalance - account.usedMargin;
  saveAccount(account);

  positions.splice(idx, 1);
  savePositions(positions);

  addHistory('REALIZED_PNL', pnl, `平仓 ${pos.symbol} @ ${exitPrice} PnL=${pnl.toFixed(2)}`);
  addHistory('FEE', -fee, `平仓手续费`);

  return { pnl: Math.round(pnl * 100) / 100, fee, isWin: pnl > 0 };
}

export function updatePositionsPrices(prices: Record<string, number>): void {
  const positions = getPositions();
  if (positions.length === 0) return;
  for (const pos of positions) {
    const price = prices[pos.symbol];
    if (!price) continue;
    pos.currentPrice = price;
    const diff = pos.direction === 'LONG' ? price - pos.entryPrice : pos.entryPrice - price;
    pos.unrealizedPnl = Math.round(diff * pos.quantity * 100) / 100;
    pos.unrealizedPnlPercent = pos.margin > 0 ? Math.round((pos.unrealizedPnl / pos.margin) * 10000) / 100 : 0;
  }
  savePositions(positions);
  const totalUPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const account = getAccount();
  account.unrealizedPnl = totalUPnl;
  account.currentBalance = account.initialBalance + account.totalPnl + totalUPnl;
  account.availableBalance = account.currentBalance - account.usedMargin;
  saveAccount(account);
}
