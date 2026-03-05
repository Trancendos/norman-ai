/**
 * Norman — Universal Data Collection & Tagging System
 *
 * Collects data from multiple sources (market data, news, social media,
 * economic indicators) and makes it available to all agents in the mesh.
 *
 * Migrated from: server/services/normanDataCollection.ts
 *
 * Architecture: Trancendos Industry 6.0 / 2060 Standard
 */

import { logger } from '../utils/logger';

// ============================================================================
// TYPES
// ============================================================================

export type DataSourceType = 'stock_market' | 'crypto_market' | 'economic' | 'news' | 'social_media' | 'custom';
export type DataSourceStatus = 'active' | 'paused' | 'error';

export interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  url?: string;
  refreshInterval: number; // minutes
  lastCollected?: Date;
  status: DataSourceStatus;
  dataCount: number;
}

export interface CollectedData {
  id: string;
  sourceId: string;
  sourceName: string;
  dataType: string;
  timestamp: Date;
  data: Record<string, unknown>;
  tags: string[];
  enrichments: Record<string, unknown>;
  qualityScore: number; // 0-100
  version: number;
}

export interface DataTag {
  name: string;
  category: 'market' | 'sentiment' | 'technical' | 'fundamental' | 'event' | 'custom';
  confidence: number; // 0-1
  metadata?: Record<string, unknown>;
}

export interface StockMarketData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  pe: number;
  eps: number;
  high52Week: number;
  low52Week: number;
  timestamp: Date;
}

export interface CryptoMarketData {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  marketCap: number;
  circulatingSupply: number;
  totalSupply: number;
  timestamp: Date;
}

export interface EconomicIndicator {
  name: string;
  value: number;
  unit: string;
  country: string;
  date: Date;
  previousValue?: number;
  change?: number;
  changePercent?: number;
}

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: Date;
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentScore: number; // -1 to 1
  relevantSymbols: string[];
  topics: string[];
}

export interface SocialMediaTrend {
  keyword: string;
  platform: 'twitter' | 'reddit' | 'discord' | 'telegram';
  mentions: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentScore: number;
  trending: boolean;
  timestamp: Date;
}

export interface DataCollectionStats {
  totalSources: number;
  activeSources: number;
  totalDataPoints: number;
  lastCollectionRun: Date | null;
  dataByType: Record<DataSourceType, number>;
}

// ============================================================================
// DATA COLLECTOR
// ============================================================================

