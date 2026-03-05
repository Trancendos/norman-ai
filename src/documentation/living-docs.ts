/**
 * Norman — Living Documentation System
 *
 * AI-powered documentation with version control, collaboration,
 * and automatic generation from code.
 *
 * Migrated from:
 *   server/services/normanLivingDocs.ts
 *   server/services/normanDocumentation.ts
 *
 * Architecture: Trancendos Industry 6.0 / 2060 Standard
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface Document {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  status: 'draft' | 'published' | 'archived';
  wordCount: number;
  readingTimeMinutes: number;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  version: number;
  content: string;
  changeLog: string;
  authorId: string;
  createdAt: Date;
  diff?: string;
}

export interface DocumentComment {
  id: string;
  documentId: string;
  authorId: string;
  content: string;
  lineNumber?: number;
  resolved: boolean;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export interface DocumentSuggestion {
  id: string;
  documentId: string;
  type: 'improvement' | 'correction' | 'addition' | 'removal';
  description: string;
  originalText?: string;
  suggestedText?: string;
  confidence: number;
  source: 'ai' | 'user';
}

export interface SearchResult {
  document: Document;
  score: number;
  highlights: string[];
}

// ============================================================================
// LIVING DOCS ENGINE
// ============================================================================

export class LivingDocsEngine {
  private documents: Map<string, Document> = new Map();
  private versions: Map<string, DocumentVersion[]> = new Map();
  private comments: Map<string, DocumentComment[]> = new Map();

  constructor() {
    logger.info('[Norman] 📚 Living Docs Engine initialized');
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  createDocument(
    title: string,
    content: string,
    category: string,
    tags: string[],
    authorId: string
  ): Document {
    const id = `doc_${uuidv4()}`;
    const now = new Date();
    const wordCount = content.split(/\s+/).length;

    const doc: Document = {
      id,
      title,
      content,
      category,
      tags,
      authorId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      status: 'draft',
      wordCount,
      readingTimeMinutes: Math.ceil(wordCount / 200),
    };

    this.documents.set(id, doc);

    // Create initial version
    this.saveVersion(id, content, 'Initial version', authorId, 1);

    logger.info(`[Norman] Document created: ${title} (${id})`);
    return doc;
  }

  updateDocument(
    documentId: string,
    content: string,
    changeLog: string,
    authorId: string
  ): Document | null {
    const doc = this.documents.get(documentId);
    if (!doc) return null;

    doc.content = content;
    doc.updatedAt = new Date();
    doc.version++;
    doc.wordCount = content.split(/\s+/).length;
    doc.readingTimeMinutes = Math.ceil(doc.wordCount / 200);

    this.saveVersion(documentId, content, changeLog, authorId, doc.version);

    logger.info(`[Norman] Document updated: ${doc.title} (v${doc.version})`);
    return doc;
  }

  getDocument(documentId: string): Document | null {
    return this.documents.get(documentId) || null;
  }

  getDocuments(filters?: {
    category?: string;
    tags?: string[];
    status?: Document['status'];
    authorId?: string;
  }): Document[] {
    let docs = Array.from(this.documents.values());

    if (filters?.category) docs = docs.filter(d => d.category === filters.category);
    if (filters?.status) docs = docs.filter(d => d.status === filters.status);
    if (filters?.authorId) docs = docs.filter(d => d.authorId === filters.authorId);
    if (filters?.tags && filters.tags.length > 0) {
      docs = docs.filter(d => filters.tags!.some(tag => d.tags.includes(tag)));
    }

    return docs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  publishDocument(documentId: string): boolean {
    const doc = this.documents.get(documentId);
    if (!doc) return false;
    doc.status = 'published';
    doc.updatedAt = new Date();
    return true;
  }

  archiveDocument(documentId: string): boolean {
    const doc = this.documents.get(documentId);
    if (!doc) return false;
    doc.status = 'archived';
    doc.updatedAt = new Date();
    return true;
  }

  // ── Version Control ────────────────────────────────────────────────────────

  getVersions(documentId: string): DocumentVersion[] {
    return this.versions.get(documentId) || [];
  }

  restoreVersion(documentId: string, version: number, authorId: string): Document | null {
    const versions = this.versions.get(documentId) || [];
    const targetVersion = versions.find(v => v.version === version);
    if (!targetVersion) return null;

    return this.updateDocument(
      documentId,
      targetVersion.content,
      `Restored to version ${version}`,
      authorId
    );
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  addComment(
    documentId: string,
    authorId: string,
    content: string,
    lineNumber?: number
  ): DocumentComment {
    const comment: DocumentComment = {
      id: `comment_${uuidv4()}`,
      documentId,
      authorId,
      content,
      lineNumber,
      resolved: false,
      createdAt: new Date(),
    };

    const existing = this.comments.get(documentId) || [];
    existing.push(comment);
    this.comments.set(documentId, existing);

    return comment;
  }

  resolveComment(commentId: string, documentId: string, resolvedBy: string): boolean {
    const comments = this.comments.get(documentId) || [];
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return false;

    comment.resolved = true;
    comment.resolvedAt = new Date();
    comment.resolvedBy = resolvedBy;
    return true;
  }

  getComments(documentId: string, includeResolved = false): DocumentComment[] {
    const comments = this.comments.get(documentId) || [];
    return includeResolved ? comments : comments.filter(c => !c.resolved);
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  searchDocuments(query: string): SearchResult[] {
    const q = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const doc of this.documents.values()) {
      if (doc.status === 'archived') continue;

      let score = 0;
      const highlights: string[] = [];

      // Title match (high weight)
      if (doc.title.toLowerCase().includes(q)) {
        score += 10;
        highlights.push(`Title: ${doc.title}`);
      }

      // Tag match
      const matchingTags = doc.tags.filter(t => t.toLowerCase().includes(q));
      if (matchingTags.length > 0) {
        score += matchingTags.length * 5;
        highlights.push(`Tags: ${matchingTags.join(', ')}`);
      }

      // Content match
      const contentMatches = (doc.content.toLowerCase().match(new RegExp(q, 'g')) || []).length;
      if (contentMatches > 0) {
        score += contentMatches;
        // Extract surrounding context
        const idx = doc.content.toLowerCase().indexOf(q);
        if (idx >= 0) {
          const start = Math.max(0, idx - 50);
          const end = Math.min(doc.content.length, idx + q.length + 50);
          highlights.push(`...${doc.content.slice(start, end)}...`);
        }
      }

      if (score > 0) {
        results.push({ document: doc, score, highlights });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  // ── AI-Powered Features ────────────────────────────────────────────────────

  /**
   * Generate documentation suggestions (rule-based, no LLM required)
   */
  generateSuggestions(documentId: string): DocumentSuggestion[] {
    const doc = this.documents.get(documentId);
    if (!doc) return [];

    const suggestions: DocumentSuggestion[] = [];

    // Check for missing sections
    if (!doc.content.includes('## Overview') && !doc.content.includes('# Overview')) {
      suggestions.push({
        id: `sug_${uuidv4()}`,
        documentId,
        type: 'addition',
        description: 'Add an Overview section to improve document structure',
        suggestedText: '## Overview\n\nBrief description of this component/feature.',
        confidence: 0.9,
        source: 'ai',
      });
    }

    if (!doc.content.includes('## Example') && !doc.content.includes('## Usage')) {
      suggestions.push({
        id: `sug_${uuidv4()}`,
        documentId,
        type: 'addition',
        description: 'Add usage examples to improve developer experience',
        suggestedText: '## Usage\n\n```typescript\n// Example code here\n```',
        confidence: 0.85,
        source: 'ai',
      });
    }

    if (doc.wordCount < 100) {
      suggestions.push({
        id: `sug_${uuidv4()}`,
        documentId,
        type: 'improvement',
        description: 'Document is very short — consider adding more detail',
        confidence: 0.7,
        source: 'ai',
      });
    }

    return suggestions;
  }

  /**
   * Generate documentation from code (extracts JSDoc comments)
   */
  generateFromCode(code: string, filename: string): string {
    const lines = code.split('\n');
    const sections: string[] = [`# ${filename}\n`];

    // Extract JSDoc/TSDoc comments
    let inComment = false;
    let currentComment: string[] = [];

    for (const line of lines) {
      if (line.trim().startsWith('/**')) {
        inComment = true;
        currentComment = [];
      } else if (inComment && line.trim().startsWith('*/')) {
        inComment = false;
        if (currentComment.length > 0) {
          sections.push(currentComment.join('\n'));
        }
        currentComment = [];
      } else if (inComment) {
        const cleaned = line.trim().replace(/^\*\s?/, '');
        if (cleaned) currentComment.push(cleaned);
      }
    }

    // Extract exported functions/classes
    const exports = lines.filter(l =>
      l.match(/^export\s+(class|function|const|interface|type|enum)\s+\w+/)
    );

    if (exports.length > 0) {
      sections.push('\n## Exports\n');
      for (const exp of exports) {
        sections.push(`- \`${exp.trim()}\``);
      }
    }

    return sections.join('\n');
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private saveVersion(
    documentId: string,
    content: string,
    changeLog: string,
    authorId: string,
    version: number
  ): void {
    const v: DocumentVersion = {
      id: `ver_${uuidv4()}`,
      documentId,
      version,
      content,
      changeLog,
      authorId,
      createdAt: new Date(),
    };

    const existing = this.versions.get(documentId) || [];
    existing.push(v);
    this.versions.set(documentId, existing);
  }

  getStats(): {
    totalDocuments: number;
    publishedDocuments: number;
    draftDocuments: number;
    totalVersions: number;
    totalComments: number;
  } {
    const docs = Array.from(this.documents.values());
    let totalVersions = 0;
    let totalComments = 0;

    for (const versions of this.versions.values()) totalVersions += versions.length;
    for (const comments of this.comments.values()) totalComments += comments.length;

    return {
      totalDocuments: docs.length,
      publishedDocuments: docs.filter(d => d.status === 'published').length,
      draftDocuments: docs.filter(d => d.status === 'draft').length,
      totalVersions,
      totalComments,
    };
  }
}

export const livingDocs = new LivingDocsEngine();