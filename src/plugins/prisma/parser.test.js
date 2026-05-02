import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parsePrisma from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'test-fixtures', 'sample');

describe('parsePrisma', () => {
  it('emits one collection node per Prisma model', async () => {
    const r = await parsePrisma({ projectRoot: FIXTURE });
    const collIds = r.nodes.filter(n => n.type === 'collection').map(n => n.id).sort();
    expect(collIds).toEqual(['prisma.Post', 'prisma.User']);
  });

  it('builds schema rows for each model with all fields', async () => {
    const r = await parsePrisma({ projectRoot: FIXTURE });
    const userFields = r.schema.User.map(row => row.field).sort();
    expect(userFields).toEqual(['createdAt', 'email', 'id', 'name', 'posts', 'updatedAt']);
  });

  it('marks doc: true on every Prisma-declared row', async () => {
    const r = await parsePrisma({ projectRoot: FIXTURE });
    expect(r.schema.User.every(row => row.doc === true)).toBe(true);
  });

  it('captures field type, nullable, and primary-key flag', async () => {
    const r = await parsePrisma({ projectRoot: FIXTURE });
    const id = r.schema.User.find(row => row.field === 'id');
    expect(id.meta.type).toBe('String');
    expect(id.meta.primaryKey).toBe(true);
    const name = r.schema.User.find(row => row.field === 'name');
    expect(name.meta.nullable).toBe(true);
  });

  it('captures unique + default annotations', async () => {
    const r = await parsePrisma({ projectRoot: FIXTURE });
    const email = r.schema.User.find(row => row.field === 'email');
    expect(email.meta.unique).toBe(true);
    const createdAt = r.schema.User.find(row => row.field === 'createdAt');
    expect(createdAt.meta.defaultValue).toBe('now()');
  });

  it('flags relation fields with the related model name', async () => {
    const r = await parsePrisma({ projectRoot: FIXTURE });
    const posts = r.schema.User.find(row => row.field === 'posts');
    expect(posts.meta.relation).toBe('Post');
    expect(posts.meta.type).toContain('Post');
    const author = r.schema.Post.find(row => row.field === 'author');
    expect(author.meta.relation).toBe('User');
  });

  it('skips block-level directives like @@index', async () => {
    const r = await parsePrisma({ projectRoot: FIXTURE });
    const fields = r.schema.Post.map(row => row.field);
    expect(fields).not.toContain('@@index');
  });

  it('returns empty when no schema.prisma found', async () => {
    const r = await parsePrisma({ projectRoot: '/nonexistent/path' });
    expect(r.nodes).toEqual([]);
    expect(r.schema).toEqual({});
  });
});
