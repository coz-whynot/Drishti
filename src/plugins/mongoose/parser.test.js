import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parseMongoose from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'test-fixtures', 'sample');

describe('parseMongoose', () => {
  it('emits a collection node per schema → model() call', async () => {
    const r = await parseMongoose({ projectRoot: FIXTURE });
    const collIds = r.nodes.map(n => n.id).sort();
    expect(collIds).toContain('mongoose.User');
    expect(collIds).toContain('mongoose.Post');
  });

  it('extracts all field names', async () => {
    const r = await parseMongoose({ projectRoot: FIXTURE });
    const userFields = r.schema.User.map(f => f.field).sort();
    expect(userFields).toEqual(['age', 'createdAt', 'email', 'name', 'tags']);
    const postFields = r.schema.Post.map(f => f.field).sort();
    expect(postFields).toEqual(['authorId', 'body', 'published', 'title']);
  });

  it('captures shorthand-type fields (name: String) → type=String', async () => {
    const r = await parseMongoose({ projectRoot: FIXTURE });
    const name = r.schema.User.find(f => f.field === 'name');
    expect(name.meta.type).toBe('String');
    const body = r.schema.Post.find(f => f.field === 'body');
    expect(body.meta.type).toBe('String');
  });

  it('captures object-descriptor fields (type, required, unique, default)', async () => {
    const r = await parseMongoose({ projectRoot: FIXTURE });
    const email = r.schema.User.find(f => f.field === 'email');
    expect(email.meta.type).toBe('String');
    expect(email.meta.required).toBe(true);
    expect(email.meta.unique).toBe(true);
    const age = r.schema.User.find(f => f.field === 'age');
    expect(age.meta.type).toBe('Number');
    expect(age.meta.defaultValue).toBe('0');
  });

  it('captures array shorthand fields ([String]) → type=String[]', async () => {
    const r = await parseMongoose({ projectRoot: FIXTURE });
    const tags = r.schema.User.find(f => f.field === 'tags');
    expect(tags.meta.type).toBe('String[]');
  });

  it('strips namespace prefix from ObjectId types', async () => {
    const r = await parseMongoose({ projectRoot: FIXTURE });
    const authorId = r.schema.Post.find(f => f.field === 'authorId');
    expect(authorId.meta.type).toBe('ObjectId');
  });

  it('returns empty when no Schema definitions found', async () => {
    const r = await parseMongoose({ projectRoot: '/nonexistent/path' });
    expect(r.nodes).toEqual([]);
    expect(r.schema).toEqual({});
  });
});
