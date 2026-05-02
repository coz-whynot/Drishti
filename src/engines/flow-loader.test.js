import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadFlows } from './flow-loader.js';

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drishti-flows-'));
});

afterAll(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

describe('loadFlows', () => {
  it('returns empty when dir missing', async () => {
    const out = await loadFlows({ flowsDir: '/nonexistent-path-xyz-456' });
    expect(out.flows).toEqual([]);
    expect(out.errors).toEqual([]);
  });

  it('parses a valid flow file', async () => {
    const valid = {
      id: 'demo',
      name: 'Demo flow',
      trigger: { surface: 'bot', input: 'demo input' },
      steps: [{ order: 1, nodeId: 'a.b', action: 'read' }],
    };
    await fs.writeFile(path.join(tmpDir, 'demo.json'), JSON.stringify(valid));
    const out = await loadFlows({ flowsDir: tmpDir });
    expect(out.flows.find(f => f.id === 'demo')).toBeDefined();
  });

  it('reports invalid JSON as an error', async () => {
    await fs.writeFile(path.join(tmpDir, 'broken.json'), '{not json');
    const out = await loadFlows({ flowsDir: tmpDir });
    expect(out.errors.some(e => e.file === 'broken.json')).toBe(true);
  });

  it('rejects flow missing required fields', async () => {
    await fs.writeFile(path.join(tmpDir, 'partial.json'), JSON.stringify({ id: 'p' }));
    const out = await loadFlows({ flowsDir: tmpDir });
    expect(out.errors.some(e => e.file === 'partial.json')).toBe(true);
  });

  it('returns flows sorted by id', async () => {
    await fs.writeFile(path.join(tmpDir, 'aaa.json'), JSON.stringify({
      id: 'aaa', name: 'a', trigger: { surface: 'bot', input: 'x' },
      steps: [{ order: 1, nodeId: 'n', action: 'read' }],
    }));
    await fs.writeFile(path.join(tmpDir, 'zzz.json'), JSON.stringify({
      id: 'zzz', name: 'z', trigger: { surface: 'bot', input: 'x' },
      steps: [{ order: 1, nodeId: 'n', action: 'read' }],
    }));
    const out = await loadFlows({ flowsDir: tmpDir });
    const ids = out.flows.map(f => f.id);
    const aIdx = ids.indexOf('aaa');
    const zIdx = ids.indexOf('zzz');
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(zIdx).toBeGreaterThanOrEqual(0);
    expect(aIdx).toBeLessThan(zIdx);
  });
});
