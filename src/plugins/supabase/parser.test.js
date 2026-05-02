import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parseSupabase from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'test-fixtures', 'sample');

describe('parseSupabase', () => {
  it('emits a collection node per CREATE TABLE', async () => {
    const r = await parseSupabase({ projectRoot: FIXTURE });
    const collIds = r.nodes.filter(n => n.type === 'collection').map(n => n.id).sort();
    expect(collIds).toEqual(['supabase.comments', 'supabase.posts', 'supabase.profiles']);
  });

  it('detects CREATE POLICY statements and attaches them to the right table', async () => {
    const r = await parseSupabase({ projectRoot: FIXTURE });
    const profiles = r.nodes.find(n => n.id === 'supabase.profiles');
    expect(profiles.meta.policyCount).toBe(2);
    const commands = profiles.meta.policies.map(p => p.command).sort();
    expect(commands).toEqual(['SELECT', 'UPDATE']);
  });

  it('detects ENABLE ROW LEVEL SECURITY and sets rlsEnabled=true', async () => {
    const r = await parseSupabase({ projectRoot: FIXTURE });
    const profiles = r.nodes.find(n => n.id === 'supabase.profiles');
    expect(profiles.meta.rlsEnabled).toBe(true);
  });

  it('flags HIGH issue when RLS enabled but no policies (locked-out table)', async () => {
    const r = await parseSupabase({ projectRoot: FIXTURE });
    const issue = r.issues.find(i => i.id === 'SB-RLS-supabase.posts');
    expect(issue).toBeDefined();
    expect(issue.severity).toBe('HIGH');
    expect(issue.title).toContain('posts');
  });

  it('flags MEDIUM issue when no RLS at all (open table)', async () => {
    const r = await parseSupabase({ projectRoot: FIXTURE });
    const issue = r.issues.find(i => i.id === 'SB-NORLS-supabase.comments');
    expect(issue).toBeDefined();
    expect(issue.severity).toBe('MEDIUM');
  });

  it('extracts schema rows for each table', async () => {
    const r = await parseSupabase({ projectRoot: FIXTURE });
    const profileFields = r.schema.profiles.map(f => f.field).sort();
    expect(profileFields).toEqual(['avatar_url', 'created_at', 'email', 'full_name', 'id']);
  });

  it('captures REFERENCES across schemas (auth.users(id))', async () => {
    const r = await parseSupabase({ projectRoot: FIXTURE });
    const id = r.schema.profiles.find(f => f.field === 'id');
    expect(id.meta.references).toEqual({ table: 'users', column: 'id' });
  });

  it('captures DEFAULT values including function calls', async () => {
    const r = await parseSupabase({ projectRoot: FIXTURE });
    const created = r.schema.profiles.find(f => f.field === 'created_at');
    expect(created.meta.defaultValue).toBe('NOW()');
    const postId = r.schema.posts.find(f => f.field === 'id');
    expect(postId.meta.defaultValue).toBe('gen_random_uuid()');
  });

  it('returns empty when no supabase/ dir found', async () => {
    const r = await parseSupabase({ projectRoot: '/nonexistent/path' });
    expect(r.nodes).toEqual([]);
    expect(r.schema).toEqual({});
  });
});
