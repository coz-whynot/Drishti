import { describe, it, expect } from 'vitest';
import { diffSnapshots, computeHealthScore } from './diff.js';

function snap({ issues = [], stats = {} } = {}) {
  return {
    issues,
    stats: {
      nodeCount: 0,
      edgeCount: 0,
      issueCount: issues.length,
      redNodes: 0,
      yellowNodes: 0,
      i18nGaps: 0,
      securityHotspots: 0,
      silentFailures: 0,
      ...stats,
    },
  };
}

describe('diffSnapshots', () => {
  it('returns empty arrays and null healthDelta when previous is null', () => {
    const cur = snap({ issues: [{ id: 'A1', severity: 'HIGH' }] });
    const r = diffSnapshots(cur, null);
    expect(r.closed).toEqual([]);
    expect(r.new).toEqual([]);
    expect(r.healthDelta).toBeNull();
    expect(r.deltas).toEqual({ red: 0, yellow: 0, silent: 0 });
  });

  it('detects new issues (in current, absent in previous)', () => {
    const prev = snap({ issues: [{ id: 'A1', severity: 'HIGH' }] });
    const cur = snap({
      issues: [
        { id: 'A1', severity: 'HIGH' },
        { id: 'B2', severity: 'CRITICAL' },
      ],
    });
    const r = diffSnapshots(cur, prev);
    expect(r.new.map((i) => i.id)).toEqual(['B2']);
    expect(r.closed).toEqual([]);
  });

  it('detects closed issues (in previous, absent in current)', () => {
    const prev = snap({
      issues: [
        { id: 'A1', severity: 'HIGH' },
        { id: 'B2', severity: 'MEDIUM' },
      ],
    });
    const cur = snap({ issues: [{ id: 'A1', severity: 'HIGH' }] });
    const r = diffSnapshots(cur, prev);
    expect(r.closed.map((i) => i.id)).toEqual(['B2']);
    expect(r.new).toEqual([]);
  });

  it('computes health delta and counter deltas correctly', () => {
    const prev = snap({
      issues: [{ id: 'A1', severity: 'HIGH' }],
      stats: { redNodes: 10, yellowNodes: 5, silentFailures: 3 },
    });
    const cur = snap({
      issues: [
        { id: 'A1', severity: 'HIGH' },
        { id: 'B2', severity: 'CRITICAL' },
      ],
      stats: { redNodes: 12, yellowNodes: 4, silentFailures: 3 },
    });
    const r = diffSnapshots(cur, prev);
    // prev: 100 - 3 - 0.5*3 = 95.5 -> 95
    expect(r.healthDelta.previous).toBe(95);
    // cur: 100 - 10 - 3 - 0.5*3 = 85.5 -> 85
    expect(r.healthDelta.current).toBe(85);
    expect(r.healthDelta.change).toBe(-10);
    expect(r.deltas).toEqual({ red: 2, yellow: -1, silent: 0 });
  });

  it('sorts new and closed lists by severity (CRITICAL first)', () => {
    const prev = snap({ issues: [] });
    const cur = snap({
      issues: [
        { id: 'L1', severity: 'LOW' },
        { id: 'C1', severity: 'CRITICAL' },
        { id: 'M1', severity: 'MEDIUM' },
        { id: 'H1', severity: 'HIGH' },
      ],
    });
    const r = diffSnapshots(cur, prev);
    expect(r.new.map((i) => i.id)).toEqual(['C1', 'H1', 'M1', 'L1']);
  });
});

describe('computeHealthScore', () => {
  it('returns 100 for an empty snapshot', () => {
    expect(computeHealthScore(snap({ issues: [] }))).toBe(100);
  });
  it('floors at 0', () => {
    const issues = Array.from({ length: 30 }, (_, i) => ({ id: `C${i}`, severity: 'CRITICAL' }));
    expect(computeHealthScore(snap({ issues }))).toBe(0);
  });
  it('handles null/undefined gracefully', () => {
    expect(computeHealthScore(null)).toBe(0);
    expect(computeHealthScore(undefined)).toBe(0);
  });
});
