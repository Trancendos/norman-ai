/**
 * Norman — REST API Server
 *
 * Exposes security intelligence, data collection, and living documentation
 * capabilities as HTTP endpoints.
 *
 * Architecture: Trancendos Industry 6.0 / 2060 Standard
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { securityIntelligence } from '../intelligence/security-intelligence';
import { dataCollector } from '../data/data-collector';
import { livingDocs } from '../documentation/living-docs';
import { logger } from '../utils/logger';

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'norman-ai', version: '1.0.0', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/metrics', (_req: Request, res: Response) => {
  const posture = securityIntelligence.assessSecurityPosture();
  const dataStats = dataCollector.getStats();
  const docStats = livingDocs.getStats();
  res.json({ securityPosture: posture, dataCollection: dataStats, documentation: docStats, timestamp: new Date().toISOString() });
});

// ── Security Intelligence ─────────────────────────────────────────────────────

app.get('/api/v1/threats', (req: Request, res: Response) => {
  const { severity, status, limit } = req.query;
  const threats = securityIntelligence.getThreats({
    severity: severity as any,
    status: status as any,
    limit: limit ? parseInt(limit as string) : undefined,
  });
  res.json({ threats, count: threats.length });
});

app.post('/api/v1/threats', (req: Request, res: Response) => {
  try {
    const threat = securityIntelligence.reportThreat(req.body);
    return res.status(201).json(threat);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to report threat', details: String(err) });
  }
});

app.patch('/api/v1/threats/:threatId/status', (req: Request, res: Response) => {
  const { status } = req.body;
  const updated = securityIntelligence.updateThreatStatus(req.params.threatId, status);
  if (!updated) return res.status(404).json({ error: 'Threat not found' });
  return res.json({ success: true });
});

app.get('/api/v1/cve', (req: Request, res: Response) => {
  const { q } = req.query;
  const cves = q ? securityIntelligence.searchCVEs(q as string) : securityIntelligence.getCriticalCVEs();
  res.json({ cves, count: cves.length });
});

app.get('/api/v1/cve/:cveId', (req: Request, res: Response) => {
  const cve = securityIntelligence.getCVE(req.params.cveId);
  if (!cve) return res.status(404).json({ error: 'CVE not found' });
  return res.json(cve);
});

app.post('/api/v1/scan/dependencies', (req: Request, res: Response) => {
  try {
    const { packageJson } = req.body;
    if (!packageJson) return res.status(400).json({ error: 'packageJson is required' });
    const vulnerabilities = securityIntelligence.scanDependencies(packageJson);
    return res.json({ vulnerabilities, count: vulnerabilities.length });
  } catch (err) {
    return res.status(500).json({ error: 'Dependency scan failed', details: String(err) });
  }
});

app.post('/api/v1/scan/code', (req: Request, res: Response) => {
  try {
    const { content, filename, scanType } = req.body;
    if (!content || !filename) return res.status(400).json({ error: 'content and filename are required' });
    const result = securityIntelligence.runSecurityScan(filename, content, scanType || 'code');
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Security scan failed', details: String(err) });
  }
});

app.get('/api/v1/compliance', (req: Request, res: Response) => {
  const { framework } = req.query;
  const checks = framework
    ? securityIntelligence.runComplianceCheck(framework as any)
    : securityIntelligence.getComplianceChecks();
  res.json({ checks, count: checks.length });
});

app.get('/api/v1/posture', (_req: Request, res: Response) => {
  const posture = securityIntelligence.assessSecurityPosture();
  res.json(posture);
});

app.get('/api/v1/scans', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const scans = securityIntelligence.getScanHistory(limit);
  res.json({ scans, count: scans.length });
});

// ── Data Collection ───────────────────────────────────────────────────────────

app.get('/api/v1/data/sources', (_req: Request, res: Response) => {
  res.json({ sources: dataCollector.getSources() });
});

app.post('/api/v1/data/sources', (req: Request, res: Response) => {
  try {
    const source = dataCollector.addSource(req.body);
    return res.status(201).json(source);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add source', details: String(err) });
  }
});

app.post('/api/v1/data/collect', async (_req: Request, res: Response) => {
  try {
    const data = await dataCollector.collectAll();
    return res.json({ collected: data.length, timestamp: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: 'Collection failed', details: String(err) });
  }
});

app.get('/api/v1/data/query', (req: Request, res: Response) => {
  const { tags, since, limit } = req.query;
  const data = dataCollector.queryData({
    tags: tags ? (tags as string).split(',') : undefined,
    since: since ? new Date(since as string) : undefined,
    limit: limit ? parseInt(limit as string) : 100,
  });
  res.json({ data, count: data.length });
});

app.get('/api/v1/data/stats', (_req: Request, res: Response) => {
  res.json(dataCollector.getStats());
});

// ── Living Documentation ──────────────────────────────────────────────────────

app.post('/api/v1/docs', (req: Request, res: Response) => {
  try {
    const { title, content, category, tags, authorId } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
    const doc = livingDocs.createDocument(title, content, category || 'general', tags || [], authorId || 'system');
    return res.status(201).json(doc);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create document', details: String(err) });
  }
});

app.get('/api/v1/docs', (req: Request, res: Response) => {
  const { category, status, authorId } = req.query;
  const docs = livingDocs.getDocuments({
    category: category as string,
    status: status as any,
    authorId: authorId as string,
  });
  res.json({ documents: docs, count: docs.length });
});

app.get('/api/v1/docs/search', (req: Request, res: Response) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q (query) is required' });
  const results = livingDocs.searchDocuments(q as string);
  return res.json({ results, count: results.length });
});

app.get('/api/v1/docs/:docId', (req: Request, res: Response) => {
  const doc = livingDocs.getDocument(req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  return res.json(doc);
});

app.put('/api/v1/docs/:docId', (req: Request, res: Response) => {
  try {
    const { content, changeLog, authorId } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const doc = livingDocs.updateDocument(req.params.docId, content, changeLog || 'Updated', authorId || 'system');
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    return res.json(doc);
  } catch (err) {
    return res.status(500).json({ error: 'Update failed', details: String(err) });
  }
});

app.get('/api/v1/docs/:docId/versions', (req: Request, res: Response) => {
  const versions = livingDocs.getVersions(req.params.docId);
  res.json({ versions, count: versions.length });
});

app.post('/api/v1/docs/:docId/comments', (req: Request, res: Response) => {
  try {
    const { content, authorId, lineNumber } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const comment = livingDocs.addComment(req.params.docId, authorId || 'anonymous', content, lineNumber);
    return res.status(201).json(comment);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add comment', details: String(err) });
  }
});

app.get('/api/v1/docs/:docId/suggestions', (req: Request, res: Response) => {
  const suggestions = livingDocs.generateSuggestions(req.params.docId);
  res.json({ suggestions, count: suggestions.length });
});

app.post('/api/v1/docs/generate-from-code', (req: Request, res: Response) => {
  try {
    const { code, filename } = req.body;
    if (!code || !filename) return res.status(400).json({ error: 'code and filename are required' });
    const documentation = livingDocs.generateFromCode(code, filename);
    return res.json({ documentation, filename });
  } catch (err) {
    return res.status(500).json({ error: 'Documentation generation failed', details: String(err) });
  }
});

// ── Error Handling ────────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

export { app };