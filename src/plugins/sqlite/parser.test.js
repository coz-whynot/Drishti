import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parseSqlite from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'test-fixtures', 'sample');

describe('parseSqlite', () => {
  it('emits one collection node per CREATE TABLE', async () => {
    const r = await parseSqlite({ projectRoot: FIXTURE });
    const collIds = r.nodes.filter(n => n.type === 'collection').map(n => n.id).sort();
    expect(collIds).toEqual(['sqlite.posts', 'sqlite.users']);
  });

  it('extracts all field names per table', async () => {
    const r = await parseSqlite({ projectRoot: FIXTURE });
    const usersFields = r.schema.users.map(f => f.field).sort();
    expect(usersFields).toEqual(['created_at', 'display_name', 'email', 'id', 'updated_at']);
    const postsFields = r.schema.posts.map(f => f.field).sort();
    expect(postsFields).toEqual(['author_id', 'body', 'created_at', 'id', 'published', 'title']);
  });

  it('captures field types', async () => {
    const r = await parseSqlite({ projectRoot: FIXTURE });
    const id = r.schema.users.find(f => f.field === 'id');
    expect(id.meta.type).toBe('INTEGER');
    const email = r.schema.users.find(f => f.field === 'email');
    expect(email.meta.type).toBe('TEXT');
  });

  it('captures NOT NULL → nullable=false', async () => {
    const r = await parseSqlite({ projectRoot: FIXTURE });
    const email = r.schema.users.find(f => f.field === 'email');
    expect(email.meta.nullable).toBe(false);
    const displayName = r.schema.users.find(f => f.field === 'display_name');
    expect(displayName.meta.nullable).toBe(true);
  });

  it('captures PRIMARY KEY + UNIQUE flags', async () => {
    const r = await parseSqlite({ projectRoot: FIXTURE });
    const id = r.schema.users.find(f => f.field === 'id');
    expect(id.meta.primaryKey).toBe(true);
    const email = r.schema.users.find(f => f.field === 'email');
    expect(email.meta.unique).toBe(true);
  });

  it('captures DEFAULT values (literals + function calls)', async () => {
    const r = await parseSqlite({ projectRoot: FIXTURE });
    const createdAt = r.schema.users.find(f => f.field === 'created_at');
    expect(createdAt.meta.defaultValue).toBe('CURRENT_TIMESTAMP');
    const published = r.schema.posts.find(f => f.field === 'published');
    expect(published.meta.defaultValue).toBe('0');
  });

  it('captures REFERENCES for foreign keys', async () => {
    const r = await parseSqlite({ projectRoot: FIXTURE });
    const authorId = r.schema.posts.find(f => f.field === 'author_id');
    expect(authorId.meta.references).toEqual({ table: 'users', column: 'id' });
  });

  it('skips table-level constraints (PRIMARY KEY (id) at end of table)', async () => {
    const r = await parseSqlite({ projectRoot: FIXTURE });
    const fields = r.schema.posts.map(f => f.field);
    expect(fields).not.toContain('PRIMARY');
  });

  it('returns empty when no migration dir found', async () => {
    const r = await parseSqlite({ projectRoot: '/nonexistent/path' });
    expect(r.nodes).toEqual([]);
    expect(r.schema).toEqual({});
  });
});
