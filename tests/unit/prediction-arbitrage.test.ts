import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { initDatabase, type Database } from '../../src/db/index';
import {
  PredictionArbitrageScanner,
  type MarketOrderbook,
  type RawPolymarketMarket,
} from '../../src/arbitrage/prediction-scanner';
import { PaperArbitrageExecutor } from '../../src/arbitrage/paper-executor';

describe('Prediction Market Mathematical Arbitrage Scanner', () => {
  const mockMarket: RawPolymarketMarket = {
    id: 'test_binary_001',
    conditionId: '0x123abc',
    question: 'Will Team Alpha win the championship?',
    slug: 'team-alpha-championship',
    active: true,
    closed: false,
    outcomes: JSON.stringify(['Yes', 'No']),
    clobTokenIds: JSON.stringify(['token_yes', 'token_no']),
  };

  it('should detect Dutch Book mispricing when sum of asks < 1.00', () => {
    const bookA: MarketOrderbook = {
      asks: [
        { price: 0.46, size: 150 },
        { price: 0.48, size: 200 },
      ],
      bids: [{ price: 0.44, size: 100 }],
    };

    const bookB: MarketOrderbook = {
      asks: [
        { price: 0.48, size: 150 },
        { price: 0.50, size: 200 },
      ],
      bids: [{ price: 0.46, size: 100 }],
    };

    // Top ask sum: 0.46 + 0.48 = 0.94 < 1.00 (Edge: 6.38%)
    const opp = PredictionArbitrageScanner.calculateDutchBookOpportunity(
      mockMarket,
      bookA,
      bookB,
      { maxBudget: 100, minProfitMargin: 0.01 }
    );

    assert.ok(opp !== null, 'Opportunity should be detected');
    assert.strictEqual(opp.type, 'binary_dutch_book');
    assert.strictEqual(opp.legs.length, 2);
    assert.strictEqual(opp.topAskSum, 0.94);
    assert.ok(opp.vwapAskSum < 1.0, 'VWAP ask sum must be < 1.00');
    assert.ok(opp.guaranteedPayout > opp.totalCost, 'Payout must exceed cost');
    assert.ok(opp.netProfit > 0, 'Net profit must be positive');
    assert.strictEqual(opp.legs[0].shares, opp.legs[1].shares, 'Both legs must have equal shares');
  });

  it('should reject markets where sum of asks >= 1.00', () => {
    const bookA: MarketOrderbook = {
      asks: [{ price: 0.52, size: 100 }],
      bids: [{ price: 0.50, size: 100 }],
    };

    const bookB: MarketOrderbook = {
      asks: [{ price: 0.51, size: 100 }],
      bids: [{ price: 0.49, size: 100 }],
    };

    const opp = PredictionArbitrageScanner.calculateDutchBookOpportunity(
      mockMarket,
      bookA,
      bookB,
      { maxBudget: 100, minProfitMargin: 0.001 }
    );

    assert.strictEqual(opp, null, 'Should not detect arb when askSum >= 1.00');
  });

  it('should stop depth walking when deeper orderbook levels exceed profit margin', () => {
    const bookA: MarketOrderbook = {
      asks: [
        { price: 0.45, size: 10 }, // 10 shares @ 0.45
        { price: 0.60, size: 500 }, // Slippage jumps high!
      ],
      bids: [{ price: 0.40, size: 10 }],
    };

    const bookB: MarketOrderbook = {
      asks: [
        { price: 0.45, size: 10 }, // 10 shares @ 0.45
        { price: 0.60, size: 500 },
      ],
      bids: [{ price: 0.40, size: 10 }],
    };

    const opp = PredictionArbitrageScanner.calculateDutchBookOpportunity(
      mockMarket,
      bookA,
      bookB,
      { maxBudget: 100, minProfitMargin: 0.01 }
    );

    assert.ok(opp !== null, 'Should capture the 10 shares');
    // Only 10 shares are profitable (0.45 + 0.45 = 0.90 < 1.00)
    // The next level (0.60 + 0.60 = 1.20) must be discarded!
    assert.strictEqual(opp.executableShares, 10);
    assert.strictEqual(opp.totalCost, 9.0); // 10 * 0.45 + 10 * 0.45 = 9.00
    assert.strictEqual(opp.guaranteedPayout, 10.0); // 10 * 1.00 = 10.00
    assert.strictEqual(opp.netProfit, 1.0); // 10.00 - 9.00 = 1.00
  });
});

