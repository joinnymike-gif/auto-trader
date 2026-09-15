/**
 * Arbitrage CLI Skill
 *
 * Commands:
 * /arb start - Start arbitrage monitoring
 * /arb stop - Stop monitoring
 * /arb status - Check monitoring status
 * /arb check [query] - Run one-time scan
 * /arb compare <market-a> <market-b> - Compare two markets
 * /arb opportunities - List current opportunities
 * /arb link <market-a> <market-b> - Manually link markets
 * /arb unlink <match-id> - Remove link
 * /arb links - View all links
 * /arb auto-match <query> - Auto-detect matches
 * /arb stats - Arbitrage statistics
 */

import {
  createArbitrageService,
  type ArbitrageService,
  type PriceProvider,
} from '../../../arbitrage/index';
import { initDatabase } from '../../../db/index';
import { PredictionArbitrageScanner } from '../../../arbitrage/prediction-scanner';
import { PaperArbitrageExecutor } from '../../../arbitrage/paper-executor';
import { logger } from '../../../utils/logger';
import type { Platform } from '../../../types';
import { formatHelp } from '../../help.js';
import { wrapSkillError } from '../../errors.js';

let arbService: ArbitrageService | null = null;

function getService(): ArbitrageService {
  if (!arbService) {
    const providers = new Map() as Map<any, PriceProvider>;
    // Providers are registered dynamically by the arbitrage service
    // based on available feed configurations
    arbService = createArbitrageService(providers);
    logger.info({ providerCount: providers.size }, 'Arbitrage service initialized');
  }
  return arbService;
}

async function handleStart(): Promise<string> {
  const service = getService();
  service.start();
  return 'Arbitrage monitoring started.';
}

async function handleStop(): Promise<string> {
  const service = getService();
  service.stop();
  return 'Arbitrage monitoring stopped.';
}

async function handleStatus(): Promise<string> {
  const service = getService();
  const stats = service.getStats();
  return `**Arbitrage Status**\n\n` +
    `Matched market pairs: ${stats.matchCount}\n` +
    `Active opportunities: ${stats.activeOpportunities}\n` +
    `Average spread: ${stats.avgSpread.toFixed(2)}%\n` +
    `Platforms: ${stats.platforms.join(', ')}`;
}

