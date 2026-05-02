import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parsePostgres from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'test-fixtures', 'sample');

describe('parsePostgres', () => {
  it('emits a collection node per Knex createTable + per raw CREATE TABLE', async () => {
    const r = await parsePostgres({ projectRoot: FIXTURE });
    const collIds = r.nodes.map(n => n.id).sort();
    expect(collIds).toEqual(['postgres.logs', 'postgres.users']);
  });

  it('extracts Knex builder field names', async () => {
    const r = await parsePostgres({ projectRoot: FIXTURE });
    const userFields = r.schema.users.map(f => f.field).sort();
    expect(userFields).toEqual(['created_at', 'display_name', 'email', 'id', 'is_admin', 'metadata']);
  });

  it('maps Knex builders to Postgres types', async () => {
    const r = await parsePostgres({ projectRoot: FIXTURE });
    const id = r.schema.users.find(f => f.field === 'id');
    expect(id.meta.type).toBe('UUID');
    const email = r.schema.users.find(f => f.field === 'email');
    expect(email.meta.type).toBe('VARCHAR');
    const metadata = r.schema.users.find(f => f.field === 'metadata');
    expect(metadata.meta.type).toBe('JSONB');
  });

  it('captures Knex .notNullable() / .unique() / .primary() / .defaultTo()', async () => {
    const r = await parsePostgres({ projectRoot: FIXTURE });
    const id = r.schema.users.find(f => f.field === 'id');
    expect(id.meta.primaryKey).toBe(true);
    const email = r.schema.users.find(f => f.field === 'email');
    expect(email.meta.unique).toBe(true);
    expect(email.meta.nullable).toBe(false);
    const isAdmin = r.schema.users.find(f => f.field === 'is_admin');
    expect(isAdmin.meta.defaultValue).toBe('false');
  });

  it('extracts raw SQL CREATE TABLE field names + Postgres types', async () => {
    const r = await parsePostgres({ projectRoot: FIXTURE });
    const logFields = r.schema.logs.map(f => f.field).sort();
    expect(logFields).toEqual(['created_at', 'id', 'message', 'payload', 'user_id']);
    const payload = r.schema.logs.find(f => f.field === 'payload');
    expect(payload.meta.type).toBe('JSONB');
  });

  it('handles SERIAL PRIMARY KEY in raw SQL', async () => {
    const r = await parsePostgres({ projectRoot: FIXTURE });
    const id = r.schema.logs.find(f => f.field === 'id');
    expect(id.meta.type).toBe('SERIAL');
    expect(id.meta.primaryKey).toBe(true);
  });

  it('returns empty when no migrations dir found', async () => {
    const r = await parsePostgres({ projectRoot: '/nonexistent/path' });
    expect(r.nodes).toEqual([]);
    expect(r.schema).toEqual({});
  });
});
