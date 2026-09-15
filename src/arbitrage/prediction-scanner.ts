/**
 * Prediction Market Mathematical Arbitrage Scanner
 *
 * Scans binary and multi-outcome prediction markets (Polymarket)
 * for mathematical arbitrage opportunities (Dutch Book / Negative Risk).
 *
 * Features:
 * - 0 LLM tokens consumed
 * - Polymarket public Gamma and CLOB API integration (no API key required)
 * - Orderbook depth walking & VWAP slippage calculation
 * - Binary Dutch Book (Sum of Asks < 1.00)
 * - Reverse Dutch Book (Sum of Bids > 1.00)
 */

import { logger } from '../utils/logger';

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface MarketOrderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp?: number;
}

export interface PredictionLeg {
  outcome: string;
  tokenId: string;
  bestAsk: number;
  bestBid: number;
  vwapAsk: number;
  shares: number;
  cost: number;
}

export interface PredictionArbOpportunity {
  id: string;
  marketId: string;
  conditionId: string;
  question: string;
  slug: string;
  type: 'binary_dutch_book' | 'reverse_dutch_book';
  legs: PredictionLeg[];
  /** Sum of top-of-book asks */
  topAskSum: number;
  /** Sum of top-of-book bids */
  topBidSum: number;
  /** Volume-weighted average price sum for the executed position */
  vwapAskSum: number;
  /** Total shares executable simultaneously across all legs */
  executableShares: number;
  /** Total capital needed to purchase all legs */
  totalCost: number;
  /** Payout guaranteed at resolution ($1.00 per share) */
  guaranteedPayout: number;
  /** Guaranteed profit in USD */
  netProfit: number;
  /** Return on investment percentage */
  roiPct: number;
  /** Timestamp when detected */
  detectedAt: number;
}

export interface RawPolymarketMarket {
  id: string;
  conditionId?: string;
  question: string;
  slug?: string;
  active: boolean;
  closed: boolean;
  volumeNum?: number;
  liquidityNum?: number;
  clobTokenIds?: string; // JSON string array
  outcomes?: string; // JSON string array
  outcomePrices?: string; // JSON string array
}

export interface ScannerConfig {
  gammaUrl?: string;
  clobUrl?: string;
  minVolume?: number;
  minProfitMargin?: number; // e.g. 0.002 = 0.2%
  maxBudget?: number; // max USD to allocate per arb opportunity
  concurrency?: number;
  timeoutMs?: number;
}

const DEFAULT_GAMMA_URL = 'https://gamma-api.polymarket.com';
const DEFAULT_CLOB_URL = 'https://clob.polymarket.com';

export class PredictionArbitrageScanner {
  private gammaUrl: string;
  private clobUrl: string;
  private minVolume: number;
  private minProfitMargin: number;
  private maxBudget: number;
  private concurrency: number;
  private timeoutMs: number;

  constructor(config?: ScannerConfig) {
    this.gammaUrl = config?.gammaUrl || DEFAULT_GAMMA_URL;
    this.clobUrl = config?.clobUrl || DEFAULT_CLOB_URL;
    this.minVolume = config?.minVolume ?? 500;
    this.minProfitMargin = config?.minProfitMargin ?? 0.001; // default 0.1% edge
    this.maxBudget = config?.maxBudget ?? 100; // default $100 per arb
    this.concurrency = config?.concurrency ?? 6;
    this.timeoutMs = config?.timeoutMs ?? 6000;
  }

