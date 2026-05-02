import { describe, it, expect } from 'vitest';
import { combineSchema } from './combine-schema.js';

describe('combineSchema', () => {
  it('produces a row per (collection, field) across all sources', () => {
    const out = combineSchema({
      doc: { collections: { user: ['displayName', 'email'] } },
      usage: {
        user: {
          displayName: { app: 'R', bot: 'R', website: 'R/W', refs: [] },
          email: { app: 'R', bot: null, website: 'R', refs: [] },
        },
      },
      firebase: { user: ['displayName', 'email'] },
    });
    expect(out.user).toBeDefined();
    expect(out.user.map(r => r.field).sort()).toEqual(['displayName', 'email']);
  });

  it('marks doc-only orphan when field is in doc but no surface uses it', () => {
    const out = combineSchema({
      doc: { collections: { user: ['legacy_field'] } },
      usage: {},
      firebase: { user: [] },
    });
    const row = out.user.find(r => r.field === 'legacy_field');
    expect(row.drift).toContain('doc-only orphan');
  });

  it('marks undocumented when field is in code but not in doc', () => {
    const out = combineSchema({
      doc: { collections: { user: [] } },
      usage: { user: { random_field: { app: 'W', bot: null, website: null, refs: [] } } },
      firebase: null,
    });
    const row = out.user.find(r => r.field === 'random_field');
    expect(row.drift).toContain('undocumented');
  });

  it('marks missing in <surface> when field is doc+used by 2 surfaces but one is empty', () => {
    const out = combineSchema({
      doc: { collections: { user: ['fee_amount'] } },
      usage: {
        user: {
          fee_amount: { app: 'R', bot: 'W', website: null, refs: [] },
        },
      },
      firebase: null,
    });
    const row = out.user.find(r => r.field === 'fee_amount');
    expect(row.drift.find(r => r.startsWith('missing in'))).toMatch(/website/);
  });

  it('does NOT flag missing-surface when only one surface uses the field', () => {
    const out = combineSchema({
      doc: { collections: { user: ['solo_field'] } },
      usage: { user: { solo_field: { app: 'R', bot: null, website: null, refs: [] } } },
      firebase: null,
    });
    const row = out.user.find(r => r.field === 'solo_field');
    expect(row.drift.find(r => r.startsWith('missing in'))).toBeUndefined();
  });

  it('detects name collisions within a collection (edit distance ≤ 2)', () => {
    const out = combineSchema({
      doc: { collections: { user: ['mother_name', 'mothers_name'] } },
      usage: {},
      firebase: null,
    });
    const a = out.user.find(r => r.field === 'mother_name');
    const b = out.user.find(r => r.field === 'mothers_name');
    expect(a.drift.some(r => r.startsWith('name collision'))).toBe(true);
    expect(b.drift.some(r => r.startsWith('name collision'))).toBe(true);
  });

  it('returns null for the firebase column when no firebase data passed', () => {
    const out = combineSchema({
      doc: { collections: { user: ['x'] } },
      usage: {},
      firebase: null,
    });
    expect(out.user[0].firebase).toBeNull();
  });

  it('sorts drift rows above clean rows', () => {
    const out = combineSchema({
      doc: { collections: { user: ['clean_one', 'clean_two', 'orphan'] } },
      usage: {
        user: {
          clean_one: { app: 'R', bot: 'R', website: 'R', refs: [] },
          clean_two: { app: 'R', bot: 'R', website: 'R', refs: [] },
        },
      },
      firebase: null,
    });
    expect(out.user[0].field).toBe('orphan');
  });

  it('handles empty input', () => {
    const out = combineSchema({ doc: { collections: {} }, usage: {}, firebase: null });
    expect(out).toEqual({});
  });
});
