import { describe, it, expect } from 'vitest';
import { computeBlastRadius } from './blast-radius.js';
import { createNode, createEdge } from '../model.js';

function fixtureSnapshot() {
  const nodes = [
    createNode({ id: 'firestore.users', type: 'collection', surface: 'firebase', label: 'users', file: 'db/firestore.rules' }),
    createNode({ id: 'service.handler.update_user', type: 'handler', surface: 'service', label: 'update_user', file: 'service/handlers/user_handler.py', owner: 'team-a' }),
    createNode({ id: 'web.fs.users', type: 'function', surface: 'web', label: 'users.ts', file: 'web/src/lib/users.ts' }),
    createNode({ id: 'mobile.fs.user_service', type: 'function', surface: 'mobile', label: 'UserService', file: 'mobile/lib/services/user_service.dart' }),
    createNode({ id: 'firestore.audit_log', type: 'collection', surface: 'firebase', label: 'audit_log', file: 'db/firestore.rules' }),
  ];
  const edges = [
    createEdge({ source: 'service.handler.update_user', target: 'firestore.users', type: 'writes', surfaces: ['service'] }),
    createEdge({ source: 'web.fs.users', target: 'firestore.users', type: 'reads', surfaces: ['web'] }),
    createEdge({ source: 'mobile.fs.user_service', target: 'firestore.users', type: 'reads', surfaces: ['mobile'] }),
    createEdge({ source: 'mobile.fs.user_service', target: 'firestore.audit_log', type: 'reads', surfaces: ['mobile'] }),
  ];
  const issues = [
    { id: 'SEC-X', title: 'Sensitive field in users not masked', severity: 'CRITICAL', source: 'security-audit.md', fileRef: 'db/firestore.rules', nodeIds: [], firstSeenAt: null, openFor: 0, sourceLineRef: '' },
  ];
  return { nodes, edges, issues };
}

describe('computeBlastRadius', () => {
  it('finds all surfaces touching a renamed field', () => {
    const r = computeBlastRadius(fixtureSnapshot(), {
      kind: 'renameField', collection: 'users', from: 'oldField', to: 'newField',
    });
    expect(r.totalFiles).toBeGreaterThanOrEqual(4);
    expect(r.surfaces.firebase.length).toBeGreaterThanOrEqual(1);
  });

  it('returns warning when seed node not found', () => {
    const r = computeBlastRadius(fixtureSnapshot(), {
      kind: 'renameField', collection: 'nonexistent', from: 'a', to: 'b',
    });
    expect(r.warning).toBeDefined();
    expect(r.totalFiles).toBe(0);
  });

  it('attaches related issues for the affected files', () => {
    const r = computeBlastRadius(fixtureSnapshot(), {
      kind: 'renameField', collection: 'users', from: 'oldField', to: 'newField',
    });
    expect(r.relatedIssues.length).toBeGreaterThanOrEqual(1);
    expect(r.relatedIssues.some(i => i.id === 'SEC-X')).toBe(true);
  });

  it('produces a migration order suggestion', () => {
    const r = computeBlastRadius(fixtureSnapshot(), {
      kind: 'renameField', collection: 'users', from: 'oldField', to: 'newField',
    });
    expect(Array.isArray(r.migrationOrder)).toBe(true);
    expect(r.migrationOrder.length).toBeGreaterThanOrEqual(5);
    expect(r.migrationOrder.some(s => /Phase A/.test(s))).toBe(true);
  });

  it('handles deleteHandler change kind', () => {
    const r = computeBlastRadius(fixtureSnapshot(), {
      kind: 'deleteHandler', handler: 'service.handler.update_user',
    });
    expect(r.seedNodeIds).toEqual(['service.handler.update_user']);
    expect(r.totalFiles).toBeGreaterThanOrEqual(1);
  });

  it('throws on missing change kind', () => {
    expect(() => computeBlastRadius(fixtureSnapshot(), {})).toThrow();
  });
});