async function handleCheck(query: string): Promise<string> {
  const service = getService();
  try {
    const opps = await service.checkArbitrage();
    if (opps.length === 0) {
      return 'No new arbitrage opportunities found.';
    }

    let output = `**Found ${opps.length} Arbitrage Opportunities**\n\n`;
    for (const opp of opps.slice(0, 10)) {
      output += `**${opp.spreadPct.toFixed(1)}% spread**\n`;
      output += `  Buy on ${opp.buyPlatform}: $${opp.buyPrice.toFixed(3)}\n`;
      output += `  Sell on ${opp.sellPlatform}: $${opp.sellPrice.toFixed(3)}\n`;
      output += `  Profit per $100: $${opp.profitPer100.toFixed(2)}\n\n`;
    }
    return output;
  } catch (error) {
    return `Error checking arbitrage: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCompare(marketA: string, marketB: string): Promise<string> {
  const service = getService();

  // Parse platform:id format
  const VALID_PLATFORMS: Platform[] = ['polymarket', 'kalshi', 'manifold', 'metaculus', 'drift', 'predictit', 'predictfun', 'betfair', 'smarkets', 'opinion', 'virtuals', 'hedgehog', 'hyperliquid', 'binance', 'bybit', 'mexc'];
  const parseMarket = (m: string): { platform: Platform; id: string } | null => {
    const parts = m.split(':');
    if (parts.length === 2) {
      if (!VALID_PLATFORMS.includes(parts[0] as Platform)) return null;
      return { platform: parts[0] as Platform, id: parts[1] };
    }
    return { platform: 'polymarket', id: m };
  };

  const a = parseMarket(marketA);
  const b = parseMarket(marketB);
  if (!a) return `Unknown platform in "${marketA}". Use format: platform:id (e.g., kalshi:MARKET_ID)`;
  if (!b) return `Unknown platform in "${marketB}". Use format: platform:id (e.g., polymarket:MARKET_ID)`;

  try {
    const result = await service.compareMarkets(a.platform, a.id, b.platform, b.id);
    if (!result) {
      return 'No arbitrage found between these markets.';
    }

    return `**Market Comparison**\n\n` +
      `Spread: ${result.spreadPct.toFixed(2)}%\n` +
      `Buy on ${result.buyPlatform}: $${result.buyPrice.toFixed(3)}\n` +
      `Sell on ${result.sellPlatform}: $${result.sellPrice.toFixed(3)}\n` +
      `Profit per $100: $${result.profitPer100.toFixed(2)}\n` +
      `Confidence: ${(result.confidence * 100).toFixed(0)}%`;
  } catch (error) {
    return `Error comparing markets: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOpportunities(): Promise<string> {
  const service = getService();
  return service.formatOpportunities();
}

async function handleLinks(): Promise<string> {
  const service = getService();
  const matches = service.getMatches();

  if (matches.length === 0) {
    return 'No linked market pairs.';
  }

  let output = `**Linked Markets** (${matches.length})\n\n`;
  for (const match of matches) {
    output += `ID: \`${match.id}\`\n`;
    output += `  Similarity: ${(match.similarity * 100).toFixed(0)}%\n`;
    output += `  Matched by: ${match.matchedBy}\n`;
    for (const m of match.markets) {
      output += `  - ${m.platform}: ${m.question}\n`;
    }
    output += '\n';
  }
  return output;
}

async function handleLink(marketA: string, marketB: string): Promise<string> {
  const service = getService();

  const parseMarket = (m: string) => {
    const parts = m.split(':');
    if (parts.length === 2) {
      return { platform: parts[0] as Platform, marketId: parts[1], question: parts[1] };
    }
    return { platform: 'polymarket' as Platform, marketId: m, question: m };
  };

  const a = parseMarket(marketA);
  const b = parseMarket(marketB);

  const match = service.addMatch({
    markets: [a, b],
    similarity: 1.0,
    matchedBy: 'manual',
  });

  return `Markets linked. Match ID: \`${match.id}\``;
}

async function handleUnlink(matchId: string): Promise<string> {
  const service = getService();
  const success = service.removeMatch(matchId);
  return success
    ? `Match \`${matchId}\` removed.`
    : `Match \`${matchId}\` not found.`;
}

async function handleAutoMatch(query: string): Promise<string> {
  const service = getService();
  try {
    const matches = await service.autoMatchMarkets(query);
    if (matches.length === 0) {
      return 'No matching markets found across platforms.';
    }

    let output = `**Auto-Matched ${matches.length} Market Pairs**\n\n`;
    for (const match of matches) {
      output += `Similarity: ${(match.similarity * 100).toFixed(0)}%\n`;
      for (const m of match.markets) {
        output += `  - ${m.platform}: ${m.question}\n`;
      }
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error auto-matching: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleStats(): Promise<string> {
  const service = getService();
  const stats = service.getStats();

  return `**Arbitrage Statistics**\n\n` +
    `Linked market pairs: ${stats.matchCount}\n` +
    `Active opportunities: ${stats.activeOpportunities}\n` +
    `Average spread: ${stats.avgSpread.toFixed(2)}%\n` +
    `Monitored platforms: ${stats.platforms.join(', ')}`;
}

let autoMonitorTimer: NodeJS.Timeout | null = null;
let autoMonitorStats = {
  running: false,
  intervalSec: 15,
  size: 100,
  minProfitMargin: 0.002,
  startedAt: null as Date | null,
  scansCount: 0,
  opportunitiesFound: 0,
  executedCount: 0,
  lastScanAt: null as Date | null,
};

async function handlePaper(args: string[]): Promise<string> {
  const subCmd = args[0]?.toLowerCase() || 'status';
  const restArgs = args.slice(1);
  const db = await initDatabase();
  const executor = new PaperArbitrageExecutor(db);

  switch (subCmd) {
    case 'status':
    case 'balance': {
      const account = await executor.getAccount();
      const openRecords = await executor.listRecords({ status: 'open', limit: 5 });
      let out = `**📊 Paper Arbitrage Account Status**\n\n`;
      out += `• **Virtual Balance**: $${account.balance.toFixed(2)} (Cash)\n`;
      out += `• **Starting Balance**: $${account.startingBalance.toFixed(2)}\n`;
      out += `• **Locked Unrealized Profit**: +$${account.unrealizedLockedProfit.toFixed(2)}\n`;
      out += `• **Open Arbitrage Positions**: ${account.openArbitrages}\n`;
      out += `• **Settled Positions**: ${account.settledArbitrages}\n`;
      out += `• **Total Return**: $${account.totalPnl.toFixed(2)} (${account.totalPnlPct.toFixed(2)}%)\n\n`;

      if (openRecords.length > 0) {
        out += `**Active Arbitrage Pairs:**\n`;
        for (const r of openRecords) {
          out += `• ${r.question.slice(0, 45)}...\n  Cost: $${r.totalCost.toFixed(2)} | Locked PnL: +$${r.lockedProfit.toFixed(2)} (${r.roiPct.toFixed(2)}% ROI)\n`;
        }
      }
      return out;
    }

    case 'scan':
    case 'check': {
      const scanner = new PredictionArbitrageScanner({ minProfitMargin: 0.001, maxBudget: 100 });
      const opps = await scanner.scanMarkets(30);
      if (opps.length === 0) {
        return `**Prediction Market Arbitrage Scan**\n\nNo active Dutch Book opportunities (Sum of Asks < 1.00) found at this moment across Polymarket. Orderbooks are currently efficiently priced by market makers.\n\nUse \`/arb paper test\` to simulate an execution test.`;
      }
      let out = `**🔥 Found ${opps.length} Mathematical Arbitrage Opportunities**\n\n`;
      for (const opp of opps.slice(0, 5)) {
        const exec = await executor.executeOpportunity(opp);
        out += `**${opp.question.slice(0, 50)}...**\n`;
        out += `• Asks Sum: $${opp.topAskSum.toFixed(3)} | VWAP Sum: $${opp.vwapAskSum.toFixed(3)}\n`;
        out += `• Investment: $${opp.totalCost.toFixed(2)} -> Payout: $${opp.guaranteedPayout.toFixed(2)}\n`;
        out += `• Locked Profit: +$${opp.netProfit.toFixed(2)} (${opp.roiPct.toFixed(2)}% ROI)\n`;
        out += `• Execution: ${exec.success ? '✅ Simulated Trade Executed' : `⚠️ ${exec.error}`}\n\n`;
      }
      return out;
    }

    case 'test': {
      const mockMarket = {
        id: 'test_market_' + Date.now(),
        question: 'Will Human Level AI be confirmed before 2027?',
        active: true,
        closed: false,
        outcomes: JSON.stringify(['Yes', 'No']),
        clobTokenIds: JSON.stringify(['yes_token', 'no_token']),
      };
      const mockBookA = {
        asks: [{ price: 0.48, size: 200 }],
        bids: [{ price: 0.46, size: 100 }],
      };
      const mockBookB = {
        asks: [{ price: 0.49, size: 200 }],
        bids: [{ price: 0.47, size: 100 }],
      };
      const opp = PredictionArbitrageScanner.calculateDutchBookOpportunity(
        mockMarket, mockBookA, mockBookB, { maxBudget: 100, minProfitMargin: 0.005 }
      );
      if (!opp) return 'Failed to generate test opportunity.';

      const exec = await executor.executeOpportunity(opp);
      if (!exec.success || !exec.record) return `Test execution failed: ${exec.error}`;

      const settle = await executor.simulateSettlement(exec.record.id, 0);
      const acc = await executor.getAccount();

      return `**🧪 Paper Arbitrage Test Execution Successful!**\n\n` +
        `• **Market**: ${opp.question}\n` +
        `• **Asks**: YES @ $0.48, NO @ $0.49 (Sum = $0.97 < $1.00)\n` +
        `• **Trade**: Bought ${opp.executableShares.toFixed(2)} YES & NO shares for $${opp.totalCost.toFixed(2)}\n` +
        `• **Guaranteed Payout**: $${opp.guaranteedPayout.toFixed(2)}\n` +
        `• **Simulated Settlement**: Winner pays $1.00 -> Payout $${settle.payout?.toFixed(2)}\n` +
        `• **Realized Net Profit**: +$${settle.netProfit?.toFixed(2)} (${opp.roiPct.toFixed(2)}% ROI)\n` +
        `• **Current Virtual Balance**: $${acc.balance.toFixed(2)}`;
    }

    case 'reset': {
      await executor.resetAccount();
      return '✅ Paper trading account reset to $10,000.00 virtual cash.';
    }

    case 'positions':
    case 'list': {
      const records = await executor.listRecords({ limit: 10 });
      if (records.length === 0) {
        return 'No paper arbitrage records found. Use `/arb paper test` or `/arb paper scan` to start trading.';
      }
      let out = `**📜 Paper Arbitrage Records (${records.length})**\n\n`;
      for (const r of records) {
        out += `• **[${r.status.toUpperCase()}]** ${r.question.slice(0, 40)}...\n`;
        out += `  Cost: $${r.totalCost.toFixed(2)} | Locked Profit: +$${r.lockedProfit.toFixed(2)} (${r.roiPct.toFixed(2)}%)\n`;
      }
      return out;
    }

    case 'auto':
    case 'watch': {
      const action = restArgs[0]?.toLowerCase() || 'status';
      if (action === 'start') {
        if (autoMonitorStats.running) {
          return `⚠️ Auto paper arbitrage is already running (polling every ${autoMonitorStats.intervalSec}s). Use \`/arb paper auto status\` or \`/arb paper auto stop\`.`;
        }
        const intervalSec = Math.max(5, parseInt(restArgs[1], 10) || 15);
        const size = Math.max(10, parseFloat(restArgs[2]) || 100);
        const minEdgePct = Math.max(0.05, parseFloat(restArgs[3]) || 0.2);

        autoMonitorStats = {
          running: true,
          intervalSec,
          size,
          minProfitMargin: minEdgePct / 100,
          startedAt: new Date(),
          scansCount: 0,
          opportunitiesFound: 0,
          executedCount: 0,
          lastScanAt: null,
        };

        const scanner = new PredictionArbitrageScanner({
          minProfitMargin: autoMonitorStats.minProfitMargin,
          maxBudget: size,
        });

        const runCycle = async () => {
          if (!autoMonitorStats.running) return;
          try {
            autoMonitorStats.scansCount++;
            autoMonitorStats.lastScanAt = new Date();
            const opps = await scanner.scanMarkets(50);
            if (opps.length > 0) {
              autoMonitorStats.opportunitiesFound += opps.length;
              for (const opp of opps) {
                const res = await executor.executeOpportunity(opp);
                if (res.success) {
                  autoMonitorStats.executedCount++;
                  logger.info({ id: opp.id, question: opp.question, profit: opp.netProfit }, 'Auto paper arbitrage executed');
                }
              }
            }
          } catch (err) {
            logger.error({ err }, 'Error in auto paper arbitrage cycle');
          }
        };

        autoMonitorTimer = setInterval(runCycle, intervalSec * 1000);
        runCycle().catch(() => {});

        return `**🚀 Continuous Paper Arbitrage Started!**\n\n` +
          `• **Polling Interval**: Every ${intervalSec}s\n` +
          `• **Position Size**: $${size.toFixed(2)} per trade\n` +
          `• **Min Profit Edge**: ${minEdgePct}%\n` +
          `• **Target**: Live Polymarket Orderbooks\n` +
          `• **Mode**: 100% Risk-free Paper Simulation\n\n` +
          `The strategy is running in the background. Use \`/arb paper auto status\` or \`/arb paper status\` to track progress anytime.`;
      }

      if (action === 'stop') {
        if (!autoMonitorStats.running || !autoMonitorTimer) {
          return 'ℹ️ Auto paper arbitrage is not currently running.';
        }
        clearInterval(autoMonitorTimer);
        autoMonitorTimer = null;
        autoMonitorStats.running = false;
        return `**🛑 Continuous Paper Arbitrage Stopped.**\n\n` +
          `• Total Scans: ${autoMonitorStats.scansCount}\n` +
          `• Opportunities Found: ${autoMonitorStats.opportunitiesFound}\n` +
          `• Trades Executed: ${autoMonitorStats.executedCount}\n\n` +
          `Run \`/arb paper status\` to inspect your account PnL.`;
      }

      // Default to status
      const uptime = autoMonitorStats.startedAt
        ? `${Math.floor((Date.now() - autoMonitorStats.startedAt.getTime()) / 60000)}m ${Math.floor(((Date.now() - autoMonitorStats.startedAt.getTime()) % 60000) / 1000)}s`
        : '0m';

      return `**🤖 Auto Paper Arbitrage Monitor Status**\n\n` +
        `• **Status**: ${autoMonitorStats.running ? '🟢 RUNNING' : '⚪ STOPPED'}\n` +
        `• **Interval**: ${autoMonitorStats.intervalSec}s\n` +
        `• **Budget per Trade**: $${autoMonitorStats.size.toFixed(2)}\n` +
        `• **Min Profit Edge**: ${(autoMonitorStats.minProfitMargin * 100).toFixed(2)}%\n` +
        `• **Uptime**: ${uptime}\n` +
        `• **Scans Completed**: ${autoMonitorStats.scansCount}\n` +
        `• **Opportunities Detected**: ${autoMonitorStats.opportunitiesFound}\n` +
        `• **Simulated Trades Executed**: ${autoMonitorStats.executedCount}\n\n` +
        `Commands:\n` +
        `• Start: \`/arb paper auto start [interval=15] [size=100] [minEdge=0.2]\`\n` +
        `• Stop: \`/arb paper auto stop\``;
    }

    case 'help':
    default:
      return `**Prediction Market Paper Arbitrage Commands:**\n\n` +
        `• \`/arb paper status\` - View virtual cash balance & arbitrage PnL\n` +
        `• \`/arb paper auto start [interval] [size] [minEdge]\` - Start 24/7 background scanning\n` +
        `• \`/arb paper auto stop\` - Stop background scanning\n` +
        `• \`/arb paper auto status\` - Check background scanner health & metrics\n` +
        `• \`/arb paper scan\` - One-time live Polymarket scan & execution\n` +
        `• \`/arb paper test\` - Run a simulated Dutch Book arbitrage test with settlement\n` +
        `• \`/arb paper positions\` - List paper arbitrage positions\n` +
        `• \`/arb paper reset\` - Reset virtual account to $10,000\n`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  try {
    switch (cmd) {
      case 'paper':
        return handlePaper(rest);

      case 'start':
        return handleStart();

      case 'stop':
        return handleStop();

      case 'status':
        return handleStatus();

      case 'check':
      case 'scan':
        return handleCheck(rest.join(' '));

      case 'compare':
        if (rest.length < 2) return 'Usage: /arb compare <market-a> <market-b>';
        return handleCompare(rest[0], rest[1]);

      case 'opportunities':
      case 'opps':
        return handleOpportunities();

      case 'link':
        if (rest.length < 2) return 'Usage: /arb link <market-a> <market-b>';
        return handleLink(rest[0], rest[1]);

      case 'unlink':
        if (!rest[0]) return 'Usage: /arb unlink <match-id>';
        return handleUnlink(rest[0]);

      case 'links':
      case 'matches':
        return handleLinks();

      case 'auto-match':
      case 'automatch':
        if (!rest[0]) return 'Usage: /arb auto-match <query>';
        return handleAutoMatch(rest.join(' '));

      case 'stats':
        return handleStats();

      case 'help':
      default:
        return formatHelp({
          name: 'Arbitrage',
          description: 'Automated cross-platform arbitrage detection and monitoring',
          sections: [
            {
              title: 'Monitoring',
              commands: [
                { cmd: '/arb start', description: 'Start monitoring' },
                { cmd: '/arb stop', description: 'Stop monitoring' },
                { cmd: '/arb status', description: 'Check status' },
              ],
            },
            {
              title: 'Scanning',
              commands: [
                { cmd: '/arb check [query]', description: 'One-time scan' },
                { cmd: '/arb compare <market-a> <market-b>', description: 'Compare two markets' },
                { cmd: '/arb opportunities', description: 'List opportunities' },
              ],
            },
            {
              title: 'Market Linking',
              commands: [
                { cmd: '/arb link <market-a> <market-b>', description: 'Link markets manually' },
                { cmd: '/arb unlink <match-id>', description: 'Remove link' },
                { cmd: '/arb links', description: 'View all links' },
                { cmd: '/arb auto-match <query>', description: 'Auto-detect matches' },
              ],
            },
            {
              title: 'Paper Arbitrage (Simulation)',
              commands: [
                { cmd: '/arb paper status', description: 'View virtual balance & locked PnL' },
                { cmd: '/arb paper scan', description: 'Scan Polymarket & execute paper trades' },
                { cmd: '/arb paper test', description: 'Run complete test simulation with settlement' },
                { cmd: '/arb paper positions', description: 'List active paper positions' },
                { cmd: '/arb paper reset', description: 'Reset virtual balance to $10,000' },
              ],
            },
            {
              title: 'Statistics',
              commands: [
                { cmd: '/arb stats', description: 'View statistics' },
              ],
            },
          ],
          examples: [
            '/arb paper scan',
            '/arb paper test',
            '/arb paper status',
            '/arb check "trump election"',
            '/arb compare poly:12345 kalshi:TRUMP',
            '/arb link poly:abc123 kalshi:XYZ',
          ],
          seeAlso: [
            { cmd: '/poly', description: 'Polymarket trading' },
            { cmd: '/bf', description: 'Betfair trading' },
            { cmd: '/feeds', description: 'Market data feeds' },
            { cmd: '/signals', description: 'Trading signals' },
          ],
          notes: [
            'Shortcuts: scan = check, opps = opportunities, matches = links, automatch = auto-match',
          ],
        });
    }
  } catch (error) {
    return wrapSkillError('Arbitrage', cmd || 'command', error);
  }
}

export default {
  name: 'arbitrage',
  description: 'Automated cross-platform arbitrage detection and monitoring',
  commands: ['/arbitrage', '/arb'],
  handle: execute,
};
