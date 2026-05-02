import { describe, it, expect } from 'vitest';
import { readGitInfo } from './git-info.js';

describe('readGitInfo', () => {
  it('returns commit + branch + dirty flag', async () => {
    const info = await readGitInfo(process.cwd());
    expect(typeof info.commit).toBe('string');
    expect(info.commit.length).toBeGreaterThanOrEqual(7);
    expect(typeof info.branch).toBe('string');
    expect(typeof info.dirty).toBe('boolean');
  });
  it('returns placeholder for non-git path', async () => {
    const info = await readGitInfo('/nonexistent-path-xyz-12345');
    expect(info.commit).toBe('unknown');
    expect(info.branch).toBe('unknown');
    expect(info.dirty).toBe(false);
  });
});
