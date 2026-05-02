import { describe, it, expect } from 'vitest';
import { createNode, createEdge, mergeGraphs, createSnapshot } from './model.js';

describe('createNode', () => {
  it('creates a node with defaults', () => {
    const n = createNode({ id: 'x', type: 'collection', surface: 'firebase', label: 'X' });
    expect(n.health).toBe('green');
    expect(n.issues).toEqual([]);
    expect(n.securityTags).toEqual([]);
    expect(n.i18nStatus).toBe('na');
    expect(n.owner).toBe('bug-hunter');
  });
  it('allows overriding defaults', () => {
    const n = createNode({ id: 'x', type: 'handler', surface: 'service', label: 'X', health: 'red', issues: ['NR-1'], owner: 'team-a' });
    expect(n.health).toBe('red');
    expect(n.issues).toEqual(['NR-1']);
    expect(n.owner).toBe('team-a');
  });
  it('throws if required fields missing', () => {
    expect(() => createNode({ id: 'x' })).toThrow(/type/);
  });
});

describe('createEdge', () => {
  it('creates edge with defaults', () => {
    const e = createEdge({ source: 'a', target: 'b', type: 'reads', surfaces: ['bot'] });
    expect(e.weight).toBe(1);
    expect(e.field).toBe(null);
    expect(e.id).toBe('a->b:reads');
  });
});

describe('mergeGraphs', () => {
  it('deduplicates nodes by id, merging issues/tags', () => {
    const a = { nodes: [createNode({ id: 'x', type: 'collection', surface: 'firebase', label: 'X', issues: ['A'] })], edges: [] };
    const b = { nodes: [createNode({ id: 'x', type: 'collection', surface: 'firebase', label: 'X', issues: ['B'] })], edges: [] };
    const merged = mergeGraphs([a, b]);
    expect(merged.nodes.length).toBe(1);
    expect(merged.nodes[0].issues.sort()).toEqual(['A', 'B']);
  });
  it('dedupes edges by id', () => {
    const e = createEdge({ source: 'a', target: 'b', type: 'reads', surfaces: ['bot'] });
    const merged = mergeGraphs([{ nodes: [], edges: [e] }, { nodes: [], edges: [e] }]);
    expect(merged.edges.length).toBe(1);
  });
});

describe('createSnapshot', () => {
  it('wraps graph with metadata and stats', () => {
    const snap = createSnapshot({
      nodes: [createNode({ id: 'x', type: 'collection', surface: 'firebase', label: 'X', health: 'red' })],
      edges: [], issues: [], flows: [],
      gitCommit: 'abc123', gitBranch: 'dev', gitDirty: false,
    });
    expect(snap.stats.nodeCount).toBe(1);
    expect(snap.stats.redNodes).toBe(1);
    expect(snap.gitCommit).toBe('abc123');
    expect(typeof snap.timestamp).toBe('string');
  });
});
