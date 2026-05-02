import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parseDart from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'test-fixtures', 'sample');

describe('parseDart', () => {
  it('emits a module node per .dart file', async () => {
    const r = await parseDart({ projectRoot: FIXTURE });
    const modules = r.nodes.filter(n => n.type === 'module').map(n => n.label).sort();
    expect(modules).toEqual(['app.dart', 'config.dart', 'user_service.dart']);
  });

  it('emits class nodes', async () => {
    const r = await parseDart({ projectRoot: FIXTURE });
    const classes = r.nodes.filter(n => n.type === 'class').map(n => n.label).sort();
    expect(classes).toContain('App');
    expect(classes).toContain('Config');
    expect(classes).toContain('UserService');
  });

  it('emits function nodes including async methods', async () => {
    const r = await parseDart({ projectRoot: FIXTURE });
    const fnNames = r.nodes.filter(n => n.type === 'function').map(n => n.label);
    expect(fnNames).toContain('helper()');
    expect(fnNames).toContain('loadData()');
    expect(fnNames).toContain('run()');
  });

  it('flags empty catch block', async () => {
    const r = await parseDart({ projectRoot: FIXTURE });
    const run = r.nodes.find(n => n.label === 'run()');
    expect(run.meta.silentFailure).toBe(true);
    expect(r.issues.some(i => i.id.includes('SILENT'))).toBe(true);
  });

  it('flags missing await on Future-returning function with .then() in body', async () => {
    const r = await parseDart({ projectRoot: FIXTURE });
    const bad = r.nodes.find(n => n.label === 'badAsync()');
    expect(bad.meta.missingAwait).toBe(true);
    expect(r.issues.some(i => i.id.includes('AWAIT'))).toBe(true);
  });

  it('resolves package: imports against pubspec name + lib/', async () => {
    const r = await parseDart({ projectRoot: FIXTURE });
    const importsEdges = r.edges.filter(e => e.type === 'imports');
    const appModuleId = r.nodes.find(n => n.label === 'app.dart').id;
    const fromApp = importsEdges.filter(e => e.source === appModuleId);
    const targets = fromApp.map(e => e.target);
    expect(targets.some(t => t.endsWith('.user_service'))).toBe(true);
    expect(targets.some(t => t.endsWith('.config'))).toBe(true);
  });

  it('skips dart: stdlib imports and 3rd-party package: imports', async () => {
    const r = await parseDart({ projectRoot: FIXTURE });
    const importsEdges = r.edges.filter(e => e.type === 'imports');
    expect(importsEdges.every(e => !e.target.includes('dart.async'))).toBe(true);
  });

  it('skips generated .g.dart and .freezed.dart files', async () => {
    const r = await parseDart({ projectRoot: FIXTURE });
    const modules = r.nodes.filter(n => n.type === 'module').map(n => n.label);
    expect(modules.every(m => !m.endsWith('.g.dart'))).toBe(true);
    expect(modules.every(m => !m.endsWith('.freezed.dart'))).toBe(true);
  });

  it('handles missing projectRoot gracefully', async () => {
    const r = await parseDart({ projectRoot: '/nonexistent/path' });
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});
