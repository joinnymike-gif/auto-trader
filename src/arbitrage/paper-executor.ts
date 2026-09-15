/**
 * Paper Trading Arbitrage Execution & Settlement Engine
 *
 * Executes risk-free mathematical arbitrage trades in a simulated environment
 * backed by the local SQLite database.
 *
 * Features:
 * - 100% risk-free virtual balance ($10,000 default)
 * - Atomic leg execution (buys both YES and NO simultaneously)
 * - Records positions and trades in native Clodds paper trading tables
 * - Locks in guaranteed profit calculation
 * - Supports simulated market settlement and PnL realization
 */

import type { Database } from '../db/index';
import { logger } from '../utils/logger';
import type { PredictionArbOpportunity } from './prediction-scanner';

export interface PaperAccountSummary {
  userId: string;
  balance: number;
  startingBalance: number;
  unrealizedLockedProfit: number;
  totalPnl: number;
  totalPnlPct: number;
  openArbitrages: number;
  settledArbitrages: number;
}

export interface PaperArbitrageRecord {
  id: string;
  userId: string;
  marketId: string;
  question: string;
  type: string;
  legs: Array<{
    outcome: string;
    tokenId: string;
    shares: number;
    price: number;
    cost: number;
  }>;
  shares: number;
  totalCost: number;
  guaranteedPayout: number;
  lockedProfit: number;
  roiPct: number;
  status: 'open' | 'settled';
  winningOutcome?: string;
  createdAt: string;
  settledAt?: string;
}

export class PaperArbitrageExecutor {
  private db: Database;
  private defaultUserId = 'default_user';

  constructor(db: Database) {
    this.db = db;
    this.initTables();
  }

  private initTables(): void {
    // Ensure users table has default user
    const nowEpoch = Math.floor(Date.now() / 1000);
    this.db.run(`
      INSERT OR IGNORE INTO users (id, platform, platform_user_id, username, created_at, last_active_at)
      VALUES ('default_user', 'cli', 'default_user', 'Local Trader', ${nowEpoch}, ${nowEpoch})
    `);

    // Ensure paper trading settings table exists and default user is initialized
    this.db.run(`
      CREATE TABLE IF NOT EXISTS paper_trading_settings (
        user_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        balance REAL NOT NULL DEFAULT 10000,
        starting_balance REAL NOT NULL DEFAULT 10000,
        created_at TEXT NOT NULL
      )
    `);

    this.db.run(`
      INSERT OR IGNORE INTO paper_trading_settings (user_id, enabled, balance, starting_balance, created_at)
      VALUES ('default_user', 1, 10000, 10000, datetime('now'))
    `);

    // Create specialized arbitrage records table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS paper_arbitrage_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        market_id TEXT NOT NULL,
        question TEXT NOT NULL,
        type TEXT NOT NULL,
        legs_json TEXT NOT NULL,
        shares REAL NOT NULL,
        total_cost REAL NOT NULL,
        guaranteed_payout REAL NOT NULL,
        locked_profit REAL NOT NULL,
        roi_pct REAL NOT NULL,
        status TEXT NOT NULL,
        winning_outcome TEXT,
        created_at TEXT NOT NULL,
        settled_at TEXT
      )
    `);
  }

  /**
   * Get virtual account balance and stats
   */
  async getAccount(userId?: string): Promise<PaperAccountSummary> {
    const uid = userId || this.defaultUserId;

    // Ensure settings record exists
    let settings = this.db.query<{ balance: number; starting_balance: number }>(
      'SELECT balance, starting_balance FROM paper_trading_settings WHERE user_id = ?',
      [uid]
    )[0];

    if (!settings) {
      this.db.run(`
        INSERT INTO paper_trading_settings (user_id, enabled, balance, starting_balance, created_at)
        VALUES (?, 1, 10000, 10000, datetime('now'))
      `, [uid]);
      settings = { balance: 10000, starting_balance: 10000 };
    }

    const openArbs = this.db.query<{
      total_invested: number;
      total_payout: number;
      total_locked: number;
      count: number;
    }>(
      `SELECT COALESCE(SUM(total_cost), 0) as total_invested,
              COALESCE(SUM(guaranteed_payout), 0) as total_payout,
              COALESCE(SUM(locked_profit), 0) as total_locked,
              COUNT(*) as count
       FROM paper_arbitrage_records WHERE user_id = ? AND status = 'open'`,
      [uid]
    )[0];

    const settledArbs = this.db.query<{ total_realized: number; count: number }>(
      `SELECT COALESCE(SUM(locked_profit), 0) as total_realized, COUNT(*) as count
       FROM paper_arbitrage_records WHERE user_id = ? AND status = 'settled'`,
      [uid]
    )[0];

    const balance = settings.balance;
    const startingBalance = settings.starting_balance;
    const unrealizedLockedProfit = openArbs?.total_locked || 0;
    // Total portfolio value = cash + expected payout from guaranteed open arbitrage legs
    const portfolioValue = balance + (openArbs?.total_payout || 0);
    const totalPnl = portfolioValue - startingBalance;
    const totalPnlPct = startingBalance > 0 ? (totalPnl / startingBalance) * 100 : 0;

    return {
      userId: uid,
      balance,
      startingBalance,
      unrealizedLockedProfit,
      totalPnl,
      totalPnlPct,
      openArbitrages: openArbs?.count || 0,
      settledArbitrages: settledArbs?.count || 0,
    };
  }

  /**
   * Execute an arbitrage opportunity in the paper trading account
   */
  async executeOpportunity(
    opp: PredictionArbOpportunity,
    userId?: string
  ): Promise<{
    success: boolean;
    record?: PaperArbitrageRecord;
    error?: string;
  }> {
    const uid = userId || this.defaultUserId;
    const account = await this.getAccount(uid);

    if (account.balance < opp.totalCost) {
      return {
        success: false,
        error: `Insufficient paper balance: $${account.balance.toFixed(2)} available, $${opp.totalCost.toFixed(2)} required.`,
      };
    }

    const recordId = `parb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const legsData = opp.legs.map((leg) => ({
      outcome: leg.outcome,
      tokenId: leg.tokenId,
      shares: leg.shares,
      price: leg.vwapAsk,
      cost: leg.cost,
    }));