export class NormanDataCollector {
  private sources: Map<string, DataSource> = new Map();
  private collectedData: CollectedData[] = [];
  private collectionInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeDefaultSources();
    logger.info('[Norman] 📊 Data Collector initialized');
  }

  // ── Source Management ──────────────────────────────────────────────────────

  addSource(source: Omit<DataSource, 'dataCount'>): DataSource {
    const ds: DataSource = { ...source, dataCount: 0 };
    this.sources.set(ds.id, ds);
    logger.info(`[Norman] Data source added: ${ds.name} (${ds.type})`);
    return ds;
  }

  removeSource(sourceId: string): boolean {
    const removed = this.sources.delete(sourceId);
    if (removed) logger.info(`[Norman] Data source removed: ${sourceId}`);
    return removed;
  }

  pauseSource(sourceId: string): boolean {
    const source = this.sources.get(sourceId);
    if (!source) return false;
    source.status = 'paused';
    return true;
  }

  resumeSource(sourceId: string): boolean {
    const source = this.sources.get(sourceId);
    if (!source) return false;
    source.status = 'active';
    return true;
  }

  getSources(): DataSource[] {
    return Array.from(this.sources.values());
  }

  // ── Data Collection ────────────────────────────────────────────────────────

  /**
   * Collect data from all active sources
   */
  async collectAll(): Promise<CollectedData[]> {
    const activeSources = Array.from(this.sources.values()).filter(s => s.status === 'active');
    const results: CollectedData[] = [];

    for (const source of activeSources) {
      try {
        const data = await this.collectFromSource(source);
        results.push(...data);
        source.lastCollected = new Date();
        source.dataCount += data.length;
      } catch (err) {
        logger.error({ err }, `[Norman] Collection failed for source: ${source.name}`);
        source.status = 'error';
      }
    }

    this.collectedData.push(...results);
    // Keep last 10,000 data points
    if (this.collectedData.length > 10_000) {
      this.collectedData = this.collectedData.slice(-10_000);
    }

    logger.info(`[Norman] Collected ${results.length} data points from ${activeSources.length} sources`);
    return results;
  }

  /**
   * Collect from a specific source
   */
  private async collectFromSource(source: DataSource): Promise<CollectedData[]> {
    // In production, this would make actual API calls
    // For now, generate synthetic data based on source type
    const data: CollectedData[] = [];

    switch (source.type) {
      case 'stock_market':
        data.push(this.generateStockData(source));
        break;
      case 'crypto_market':
        data.push(this.generateCryptoData(source));
        break;
      case 'news':
        data.push(this.generateNewsData(source));
        break;
      case 'economic':
        data.push(this.generateEconomicData(source));
        break;
      default:
        break;
    }

    return data;
  }

  // ── Data Query ─────────────────────────────────────────────────────────────

  queryData(filters: {
    sourceType?: DataSourceType;
    tags?: string[];
    since?: Date;
    limit?: number;
  }): CollectedData[] {
    let result = [...this.collectedData];

    if (filters.since) {
      result = result.filter(d => d.timestamp >= filters.since!);
    }
    if (filters.tags && filters.tags.length > 0) {
      result = result.filter(d => filters.tags!.some(tag => d.tags.includes(tag)));
    }

    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return filters.limit ? result.slice(0, filters.limit) : result;
  }

  /**
   * Auto-tag collected data using keyword analysis
   */
  autoTag(data: CollectedData): DataTag[] {
    const tags: DataTag[] = [];
    const content = JSON.stringify(data.data).toLowerCase();

    // Market sentiment tags
    if (content.includes('bull') || content.includes('surge') || content.includes('rally')) {
      tags.push({ name: 'bullish', category: 'sentiment', confidence: 0.8 });
    }
    if (content.includes('bear') || content.includes('crash') || content.includes('decline')) {
      tags.push({ name: 'bearish', category: 'sentiment', confidence: 0.8 });
    }

    // Event tags
    if (content.includes('earnings') || content.includes('revenue')) {
      tags.push({ name: 'earnings', category: 'event', confidence: 0.9 });
    }
    if (content.includes('fed') || content.includes('interest rate') || content.includes('inflation')) {
      tags.push({ name: 'macro', category: 'fundamental', confidence: 0.85 });
    }

    // Security tags
    if (content.includes('hack') || content.includes('breach') || content.includes('vulnerability')) {
      tags.push({ name: 'security_event', category: 'event', confidence: 0.9 });
    }

    return tags;
  }

  // ── Scheduled Collection ───────────────────────────────────────────────────

  startScheduledCollection(intervalMs = 300_000): void {
    if (this.collectionInterval) return;
    this.collectionInterval = setInterval(() => {
      this.collectAll().catch(err => logger.error({ err }, '[Norman] Scheduled collection failed'));
    }, intervalMs);
    logger.info(`[Norman] Scheduled collection started (${intervalMs}ms interval)`);
  }

  stopScheduledCollection(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
      logger.info('[Norman] Scheduled collection stopped');
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  getStats(): DataCollectionStats {
    const sources = Array.from(this.sources.values());
    const dataByType: Record<DataSourceType, number> = {
      stock_market: 0,
      crypto_market: 0,
      economic: 0,
      news: 0,
      social_media: 0,
      custom: 0,
    };

    for (const source of sources) {
      dataByType[source.type] = (dataByType[source.type] || 0) + source.dataCount;
    }

    const lastCollected = sources
      .filter(s => s.lastCollected)
      .map(s => s.lastCollected!)
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;

    return {
      totalSources: sources.length,
      activeSources: sources.filter(s => s.status === 'active').length,
      totalDataPoints: this.collectedData.length,
      lastCollectionRun: lastCollected,
      dataByType,
    };
  }

  // ── Synthetic Data Generators (for zero-cost operation) ───────────────────

  private generateStockData(source: DataSource): CollectedData {
    const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'];
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const price = 100 + Math.random() * 900;
    const change = (Math.random() - 0.5) * 20;

    return {
      id: `data_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sourceId: source.id,
      sourceName: source.name,
      dataType: 'stock_quote',
      timestamp: new Date(),
      data: {
        symbol,
        price: Math.round(price * 100) / 100,
        change: Math.round(change * 100) / 100,
        changePercent: Math.round((change / price) * 10000) / 100,
        volume: Math.floor(Math.random() * 10_000_000),
      },
      tags: ['stock', 'market', change > 0 ? 'bullish' : 'bearish'],
      enrichments: {},
      qualityScore: 95,
      version: 1,
    };
  }

  private generateCryptoData(source: DataSource): CollectedData {
    const symbols = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT'];
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const price = Math.random() * 50000;
    const change = (Math.random() - 0.5) * 5000;

    return {
      id: `data_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sourceId: source.id,
      sourceName: source.name,
      dataType: 'crypto_quote',
      timestamp: new Date(),
      data: {
        symbol,
        price: Math.round(price * 100) / 100,
        change24h: Math.round(change * 100) / 100,
        changePercent24h: Math.round((change / price) * 10000) / 100,
        volume24h: Math.floor(Math.random() * 1_000_000_000),
      },
      tags: ['crypto', 'market', change > 0 ? 'bullish' : 'bearish'],
      enrichments: {},
      qualityScore: 90,
      version: 1,
    };
  }

  private generateNewsData(source: DataSource): CollectedData {
    const sentimentScore = (Math.random() - 0.5) * 2;
    return {
      id: `data_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sourceId: source.id,
      sourceName: source.name,
      dataType: 'news_article',
      timestamp: new Date(),
      data: {
        title: 'Market Update: Technology Sector Shows Resilience',
        summary: 'Technology stocks continue to demonstrate strong performance amid market volatility.',
        sentiment: sentimentScore > 0.2 ? 'positive' : sentimentScore < -0.2 ? 'negative' : 'neutral',
        sentimentScore: Math.round(sentimentScore * 100) / 100,
        topics: ['technology', 'markets', 'earnings'],
      },
      tags: ['news', 'technology', 'markets'],
      enrichments: {},
      qualityScore: 80,
      version: 1,
    };
  }

  private generateEconomicData(source: DataSource): CollectedData {
    return {
      id: `data_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sourceId: source.id,
      sourceName: source.name,
      dataType: 'economic_indicator',
      timestamp: new Date(),
      data: {
        name: 'CPI',
        value: 3.2 + (Math.random() - 0.5) * 0.5,
        unit: 'percent',
        country: 'US',
        previousValue: 3.1,
      },
      tags: ['economic', 'inflation', 'macro'],
      enrichments: {},
      qualityScore: 98,
      version: 1,
    };
  }

  private initializeDefaultSources(): void {
    const defaults: Omit<DataSource, 'dataCount'>[] = [
      { id: 'src_stocks', name: 'Stock Market Feed', type: 'stock_market', refreshInterval: 5, status: 'active' },
      { id: 'src_crypto', name: 'Crypto Market Feed', type: 'crypto_market', refreshInterval: 1, status: 'active' },
      { id: 'src_news', name: 'Financial News Feed', type: 'news', refreshInterval: 15, status: 'active' },
      { id: 'src_economic', name: 'Economic Indicators', type: 'economic', refreshInterval: 60, status: 'active' },
    ];

    for (const source of defaults) {
      this.addSource(source);
    }
  }
}

export const dataCollector = new NormanDataCollector();