describe('Paper Trading Arbitrage Execution & Settlement', () => {
  let db: Database;
  let executor: PaperArbitrageExecutor;
  const testUserId = 'test_user_suite_' + Date.now();

  beforeEach(async () => {
    db = await initDatabase();
    executor = new PaperArbitrageExecutor(db);
    await executor.resetAccount(testUserId, 10000);
  });

  it('should initialize paper account with virtual balance', async () => {
    const account = await executor.getAccount(testUserId);
    assert.strictEqual(account.balance, 10000);
    assert.strictEqual(account.startingBalance, 10000);
    assert.strictEqual(account.openArbitrages, 0);
  });

  it('should execute paper trade, deduct balance, and lock guaranteed profit', async () => {
    const mockMarket: RawPolymarketMarket = {
      id: 'suite_market_01',
      question: 'Test Market Execution',
      active: true,
      closed: false,
      outcomes: JSON.stringify(['Yes', 'No']),
      clobTokenIds: JSON.stringify(['tok1', 'tok2']),
    };

    const bookA: MarketOrderbook = { asks: [{ price: 0.45, size: 100 }], bids: [] };
    const bookB: MarketOrderbook = { asks: [{ price: 0.48, size: 100 }], bids: [] };

    const opp = PredictionArbitrageScanner.calculateDutchBookOpportunity(
      mockMarket,
      bookA,
      bookB,
      { maxBudget: 93, minProfitMargin: 0.01 }
    );

    assert.ok(opp !== null);
    const result = await executor.executeOpportunity(opp, testUserId);
    assert.strictEqual(result.success, true);
    assert.ok(result.record !== undefined);

    const accountAfter = await executor.getAccount(testUserId);
    assert.ok(accountAfter.balance < 10000, 'Cash balance should be deducted');
    assert.strictEqual(accountAfter.openArbitrages, 1);
    assert.ok(accountAfter.unrealizedLockedProfit > 0, 'Unrealized locked profit should be positive');

    // Simulate resolution and settlement
    const settleResult = await executor.simulateSettlement(result.record!.id, 0, testUserId);
    assert.strictEqual(settleResult.success, true);
    assert.ok(settleResult.payout! > opp.totalCost, 'Settlement payout must exceed cost');

    const accountFinal = await executor.getAccount(testUserId);
    assert.ok(accountFinal.balance > 10000, 'Final cash balance should exceed initial balance');
    assert.strictEqual(accountFinal.openArbitrages, 0);
    assert.strictEqual(accountFinal.settledArbitrages, 1);
    assert.strictEqual(accountFinal.unrealizedLockedProfit, 0);
    assert.ok(accountFinal.totalPnl > 0, 'Total PnL must be positive');
  });

  it('should reject execution if paper balance is insufficient', async () => {
    // Drain balance
    db.run('UPDATE paper_trading_settings SET balance = 5 WHERE user_id = ?', [testUserId]);

    const mockMarket: RawPolymarketMarket = {
      id: 'suite_market_02',
      question: 'Test Market Low Funds',
      active: true,
      closed: false,
      outcomes: JSON.stringify(['Yes', 'No']),
      clobTokenIds: JSON.stringify(['tok1', 'tok2']),
    };

    const bookA: MarketOrderbook = { asks: [{ price: 0.45, size: 100 }], bids: [] };
    const bookB: MarketOrderbook = { asks: [{ price: 0.48, size: 100 }], bids: [] };

    const opp = PredictionArbitrageScanner.calculateDutchBookOpportunity(
      mockMarket,
      bookA,
      bookB,
      { maxBudget: 50, minProfitMargin: 0.01 }
    );

    assert.ok(opp !== null);
    const result = await executor.executeOpportunity(opp, testUserId);
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('Insufficient paper balance'));
  });
});
