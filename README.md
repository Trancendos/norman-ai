# Norman-AI — Security Intelligence & Living Documentation Agent

> **The Cryptex** — Security Intelligence Component of the Trancendos Industry 6.0 Platform

Norman is the security intelligence and documentation agent of the Trancendos platform. It monitors threats, tracks CVEs, runs OWASP compliance scans, collects market/news data, and maintains living documentation for the entire ecosystem.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NORMAN-AI                                │
│              Security Intelligence & Documentation              │
├──────────────────┬──────────────────┬───────────────────────────┤
│ Security Intel   │  Data Collector  │   Living Docs Engine      │
│ (threats, CVEs,  │  (market, news,  │   (versioned docs,        │
│  OWASP, posture) │   economic data) │    AI suggestions)        │
├──────────────────┴──────────────────┴───────────────────────────┤
│                      REST API (Express)                         │
└─────────────────────────────────────────────────────────────────┘
```

### Components

| Component | File | Description |
|-----------|------|-------------|
| Security Intelligence | `src/intelligence/security-intelligence.ts` | Threats, CVEs, OWASP, compliance, posture |
| Data Collector | `src/data/data-collector.ts` | Market data, news, economic indicators |
| Living Docs | `src/documentation/living-docs.ts` | Versioned docs, comments, AI suggestions |
| API Server | `src/api/server.ts` | REST interface (25+ endpoints) |
| Logger | `src/utils/logger.ts` | Pino structured logging |

---

## Capabilities

### Security Intelligence
- Threat event management (report, track, mitigate, resolve)
- CVE database with search and critical CVE tracking
- Dependency vulnerability scanning
- OWASP TOP 10 code scanning (9 rules)
- Compliance checks: OWASP, SOC2, ISO 27001, GDPR, NIST, PCI-DSS, ETSI
- Security posture assessment with grade (A-F) and trend

### Data Collection
- Multi-source data collection (stock market, crypto, news, economic)
- Automatic tagging and enrichment
- Scheduled collection with configurable intervals
- Data query with tag/date filtering
- Synthetic data generation for zero-cost operation

### Living Documentation
- Full CRUD with version control
- Comment system with resolution tracking
- Full-text search with relevance scoring
- AI-powered suggestions (structure, examples, completeness)
- Auto-generation from code (JSDoc extraction)

---

## API Reference

### Security Intelligence
```
GET  /api/v1/threats                  — List threats
POST /api/v1/threats                  — Report new threat
PATCH /api/v1/threats/:id/status      — Update threat status
GET  /api/v1/cve                      — Search CVEs
GET  /api/v1/cve/:cveId               — Get specific CVE
POST /api/v1/scan/dependencies        — Scan package.json for vulns
POST /api/v1/scan/code                — OWASP code scan
GET  /api/v1/compliance               — Run compliance check
GET  /api/v1/posture                  — Security posture assessment
GET  /api/v1/scans                    — Scan history
```

### Data Collection
```
GET  /api/v1/data/sources             — List data sources
POST /api/v1/data/sources             — Add data source
POST /api/v1/data/collect             — Trigger collection
GET  /api/v1/data/query               — Query collected data
GET  /api/v1/data/stats               — Collection statistics
```

### Living Documentation
```
POST /api/v1/docs                     — Create document
GET  /api/v1/docs                     — List documents
GET  /api/v1/docs/search              — Search documents
GET  /api/v1/docs/:id                 — Get document
PUT  /api/v1/docs/:id                 — Update document
GET  /api/v1/docs/:id/versions        — Version history
POST /api/v1/docs/:id/comments        — Add comment
GET  /api/v1/docs/:id/suggestions     — AI suggestions
POST /api/v1/docs/generate-from-code  — Generate from code
```

---

## Quick Start

```bash
npm install
npm run dev       # Development
npm run build     # Production build
npm start         # Run production
npm run typecheck # Type check
```

---

## Zero-Cost Mandate

Norman operates without external API calls by default:
- Security scanning uses rule-based pattern matching
- Data collection uses synthetic data generators
- Documentation suggestions use rule-based analysis
- Set `DATA_SOURCE_*` env vars to connect real data feeds

---

*Part of the Trancendos Industry 6.0 / 2060 Standard platform.*