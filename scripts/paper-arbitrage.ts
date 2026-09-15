#!/usr/bin/env tsx
/**
 * Prediction Market Mathematical Arbitrage CLI Runner
 *
 * Runs the zero-token mathematical arbitrage scanner and paper trading execution engine.
 *
 * Usage:
 *   npx tsx scripts/paper-arbitrage.ts --once
 *   npx tsx scripts/paper-arbitrage.ts --watch --interval 10
 *   npx tsx scripts/paper-arbitrage.ts --test
 *   npx tsx scripts/paper-arbitrage.ts --status
 *   npx tsx scripts/paper-arbitrage.ts --reset
 */

import { initDatabase } from '../src/db/index';
import { PredictionArbitrageScanner, type PredictionArbOpportunity } from '../src/arbitrage/prediction-scanner';
import { PaperArbitrageExecutor } from '../src/arbitrage/paper-executor';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    once: false,
    watch: false,
    test: false,
    status: false,
    reset: false,
    dryRun: false,
    size: 100, // default $100 per arb
    minProfit: 0.1, // default 0.1% edge
    interval: 10, // seconds
    settleId: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--once') options.once = true;
    else if (arg === '--watch') options.watch = true;
    else if (arg === '--test') options.test = true;
    else if (arg === '--status') options.status = true;
    else if (arg === '--reset') options.reset = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--size' && args[i + 1]) options.size = Number.parseFloat(args[++i]);
    else if (arg === '--min-profit' && args[i + 1]) options.minProfit = Number.parseFloat(args[++i]);
    else if (arg === '--interval' && args[i + 1]) options.interval = Number.parseInt(args[++i], 10);
    else if (arg === '--settle' && args[i + 1]) options.settleId = args[++i];
  }

  // Default to --once if no action specified
  if (!options.watch && !options.test && !options.status && !options.reset && !options.settleId) {
    options.once = true;
  }

  return options;
}

function formatCurrency(val: number): string {
  return `$${val.toFixed(2)}`;
}

async function printStatus(executor: PaperArbitrageExecutor) {
  const account = await executor.getAccount();
  const openRecords = await executor.listRecords({ status: 'open' });
  const settledRecords = await executor.listRecords({ status: 'settled', limit: 5 });

  console.log('\n======================================================');
  console.log('       📊 PAPER TRADING ARBITRAGE ACCOUNT STATUS      ');
  console.log('======================================================');
  console.log(`Virtual Balance:        ${formatCurrency(account.balance)} (Cash available)`);
  console.log(`Starting Balance:       ${formatCurrency(account.startingBalance)}`);
  console.log(`Unrealized Locked PnL:  ${formatCurrency(account.unrealizedLockedProfit)}`);
  console.log(`Open Arbitrage Pairs:   ${account.openArbitrages}`);
  console.log(`Settled Arbitrages:     ${account.settledArbitrages}`);
  console.log(`Total Return:           ${formatCurrency(account.totalPnl)} (${account.totalPnlPct.toFixed(2)}%)`);
  console.log('------------------------------------------------------');

  if (openRecords.length > 0) {
    console.log('\n🔵 ACTIVE LOCKED ARBITRAGE POSITIONS:');
    for (const r of openRecords) {
      console.log(`• [${r.id}] ${r.question.slice(0, 50)}...`);
      console.log(`  Cost: ${formatCurrency(r.totalCost)} | Payout: ${formatCurrency(r.guaranteedPayout)} | Locked Profit: +${formatCurrency(r.lockedProfit)} (${r.roiPct.toFixed(2)}%)`);
      console.log(`  Legs: ${r.legs.map((l) => `${l.outcome} @ $${l.price.toFixed(3)} (${l.shares.toFixed(1)} shares)`).join(' + ')}`);
    }
  }

  if (settledRecords.length > 0) {
    console.log('\n🟢 RECENTLY SETTLED ARBITRAGES:');
    for (const r of settledRecords) {
      console.log(`• [${r.id}] ${r.question.slice(0, 50)}...`);
      console.log(`  Winner: ${r.winningOutcome} | Realized Profit: +${formatCurrency(r.lockedProfit)} (${r.roiPct.toFixed(2)}%)`);
    }
  }
  console.log('======================================================\n');
}

