import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parseTypescript from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'test-fixtures', 'sample');

describe('parseTypescript', () => {
  it('emits a module node per .ts file', async () => {
    const r = await parseTypescript({ projectRoot: FIXTURE });
    const modules = r.nodes.filter(n => n.type === 'module').map(n => n.label).sort();
    expect(modules).toEqual(['app.ts', 'config.ts', 'utils.ts']);
  });

  it('emits class nodes', async () => {
    const r = await parseTypescript({ projectRoot: FIXTURE });
    const classes = r.nodes.filter(n => n.type === 'class').map(n => n.label).sort();
    expect(classes).toContain('App');
    expect(classes).toContain('Settings');
  });

  it('emits function nodes for declared functions, methods, and arrow assignments', async () => {
    const r = await parseTypescript({ projectRoot: FIXTURE });
    const fnNames = r.nodes.filter(n => n.type === 'function').map(n => n.label);
    expect(fnNames).toContain('helper()');
    expect(fnNames).toContain('computeTotal()');
    expect(fnNames).toContain('arrowFn()');
    // method (declared inside class) should be picked up
    expect(fnNames).toContain('run()');
  });

  it('flags swallowed promise (.catch(() => {}))', async () => {
    const r = await parseTypescript({ projectRoot: FIXTURE });
    const swallow = r.nodes.find(n => n.label === 'swallow()');
    expect(swallow.meta.swallowedPromise).toBe(true);
    expect(swallow.health).toBe('red');
    expect(r.issues.some(i => i.id.includes('SWALLOW'))).toBe(true);
  });

  it('flags empty catch block (try { } catch { })', async () => {
    const r = await parseTypescript({ projectRoot: FIXTURE });
    const run = r.nodes.find(n => n.label === 'run()');
    expect(run.meta.silentFailure).toBe(true);
    expect(r.issues.some(i => i.id.includes('SILENT'))).toBe(true);
  });

  it('resolves relative imports → emits imports edges', async () => {
    const r = await parseTypescript({ projectRoot: FIXTURE });
    const importsEdges = r.edges.filter(e => e.type === 'imports');
    const appModuleId = r.nodes.find(n => n.label === 'app.ts').id;
    const fromApp = importsEdges.filter(e => e.source === appModuleId);
    const targets = fromApp.map(e => e.target);
    expect(targets.some(t => t.endsWith('.utils'))).toBe(true);
    expect(targets.some(t => t.endsWith('.config'))).toBe(true);
  });

  it('skips package imports (`react`, `@scope/x`) — no edge for those', async () => {
    const r = await parseTypescript({ projectRoot: FIXTURE });
    const importsEdges = r.edges.filter(e => e.type === 'imports');
    expect(importsEdges.every(e => !e.target.includes('react'))).toBe(true);
  });

  it('emits contains edges from module to its functions/classes', async () => {
    const r = await parseTypescript({ projectRoot: FIXTURE });
    const appModuleId = r.nodes.find(n => n.label === 'app.ts').id;
    const containsFromApp = r.edges.filter(e => e.source === appModuleId && e.type === 'contains');
    expect(containsFromApp.length).toBeGreaterThanOrEqual(3);
  });

  it('skips .d.ts files (type-only declarations)', async () => {
    const r = await parseTypescript({ projectRoot: FIXTURE });
    const modules = r.nodes.filter(n => n.type === 'module').map(n => n.label);
    expect(modules.every(m => !m.endsWith('.d.ts'))).toBe(true);
  });

  it('handles missing projectRoot gracefully', async () => {
    const r = await parseTypescript({ projectRoot: '/nonexistent/path' });
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});
