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


// ============================================================================
// IAM MIDDLEWARE — Trancendos 2060 Standard (TRN-PROD-001)
// ============================================================================
import { createHash, createHmac } from 'crypto';

const IAM_JWT_SECRET = process.env.IAM_JWT_SECRET || process.env.JWT_SECRET || '';
const IAM_ALGORITHM = process.env.JWT_ALGORITHM || 'HS512';
const SERVICE_ID = 'norman';
const MESH_ADDRESS = process.env.MESH_ADDRESS || 'norman.agent.local';

function sha512Audit(data: string): string {
  return createHash('sha512').update(data).digest('hex');
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64 + '='.repeat((4 - b64.length % 4) % 4), 'base64').toString('utf8');
}

interface JWTClaims {
  sub: string; email?: string; role?: string;
  active_role_level?: number; permissions?: string[];
  exp?: number; jti?: string;
}

function verifyIAMToken(token: string): JWTClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const header = JSON.parse(b64urlDecode(h));
    const alg = header.alg === 'HS512' ? 'sha512' : 'sha256';
    const expected = createHmac(alg, IAM_JWT_SECRET)
      .update(`${h}.${p}`).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (expected !== sig) return null;
    const claims = JSON.parse(b64urlDecode(p)) as JWTClaims;
    if (claims.exp && Date.now() / 1000 > claims.exp) return null;
    return claims;
  } catch { return null; }
}

function requireIAMLevel(maxLevel: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) { res.status(401).json({ error: 'Authentication required', service: SERVICE_ID }); return; }
    const claims = verifyIAMToken(token);
    if (!claims) { res.status(401).json({ error: 'Invalid or expired token', service: SERVICE_ID }); return; }
    const level = claims.active_role_level ?? 6;
    if (level > maxLevel) {
      console.log(JSON.stringify({ level: 'audit', decision: 'DENY', service: SERVICE_ID,
        principal: claims.sub, requiredLevel: maxLevel, actualLevel: level, path: req.path,
        integrityHash: sha512Audit(`DENY:${claims.sub}:${req.path}:${Date.now()}`),
        timestamp: new Date().toISOString() }));
      res.status(403).json({ error: 'Insufficient privilege level', required: maxLevel, actual: level });
      return;
    }
    (req as any).principal = claims;
    next();
  };
}

function iamRequestMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Service-Id', SERVICE_ID);
  res.setHeader('X-Mesh-Address', MESH_ADDRESS);
  res.setHeader('X-IAM-Version', '1.0');
  next();
}

function iamHealthStatus() {
  return {
    iam: {
      version: '1.0', algorithm: IAM_ALGORITHM,
      status: IAM_JWT_SECRET ? 'configured' : 'unconfigured',
      meshAddress: MESH_ADDRESS,
      routingProtocol: process.env.MESH_ROUTING_PROTOCOL || 'static_port',
      cryptoMigrationPath: 'hmac_sha512 → ml_kem (2030) → hybrid_pqc (2040) → slh_dsa (2060)',
    },
  };
}
// ============================================================================
// END IAM MIDDLEWARE
// ============================================================================

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