/**
 * Norman-AI — Security Intelligence & Living Documentation Agent
 *
 * Entry point wiring together:
 *   - Security Intelligence Engine (threats, CVEs, OWASP scanning)
 *   - Universal Data Collector (market data, news, economic indicators)
 *   - Living Documentation System (versioned docs, AI suggestions)
 *   - REST API server
 *
 * Architecture: Trancendos Industry 6.0 / 2060 Standard
 * Component: The Cryptex (norman-ai) — Security Intelligence
 */

import { createServer } from 'http';
import { app } from './api/server';
import { securityIntelligence } from './intelligence/security-intelligence';
import { dataCollector } from './data/data-collector';
import { livingDocs } from './documentation/living-docs';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT || '4002');
const HOST = process.env.HOST || '0.0.0.0';

async function bootstrap(): Promise<void> {
  logger.info('╔══════════════════════════════════════════════════════════╗');
  logger.info('║         NORMAN-AI — SECURITY INTELLIGENCE AGENT          ║');
  logger.info('║         The Cryptex — Security & Documentation v1.0      ║');
  logger.info('╚══════════════════════════════════════════════════════════╝');

  // ── 1. Initial security posture assessment ────────────────────────────────
  const posture = securityIntelligence.assessSecurityPosture();
  logger.info(`Security posture: Grade ${posture.grade} (${posture.overallScore}/100)`);

  // ── 2. Run initial OWASP compliance check ─────────────────────────────────
  const compliance = securityIntelligence.runComplianceCheck('OWASP_TOP_10');
  const passing = compliance.filter(c => c.status === 'pass').length;
  logger.info(`OWASP TOP 10 compliance: ${passing}/${compliance.length} controls passing`);

  // ── 3. Start data collection ───────────────────────────────────────────────
  const collectionInterval = parseInt(process.env.DATA_COLLECTION_INTERVAL_MS || '300000');
  dataCollector.startScheduledCollection(collectionInterval);
  logger.info(`Data collection started (${collectionInterval}ms interval)`);

  // ── 4. Run initial data collection ────────────────────────────────────────
  await dataCollector.collectAll();
  const dataStats = dataCollector.getStats();
  logger.info(`Data sources: ${dataStats.activeSources}/${dataStats.totalSources} active`);

  // ── 5. Log documentation stats ────────────────────────────────────────────
  const docStats = livingDocs.getStats();
  logger.info(`Living docs: ${docStats.totalDocuments} documents`);

  // ── 6. Start HTTP server ───────────────────────────────────────────────────
  const httpServer = createServer(app);

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(PORT, HOST, () => resolve());
    httpServer.on('error', reject);
  });

  logger.info(`✅ Norman-AI listening on http://${HOST}:${PORT}`);
  logger.info(`   REST API:    http://${HOST}:${PORT}/api/v1`);
  logger.info(`   Health:      http://${HOST}:${PORT}/health`);
  logger.info(`   Threats:     GET http://${HOST}:${PORT}/api/v1/threats`);
  logger.info(`   CVE Search:  GET http://${HOST}:${PORT}/api/v1/cve`);
  logger.info(`   Posture:     GET http://${HOST}:${PORT}/api/v1/posture`);
  logger.info(`   Docs:        GET http://${HOST}:${PORT}/api/v1/docs`);

  // ── 7. Graceful shutdown ───────────────────────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal} — shutting down...`);
    dataCollector.stopScheduledCollection();
    httpServer.close(() => {
      logger.info('Norman-AI shut down gracefully');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => { logger.error({ err }, 'Uncaught exception'); shutdown('uncaughtException'); });
  process.on('unhandledRejection', (reason) => { logger.error({ reason }, 'Unhandled rejection'); });
}

// ── Exports ───────────────────────────────────────────────────────────────────

export { securityIntelligence } from './intelligence/security-intelligence';
export { dataCollector } from './data/data-collector';
export { livingDocs } from './documentation/living-docs';
export type { ThreatEvent, CVERecord, SecurityPosture, SecurityScanResult, ComplianceCheck } from './intelligence/security-intelligence';
export type { DataSource, CollectedData, StockMarketData, CryptoMarketData, NewsArticle } from './data/data-collector';
export type { Document, DocumentVersion, DocumentComment, SearchResult } from './documentation/living-docs';

// ── Main ──────────────────────────────────────────────────────────────────────

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});