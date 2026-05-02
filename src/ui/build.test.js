import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from './build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '.test-dashboard.html');

afterEach(async () => { try { await fs.unlink(OUT); } catch {} });

describe('buildHtml', () => {
  it('produces self-contained HTML with inlined snapshot, app.js, styles', async () => {
    const snapshot = {
      stats: { nodeCount: 1, edgeCount: 0, issueCount: 0, redNodes: 0, yellowNodes: 0, i18nGaps: 0, securityHotspots: 0, silentFailures: 0 },
      nodes: [{ id: 'x', label: 'X', type: 'collection', surface: 'firebase', health: 'green', issues: [], securityTags: [], i18nStatus: 'na', owner: 'db-auditor', meta: {}, file: null }],
      edges: [], issues: [], flows: [],
      gitCommit: 'abc', gitBranch: 'dev', gitDirty: false,
      timestamp: '2026-04-22T00:00:00Z',
    };
    await buildHtml(snapshot, OUT);
    const html = await fs.readFile(OUT, 'utf8');
    expect(html).toContain('<title>Drishti');
    expect(html).toContain('drishti-brand');
    expect(html).toContain('"nodeCount":1');
    expect(html).not.toContain('__SNAPSHOT__');
    expect(html).not.toContain('__STYLES__');
    expect(html).not.toContain('__APP_JS__');
  });
});