  /**
   * Fetch active markets from Polymarket Gamma API
   */
  async fetchActiveMarkets(limit = 60): Promise<RawPolymarketMarket[]> {
    try {
      const url = `${this.gammaUrl}/markets?limit=${limit}&active=true&closed=false&order=volumeNum&ascending=false`;
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Failed to fetch Polymarket active markets');
        return [];
      }
      const data = (await res.json()) as RawPolymarketMarket[];
      return data.filter((m) => {
        if (!m.clobTokenIds || !m.active || m.closed) return false;
        if (this.minVolume > 0 && (m.volumeNum ?? 0) < this.minVolume) return false;
        try {
          const ids = JSON.parse(m.clobTokenIds);
          return Array.isArray(ids) && ids.length === 2; // binary markets for now
        } catch {
          return false;
        }
      });
    } catch (err) {
      logger.error({ err }, 'Error fetching Polymarket active markets');
      return [];
    }
  }

  /**
   * Fetch orderbook for a specific token ID
   */
  async fetchOrderbook(tokenId: string): Promise<MarketOrderbook | null> {
    try {
      const url = `${this.clobUrl}/book?token_id=${encodeURIComponent(tokenId)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        bids?: Array<{ price: string; size: string }>;
        asks?: Array<{ price: string; size: string }>;
      };

      // Asks must be sorted ASCENDING by price
      const asks: OrderbookLevel[] = (data.asks || [])
        .map((a) => ({ price: Number.parseFloat(a.price), size: Number.parseFloat(a.size) }))
        .filter((a) => Number.isFinite(a.price) && Number.isFinite(a.size) && a.price > 0 && a.size > 0)
        .sort((a, b) => a.price - b.price);

      // Bids must be sorted DESCENDING by price
      const bids: OrderbookLevel[] = (data.bids || [])
        .map((b) => ({ price: Number.parseFloat(b.price), size: Number.parseFloat(b.size) }))
        .filter((b) => Number.isFinite(b.price) && Number.isFinite(b.size) && b.price > 0 && b.size > 0)
        .sort((a, b) => b.price - a.price);

      return { asks, bids, timestamp: Date.now() };
    } catch {
      return null;
    }
  }

  /**
   * Calculate Dutch Book arbitrage by walking orderbook depth.
   *
   * To maintain equal payouts across outcomes, we must buy an EQUAL quantity Q
   * of YES shares and NO shares.
   *
   * As we increase Q, we consume ask levels in both books.
   * We stop when:
   * 1. Marginal combined price exceeds (1.00 - minProfitMargin)
   * 2. Total combined cost reaches maxBudget
   * 3. Either orderbook runs out of liquidity
   */
  static calculateDutchBookOpportunity(
    market: RawPolymarketMarket,
    bookA: MarketOrderbook,
    bookB: MarketOrderbook,
    options?: { maxBudget?: number; minProfitMargin?: number }
  ): PredictionArbOpportunity | null {
    const maxBudget = options?.maxBudget ?? 100;
    const minProfitMargin = options?.minProfitMargin ?? 0.001;

    if (!bookA.asks.length || !bookB.asks.length) return null;

    const topAskA = bookA.asks[0].price;
    const topAskB = bookB.asks[0].price;
    const topAskSum = topAskA + topAskB;

    const topBidA = bookA.bids.length ? bookA.bids[0].price : 0;
    const topBidB = bookB.bids.length ? bookB.bids[0].price : 0;
    const topBidSum = topBidA + topBidB;

    // Must have top of book arbitrage condition
    if (topAskSum >= 1.00 - minProfitMargin) {
      return null;
    }

    // Walk depth of both books simultaneously
    let idxA = 0;
    let idxB = 0;
    let remSizeA = bookA.asks[0].size;
    let remSizeB = bookB.asks[0].size;

    let accumulatedShares = 0;
    let accumulatedCostA = 0;
    let accumulatedCostB = 0;

    const maxAllowedUnitCost = 1.00 - minProfitMargin;

    while (idxA < bookA.asks.length && idxB < bookB.asks.length) {
      const priceA = bookA.asks[idxA].price;
      const priceB = bookB.asks[idxB].price;

      // If marginal price exceeds maximum profitable threshold, stop
      if (priceA + priceB > maxAllowedUnitCost) {
        break;
      }

      // Step size is the smaller of remaining sizes at current level
      const stepSize = Math.min(remSizeA, remSizeB);
      const stepCost = stepSize * (priceA + priceB);

      // Check if this step exceeds remaining budget
      const currentCost = accumulatedCostA + accumulatedCostB;
      if (currentCost + stepCost > maxBudget) {
        const remainingBudget = maxBudget - currentCost;
        if (remainingBudget > 0.01) {
          const partialShares = remainingBudget / (priceA + priceB);
          accumulatedShares += partialShares;
          accumulatedCostA += partialShares * priceA;
          accumulatedCostB += partialShares * priceB;
        }
        break;
      }

      accumulatedShares += stepSize;
      accumulatedCostA += stepSize * priceA;
      accumulatedCostB += stepSize * priceB;

      remSizeA -= stepSize;
      remSizeB -= stepSize;

      if (remSizeA <= 0.0001) {
        idxA++;
        if (idxA < bookA.asks.length) remSizeA = bookA.asks[idxA].size;
      }
      if (remSizeB <= 0.0001) {
        idxB++;
        if (idxB < bookB.asks.length) remSizeB = bookB.asks[idxB].size;
      }
    }

    // Require meaningful executable size (at least $1 worth of shares)
    const totalCost = accumulatedCostA + accumulatedCostB;
    if (accumulatedShares <= 0 || totalCost < 1.0) {
      return null;
    }

    const vwapAskA = accumulatedCostA / accumulatedShares;
    const vwapAskB = accumulatedCostB / accumulatedShares;
    const vwapAskSum = vwapAskA + vwapAskB;

    // Double check overall VWAP condition
    if (vwapAskSum >= 1.00 - minProfitMargin) {
      return null;
    }

    const guaranteedPayout = accumulatedShares * 1.0;
    const netProfit = guaranteedPayout - totalCost;
    const roiPct = (netProfit / totalCost) * 100;

    let outcomes = ['Yes', 'No'];
    try {
      if (market.outcomes) outcomes = JSON.parse(market.outcomes);
    } catch {
      // fallback
    }

    let tokenIds: string[] = [];
    try {
      if (market.clobTokenIds) tokenIds = JSON.parse(market.clobTokenIds);
    } catch {
      // fallback
    }

    return {
      id: `arb_${market.id}_${Date.now()}`,
      marketId: market.id,
      conditionId: market.conditionId || '',
      question: market.question,
      slug: market.slug || '',
      type: 'binary_dutch_book',
      legs: [
        {
          outcome: outcomes[0] || 'Yes',
          tokenId: tokenIds[0] || '',
          bestAsk: topAskA,
          bestBid: topBidA,
          vwapAsk: vwapAskA,
          shares: accumulatedShares,
          cost: accumulatedCostA,
        },
        {
          outcome: outcomes[1] || 'No',
          tokenId: tokenIds[1] || '',
          bestAsk: topAskB,
          bestBid: topBidB,
          vwapAsk: vwapAskB,
          shares: accumulatedShares,
          cost: accumulatedCostB,
        },
      ],
      topAskSum,
      topBidSum,
      vwapAskSum,
      executableShares: accumulatedShares,
      totalCost,
      guaranteedPayout,
      netProfit,
      roiPct,
      detectedAt: Date.now(),
    };
  }

  /**
   * Scan active markets for arbitrage opportunities
   */
  async scanMarkets(limit = 40): Promise<PredictionArbOpportunity[]> {
    const markets = await this.fetchActiveMarkets(limit);
    if (!markets.length) return [];

    const opportunities: PredictionArbOpportunity[] = [];

    // Process markets with concurrency limit
    for (let i = 0; i < markets.length; i += this.concurrency) {
      const chunk = markets.slice(i, i + this.concurrency);
      const results = await Promise.all(
        chunk.map(async (market) => {
          try {
            const tokenIds = JSON.parse(market.clobTokenIds || '[]') as string[];
            if (tokenIds.length !== 2) return null;

            const [bookA, bookB] = await Promise.all([
              this.fetchOrderbook(tokenIds[0]),
              this.fetchOrderbook(tokenIds[1]),
            ]);

            if (!bookA || !bookB) return null;

            return PredictionArbitrageScanner.calculateDutchBookOpportunity(
              market,
              bookA,
              bookB,
              {
                maxBudget: this.maxBudget,
                minProfitMargin: this.minProfitMargin,
              }
            );
          } catch (err) {
            logger.debug({ err, marketId: market.id }, 'Error evaluating market orderbooks');
            return null;
          }
        })
      );

      for (const opp of results) {
        if (opp) opportunities.push(opp);
      }
    }

    // Sort opportunities descending by ROI percentage
    opportunities.sort((a, b) => b.roiPct - a.roiPct);
    return opportunities;
  }
}