async function runTest(executor: PaperArbitrageExecutor) {
  console.log('\n🧪 ======================================================');
  console.log('       RUNNING ARBITRAGE PAPER TRADING VERIFICATION      ');
  console.log('======================================================\n');

  console.log('1. Checking initial virtual balance...');
  const initAccount = await executor.getAccount();
  console.log(`   Initial Cash: ${formatCurrency(initAccount.balance)}`);

  // Create a realistic simulated Dutch Book arbitrage opportunity
  // YES ask = 0.48, NO ask = 0.49 -> Sum = 0.97 (3.09% guaranteed ROI)
  const mockMarket = {
    id: 'sim_market_001',
    conditionId: '0xmockcondition001',
    question: 'Will Human Level AI be confirmed before 2027?',
    slug: 'human-level-ai-2027',
    active: true,
    closed: false,
    outcomes: JSON.stringify(['Yes', 'No']),
    clobTokenIds: JSON.stringify(['mock_token_yes', 'mock_token_no']),
  };

  const mockBookA = {
    asks: [
      { price: 0.48, size: 200 },
      { price: 0.49, size: 500 },
    ],
    bids: [{ price: 0.46, size: 100 }],
  };

  const mockBookB = {
    asks: [
      { price: 0.49, size: 200 },
      { price: 0.50, size: 400 },
    ],
    bids: [{ price: 0.47, size: 100 }],
  };

  console.log('\n2. Calculating Dutch Book opportunity from simulated orderbooks...');
  console.log(`   YES Best Ask: $0.48 (200 shares)`);
  console.log(`   NO  Best Ask: $0.49 (200 shares)`);
  console.log(`   Combined Ask Sum: $0.97 (< $1.00 -> Mathematical Arbitrage Edge: 3.09%)`);

  const opp = PredictionArbitrageScanner.calculateDutchBookOpportunity(
    mockMarket,
    mockBookA,
    mockBookB,
    { maxBudget: 100, minProfitMargin: 0.005 }
  );

  if (!opp) {
    console.error('❌ Failed to calculate simulated Dutch Book opportunity');
    return;
  }

  console.log(`   ✅ Opportunity identified:`);
  console.log(`      Executable Shares: ${opp.executableShares.toFixed(2)} YES + ${opp.executableShares.toFixed(2)} NO`);
  console.log(`      Total Cost: ${formatCurrency(opp.totalCost)}`);
  console.log(`      Guaranteed Payout: ${formatCurrency(opp.guaranteedPayout)}`);
  console.log(`      Guaranteed Net Profit: +${formatCurrency(opp.netProfit)} (${opp.roiPct.toFixed(2)}% ROI)`);

  console.log('\n3. Executing paper trade order...');
  const execResult = await executor.executeOpportunity(opp);
  if (!execResult.success || !execResult.record) {
    console.error(`❌ Execution failed: ${execResult.error}`);
    return;
  }

  console.log(`   ✅ Paper trade successfully placed! Record ID: ${execResult.record.id}`);
  const postExecAccount = await executor.getAccount();
  console.log(`   Remaining Cash: ${formatCurrency(postExecAccount.balance)}`);
  console.log(`   Unrealized Locked Profit: +${formatCurrency(postExecAccount.unrealizedLockedProfit)}`);

  console.log('\n4. Simulating event resolution & settlement...');
  console.log('   Scenario: The event resolves to "Yes" ($1.00 payout per Yes share, $0.00 for No).');
  const settleResult = await executor.simulateSettlement(execResult.record.id, 0);

  if (!settleResult.success) {
    console.error(`❌ Settlement failed: ${settleResult.error}`);
    return;
  }

  console.log(`   ✅ Position settled! Payout received: ${formatCurrency(settleResult.payout!)}`);
  console.log(`   Realized Net Profit: +${formatCurrency(settleResult.netProfit!)}`);

  const finalAccount = await executor.getAccount();
  console.log(`   Final Cash Balance: ${formatCurrency(finalAccount.balance)}`);
  console.log(`   Total Account PnL: ${formatCurrency(finalAccount.totalPnl)}`);

  console.log('\n🎉 ALL MATHEMATICAL ARBITRAGE & PAPER TRADING TESTS PASSED!\n');
}

