import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parseFirestore from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'test-fixtures', 'sample');

describe('parseFirestore', () => {
  it('emits collection nodes from firestore.rules', async () => {
    const r = await parseFirestore({ projectRoot: FIXTURE });
    const collIds = r.nodes.filter(n => n.type === 'collection').map(n => n.id).sort();
    expect(collIds).toContain('firestore.users');
    expect(collIds).toContain('firestore.applications');
    expect(collIds).toContain('firestore.audit_log');
  });

  it('attaches indexed-fields metadata to collection nodes', async () => {
    const r = await parseFirestore({ projectRoot: FIXTURE });
    const apps = r.nodes.find(n => n.id === 'firestore.applications');
    expect(apps.meta.indexedFields).toContain('userId');
    expect(apps.meta.indexedFields).toContain('createdAt');
    const users = r.nodes.find(n => n.id === 'firestore.users');
    expect(users.meta.indexedFields).toContain('email');
  });

  it('builds schema rows for each collection from code refs', async () => {
    const r = await parseFirestore({ projectRoot: FIXTURE });
    expect(r.schema.applications).toBeDefined();
    const fieldNames = r.schema.applications.map(row => row.field).sort();
    expect(fieldNames).toContain('userId');
    expect(fieldNames).toContain('status');
    expect(fieldNames).toContain('title');
    expect(fieldNames).toContain('createdAt');
  });

  it('attributes Python writes to bot column, TS writes to website, Dart to app', async () => {
    const r = await parseFirestore({ projectRoot: FIXTURE });
    const status = r.schema.applications.find(row => row.field === 'status');
    expect(status.bot).toBe('W');
    expect(status.website).toBe('W');
    expect(status.app).toBe('W');
  });

  it('marks indexed: true on rows whose field is in firestore.indexes.json', async () => {
    const r = await parseFirestore({ projectRoot: FIXTURE });
    const userId = r.schema.applications.find(row => row.field === 'userId');
    expect(userId.meta.indexed).toBe(true);
    const status = r.schema.applications.find(row => row.field === 'status');
    expect(status.meta.indexed).toBe(false);
  });

  it('returns empty when no firestore signals present', async () => {
    const r = await parseFirestore({ projectRoot: '/nonexistent/path' });
    expect(r.nodes).toEqual([]);
    expect(r.schema).toEqual({});
  });

  it('captures field refs across all three SDKs in a single collection', async () => {
    const r = await parseFirestore({ projectRoot: FIXTURE });
    const userId = r.schema.applications.find(row => row.field === 'userId');
    // userId is written by Python (handler.py via .set) and Dart (.add) — bot + app
    expect(userId.bot).toBe('W');
    expect(userId.app).toBe('W');
    // userId NOT in TS code → website should be null
    expect(userId.website).toBeNull();
  });
});
