import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGitLog, buildPeers, computeCoChange } from './co-change.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function gitAvailable() {
  try {
    const r = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    return r && r.status === 0;
  } catch {
    return false;
  }
}
const HAS_GIT = gitAvailable();

describe('parseGitLog', () => {
  it('parses commits with file lists', () => {
    const stdout = [
      'COMMIT abc123 def456',
      'bot/app.py',
      'website/src/App.tsx',
      '',
      'COMMIT def456 ghi789',
      'app/lib/main.dart',
      '',
    ].join('\n');
    const commits = parseGitLog(stdout);
    expect(commits.length).toBe(2);
    expect(commits[0].hash).toBe('abc123');
    expect(commits[0].files).toEqual(['bot/app.py', 'website/src/App.tsx']);
    expect(commits[1].files).toEqual(['app/lib/main.dart']);
  });

  it('filters out merge commits (>=2 parents)', () => {
    const stdout = [
      'COMMIT abc123 def456 ghi789',  // merge
      'merged.py',
      '',
      'COMMIT bbb111 ccc222',
      'normal.py',
      '',
    ].join('\n');
    const commits = parseGitLog(stdout);
    expect(commits.length).toBe(1);
    expect(commits[0].hash).toBe('bbb111');
  });
});

describe('buildPeers', () => {
  it('returns peers only when count >= minTogether', () => {
    const commits = [
      { hash: 'a', parents: ['p'], files: ['bot/app.py', 'website/src/App.tsx'] },
      { hash: 'b', parents: ['p'], files: ['bot/app.py', 'website/src/App.tsx'] },
      { hash: 'c', parents: ['p'], files: ['bot/app.py', 'website/src/App.tsx'] },
      { hash: 'd', parents: ['p'], files: ['bot/app.py', 'app/lib/main.dart'] },
    ];
    const peers = buildPeers(commits, 3);
    const botPeers = peers.get('bot/app.py') || [];
    expect(botPeers.length).toBe(1);
    expect(botPeers[0].path).toBe('website/src/App.tsx');
    expect(botPeers[0].count).toBe(3);
    // app/lib/main.dart only co-changed once -- below threshold.
    expect(peers.has('app/lib/main.dart')).toBe(false);
  });

  it('skips non-source paths', () => {
    const commits = [
      { hash: 'a', parents: ['p'], files: ['bot/app.py', 'README.md'] },
      { hash: 'b', parents: ['p'], files: ['bot/app.py', 'README.md'] },
      { hash: 'c', parents: ['p'], files: ['bot/app.py', 'README.md'] },
    ];
    const peers = buildPeers(commits, 3);
    // README.md isn't in our allowlist so it should be filtered.
    expect(peers.has('bot/app.py')).toBe(false);
    expect(peers.has('README.md')).toBe(false);
  });
});

describe('computeCoChange (live repo)', () => {
  it.skipIf(!HAS_GIT)('returns peers map and totalCommits >= 0', async () => {
    const r = await computeCoChange({ repoRoot: REPO_ROOT, sinceDays: 365, minTogether: 2 });
    expect(r.totalCommits).toBeGreaterThanOrEqual(0);
    expect(r.peers).toBeInstanceOf(Map);
  });

  it.skipIf(!HAS_GIT)('returns empty peers when minTogether is huge', async () => {
    const r = await computeCoChange({ repoRoot: REPO_ROOT, sinceDays: 365, minTogether: 100000 });
    expect(r.peers.size).toBe(0);
  });

  it('returns available:false when repoRoot is bogus', async () => {
    const r = await computeCoChange({ repoRoot: '/nonexistent/path/no/repo/here', sinceDays: 30 });
    expect(r.available).toBe(false);
    expect(r.peers.size).toBe(0);
  });
});