async function runScan(scanner: PredictionArbitrageScanner, executor: PaperArbitrageExecutor, options: {
  size: number;
  minProfit: number;
  dryRun: boolean;
}) {
  const startTime = Date.now();
  process.stdout.write('🔍 Scanning live Polymarket markets for mathematical Dutch Book mispricings...\r');

  const opps = await scanner.scanMarkets(50);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n✅ Scan completed in ${elapsed}s across active markets.`);

  if (opps.length === 0) {
    console.log('ℹ️  No active Dutch Book opportunities (Sum of Asks < 1.00) found at this moment.');
    console.log('   (Markets are currently efficiently priced by market makers. Run with --watch to monitor continuously.)\n');
    return;
  }

  console.log(`\n🔥 Found ${opps.length} Mathematical Arbitrage Opportunities:`);
  for (const opp of opps) {
    console.log('------------------------------------------------------');
    console.log(`Market: ${opp.question}`);
    console.log(`Top Asks Sum: $${opp.topAskSum.toFixed(4)} | Executable VWAP Sum: $${opp.vwapAskSum.toFixed(4)}`);
    console.log(`Position Size: ${opp.executableShares.toFixed(1)} shares per leg`);
    console.log(`Total Capital: ${formatCurrency(opp.totalCost)} -> Guaranteed Payout: ${formatCurrency(opp.guaranteedPayout)}`);
    console.log(`Locked Net Profit: +${formatCurrency(opp.netProfit)} (${opp.roiPct.toFixed(2)}% ROI)`);

    if (!options.dryRun) {
      const res = await executor.executeOpportunity(opp);
      if (res.success) {
        console.log(`🚀 [EXECUTED SIMULATED ARBITRAGE] Record ID: ${res.record?.id}`);
      } else {
        console.log(`⚠️  Execution skipped: ${res.error}`);
      }
    }
  }
  console.log('------------------------------------------------------\n');
}

async function main() {
  const options = parseArgs();
  const db = await initDatabase();
  const executor = new PaperArbitrageExecutor(db);
  const scanner = new PredictionArbitrageScanner({
    minProfitMargin: options.minProfit / 100,
    maxBudget: options.size,
  });

  if (options.reset) {
    await executor.resetAccount();
    console.log('✅ Paper trading account reset to $10,000.00 virtual cash.');
    return;
  }

  if (options.status) {
    await printStatus(executor);
    return;
  }

  if (options.settleId) {
    const res = await executor.simulateSettlement(options.settleId, 0);
    if (res.success) {
      console.log(`✅ Settled ${options.settleId}. Realized profit: +${formatCurrency(res.netProfit!)}`);
    } else {
      console.error(`❌ Error settling: ${res.error}`);
    }
    return;
  }

  if (options.test) {
    await runTest(executor);
    return;
  }

  if (options.once) {
    await runScan(scanner, executor, options);
    return;
  }

  if (options.watch) {
    console.log(`👀 Starting continuous arbitrage monitor (polling every ${options.interval}s, budget: ${formatCurrency(options.size)}, min edge: ${options.minProfit}%)...`);
    console.log('Press Ctrl+C to stop.\n');

    const poll = async () => {
      try {
        await runScan(scanner, executor, options);
      } catch (err) {
        console.error('Scan error:', err);
      }
    };

    await poll();
    setInterval(poll, options.interval * 1000);
  }
}

main().catch((err) => {
  console.error('Fatal error in paper arbitrage runner:', err);
  process.exit(1);
});