    // Deduct cost from virtual balance
    this.db.run(
      'UPDATE paper_trading_settings SET balance = balance - ? WHERE user_id = ?',
      [opp.totalCost, uid]
    );

    // Record each leg into standard paper_positions and paper_trades
    for (const leg of opp.legs) {
      this.db.run(
        `INSERT INTO paper_positions (user_id, market_id, market_name, side, size, entry_price, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [uid, `${opp.marketId}:${leg.outcome}`, `${opp.question} [${leg.outcome}]`, 'BUY', leg.shares, leg.vwapAsk]
      );

      this.db.run(
        `INSERT INTO paper_trades (user_id, market_id, market_name, side, size, price, pnl, created_at)
         VALUES (?, ?, ?, 'BUY', ?, ?, 0, datetime('now'))`,
        [uid, `${opp.marketId}:${leg.outcome}`, `${opp.question} [${leg.outcome}]`, leg.shares, leg.vwapAsk]
      );
    }

    // Insert into paper_arbitrage_records
    this.db.run(
      `INSERT INTO paper_arbitrage_records
       (id, user_id, market_id, question, type, legs_json, shares, total_cost,
        guaranteed_payout, locked_profit, roi_pct, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))`,
      [
        recordId,
        uid,
        opp.marketId,
        opp.question,
        opp.type,
        JSON.stringify(legsData),
        opp.executableShares,
        opp.totalCost,
        opp.guaranteedPayout,
        opp.netProfit,
        opp.roiPct,
      ]
    );

    logger.info(
      {
        recordId,
        question: opp.question,
        cost: opp.totalCost,
        lockedProfit: opp.netProfit,
        roiPct: opp.roiPct,
      },
      'Paper arbitrage executed'
    );

    const record: PaperArbitrageRecord = {
      id: recordId,
      userId: uid,
      marketId: opp.marketId,
      question: opp.question,
      type: opp.type,
      legs: legsData,
      shares: opp.executableShares,
      totalCost: opp.totalCost,
      guaranteedPayout: opp.guaranteedPayout,
      lockedProfit: opp.netProfit,
      roiPct: opp.roiPct,
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    return { success: true, record };
  }

  /**
   * Simulate resolution of an open arbitrage position.
   *
   * Prediction markets guarantee that one of the mutually exclusive outcomes pays $1.00 per share.
   * Since we hold equal shares of all outcomes, guaranteed payout = shares * $1.00.
   */
  async simulateSettlement(
    recordId: string,
    winningOutcomeIndex = 0,
    userId?: string
  ): Promise<{
    success: boolean;
    record?: PaperArbitrageRecord;
    payout?: number;
    netProfit?: number;
    error?: string;
  }> {
    const uid = userId || this.defaultUserId;

    const row = this.db.query<{
      id: string;
      user_id: string;
      market_id: string;
      question: string;
      type: string;
      legs_json: string;
      shares: number;
      total_cost: number;
      guaranteed_payout: number;
      locked_profit: number;
      roi_pct: number;
      status: string;
      created_at: string;
    }>(
      'SELECT * FROM paper_arbitrage_records WHERE id = ? AND user_id = ?',
      [recordId, uid]
    )[0];

    if (!row) {
      return { success: false, error: `Arbitrage record not found: ${recordId}` };
    }

    if (row.status === 'settled') {
      return { success: false, error: `Arbitrage record is already settled: ${recordId}` };
    }

    const legs = JSON.parse(row.legs_json) as Array<{
      outcome: string;
      tokenId: string;
      shares: number;
      price: number;
      cost: number;
    }>;

    const winningLeg = legs[winningOutcomeIndex] || legs[0];
    const payout = row.shares * 1.0; // $1.00 per winning share
    const netProfit = payout - row.total_cost;

    // Credit payout to virtual balance
    this.db.run(
      'UPDATE paper_trading_settings SET balance = balance + ? WHERE user_id = ?',
      [payout, uid]
    );

    // Update arbitrage record
    this.db.run(
      `UPDATE paper_arbitrage_records
       SET status = 'settled', winning_outcome = ?, settled_at = datetime('now')
       WHERE id = ?`,
      [winningLeg.outcome, recordId]
    );

    // Remove open positions for this market
    for (const leg of legs) {
      this.db.run(
        'DELETE FROM paper_positions WHERE user_id = ? AND market_id = ?',
        [uid, `${row.market_id}:${leg.outcome}`]
      );
    }

    // Record settlement trades
    this.db.run(
      `INSERT INTO paper_trades (user_id, market_id, market_name, side, size, price, pnl, created_at)
       VALUES (?, ?, ?, 'SETTLE', ?, 1.0, ?, datetime('now'))`,
      [
        uid,
        `${row.market_id}:${winningLeg.outcome}`,
        `[SETTLED] ${row.question} (Winner: ${winningLeg.outcome})`,
        row.shares,
        netProfit,
      ]
    );

    logger.info(
      { recordId, winningOutcome: winningLeg.outcome, payout, netProfit },
      'Paper arbitrage settled'
    );

    return {
      success: true,
      payout,
      netProfit,
      record: {
        id: row.id,
        userId: row.user_id,
        marketId: row.market_id,
        question: row.question,
        type: row.type,
        legs,
        shares: row.shares,
        totalCost: row.total_cost,
        guaranteedPayout: row.guaranteed_payout,
        lockedProfit: row.locked_profit,
        roiPct: row.roi_pct,
        status: 'settled',
        winningOutcome: winningLeg.outcome,
        createdAt: row.created_at,
        settledAt: new Date().toISOString(),
      },
    };
  }

  /**
   * List open or historical paper arbitrage records
   */
  async listRecords(options?: {
    status?: 'open' | 'settled';
    limit?: number;
    userId?: string;
  }): Promise<PaperArbitrageRecord[]> {
    const uid = options?.userId || this.defaultUserId;
    const limit = options?.limit || 50;

    let sql = 'SELECT * FROM paper_arbitrage_records WHERE user_id = ?';
    const params: (string | number)[] = [uid];

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.query<{
      id: string;
      user_id: string;
      market_id: string;
      question: string;
      type: string;
      legs_json: string;
      shares: number;
      total_cost: number;
      guaranteed_payout: number;
      locked_profit: number;
      roi_pct: number;
      status: 'open' | 'settled';
      winning_outcome?: string;
      created_at: string;
      settled_at?: string;
    }>(sql, params);

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      marketId: r.market_id,
      question: r.question,
      type: r.type,
      legs: JSON.parse(r.legs_json),
      shares: r.shares,
      totalCost: r.total_cost,
      guaranteedPayout: r.guaranteed_payout,
      lockedProfit: r.locked_profit,
      roiPct: r.roi_pct,
      status: r.status,
      winningOutcome: r.winning_outcome,
      createdAt: r.created_at,
      settledAt: r.settled_at,
    }));
  }

  /**
   * Reset virtual paper trading account
   */
  async resetAccount(userId?: string, startingBalance = 10000): Promise<void> {
    const uid = userId || this.defaultUserId;
    this.db.run('DELETE FROM paper_arbitrage_records WHERE user_id = ?', [uid]);
    this.db.run('DELETE FROM paper_positions WHERE user_id = ?', [uid]);
    this.db.run('DELETE FROM paper_trades WHERE user_id = ?', [uid]);
    this.db.run(
      'UPDATE paper_trading_settings SET balance = ?, starting_balance = ?, enabled = 1 WHERE user_id = ?',
      [startingBalance, startingBalance, uid]
    );
  }
}
