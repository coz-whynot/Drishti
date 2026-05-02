import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parsePython from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'test-fixtures', 'sample');

describe('parsePython', () => {
  it('emits a module node per .py file', async () => {
    const r = await parsePython({ projectRoot: FIXTURE });
    const modules = r.nodes.filter(n => n.type === 'module');
    const labels = modules.map(n => n.label).sort();
    // helpers/__init__.py is empty but still indexed
    expect(labels).toEqual(['__init__.py', 'app.py', 'config.py', 'utils.py']);
  });

  it('emits function nodes including async def and methods', async () => {
    const r = await parsePython({ projectRoot: FIXTURE });
    const fnNames = r.nodes.filter(n => n.type === 'function').map(n => n.label);
    expect(fnNames).toContain('helper()');
    expect(fnNames).toContain('compute_total()');
    expect(fnNames).toContain('big_function()');
    // method (declared inside class) should be picked up
    expect(fnNames).toContain('run()');
    // async def should be picked up
    expect(fnNames).toContain('fetch_async()');
  });

  it('emits class nodes', async () => {
    const r = await parsePython({ projectRoot: FIXTURE });
    const classes = r.nodes.filter(n => n.type === 'class').map(n => n.label).sort();
    expect(classes).toEqual(['App', 'Settings']);
  });

  it('emits contains edges from module to its functions/classes', async () => {
    const r = await parsePython({ projectRoot: FIXTURE });
    const appModuleId = r.nodes.find(n => n.label === 'app.py').id;
    const containsFromApp = r.edges.filter(e => e.source === appModuleId && e.type === 'contains');
    expect(containsFromApp.length).toBeGreaterThanOrEqual(3); // App class + run + fetch_async + helper
  });

  it('resolves project-internal imports → emits imports edges', async () => {
    const r = await parsePython({ projectRoot: FIXTURE });
    const importsEdges = r.edges.filter(e => e.type === 'imports');
    // app.py imports `helpers.utils` (absolute) AND `.config` (relative)
    const appModuleId = r.nodes.find(n => n.label === 'app.py').id;
    const appImports = importsEdges.filter(e => e.source === appModuleId);
    const targets = appImports.map(e => e.target).sort();
    expect(targets.some(t => t.includes('config'))).toBe(true);
    expect(targets.some(t => t.includes('utils'))).toBe(true);
  });

  it('skips stdlib / 3rd-party imports (no edge for `import os`)', async () => {
    const r = await parsePython({ projectRoot: FIXTURE });
    const importsEdges = r.edges.filter(e => e.type === 'imports');
    expect(importsEdges.every(e => !e.target.endsWith('.os'))).toBe(true);
  });

  it('flags silent failure in App.run() (try/except: pass)', async () => {
    const r = await parsePython({ projectRoot: FIXTURE });
    const runFn = r.nodes.find(n => n.label === 'run()');
    expect(runFn.meta.silentFailure).toBe(true);
    expect(runFn.health).toBe('red');
    expect(r.issues.some(i => i.id.includes('SILENT') && i.fileRef.includes('app.py'))).toBe(true);
  });

  it('reports a complexity score for nested-conditional functions', async () => {
    const r = await parsePython({ projectRoot: FIXTURE });
    const big = r.nodes.find(n => n.label === 'big_function()');
    // The fixture has many nested branches — complexity should be > 5 at least.
    // Exact score depends on the complexity engine; we only assert "non-trivial".
    expect(big.meta.complexity).toBeGreaterThan(5);
  });

  it('handles missing projectRoot gracefully (empty result)', async () => {
    const r = await parsePython({ projectRoot: '/nonexistent/path' });
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});
