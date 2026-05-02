import { describe, it, expect } from 'vitest';
import { parseNpmAudit, computeDeps } from './deps.js';

describe('parseNpmAudit', () => {
  it('parses npm 7+ vulnerabilities shape', () => {
    const stdout = JSON.stringify({
      vulnerabilities: {
        'lodash':   { name: 'lodash', severity: 'high',     via: ['proto-poison'] },
        'minimist': { name: 'minimist', severity: 'moderate', via: [{ title: 'proto-poison' }] },
        'left-pad': { name: 'left-pad', severity: 'low',    via: [] },
      },
    });
    const r = parseNpmAudit(stdout);
    expect(r.summary).toEqual({ critical: 0, high: 1, moderate: 1, low: 1 });
    // Sorted: high, moderate, low.
    expect(r.advisories[0].severity).toBe('high');
    expect(r.advisories[0].title).toBe('proto-poison');
  });

  it('parses npm 6 legacy advisories shape', () => {
    const stdout = JSON.stringify({
      advisories: {
        '1234': { module_name: 'lodash', severity: 'critical', title: 'proto poison' },
        '5678': { module_name: 'minimist', severity: 'low', title: 'arg parse' },
      },
    });
    const r = parseNpmAudit(stdout);
    expect(r.summary.critical).toBe(1);
    expect(r.summary.low).toBe(1);
    expect(r.advisories[0].severity).toBe('critical');
  });

  it('returns null on unparseable input', () => {
    expect(parseNpmAudit('not json')).toBeNull();
    expect(parseNpmAudit('')).toBeNull();
  });

  it('handles empty / no-vulns audit', () => {
    const r = parseNpmAudit(JSON.stringify({ vulnerabilities: {} }));
    expect(r.advisories).toEqual([]);
    expect(r.summary).toEqual({ critical: 0, high: 0, moderate: 0, low: 0 });
  });
});

describe('computeDeps', () => {
  it('returns object with all four surface keys', async () => {
    const r = await computeDeps({ repoRoot: '/path/that/does/not/exist/anywhere/12345' });
    expect(r).toHaveProperty('website');
    expect(r).toHaveProperty('drishti');
    expect(r).toHaveProperty('bot');
    expect(r).toHaveProperty('app');
    // Bogus repoRoot -> all surfaces should still resolve, possibly to available:false.
    for (const k of ['website', 'drishti', 'bot', 'app']) {
      expect(r[k]).toBeTruthy();
      expect(typeof r[k].available).toBe('boolean');
    }
  });

  it('returns all-blank when repoRoot is missing', async () => {
    const r = await computeDeps({});
    expect(r.website.available).toBe(false);
    expect(r.bot.available).toBe(false);
  });
});
