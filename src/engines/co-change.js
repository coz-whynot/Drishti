/**
 * co-change.js -- git-log peer detection.
 *
 * Pure-ish: runs `git log --name-only --since=...` once, parses commits,
 * builds a Map of file -> peer files that co-changed at least N times.
 *
 * Filters:
 *   - skip merge commits (the 2nd parent's diff)
 *   - keep only paths under bot/, app/lib/, website/src/, plus a small
 *     allowlist of root-level docs / rules / index json
 *
 * Output:
 *   {
 *     peers: Map<string, Array<{ path: string, count: number }>>,  // top peers per file
 *     totalCommits: number,
 *   }
 */
import { spawnSync } from 'node:child_process';

// Default "source file" classifier — used to filter git history down to the
// files that actually matter for co-change analysis. Extensions cover the
// common languages we ship parsers for. Plugins can extend this via
// `extraExtensions` / `extraExactPaths` in computeCoChange options if their
// project has source files in unusual paths or formats.
const DEFAULT_SOURCE_EXTS = [
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.dart', '.go', '.rs', '.java', '.kt',
  '.rb', '.php', '.swift', '.c', '.cc', '.cpp', '.h', '.hpp',
  '.cs', '.scala', '.sql',
  '.rules', '.proto', '.graphql',
];

function isSource(p) {
  if (!p) return false;
  for (const ext of DEFAULT_SOURCE_EXTS) if (p.endsWith(ext)) return true;
  return false;
}

/**
 * Parse `git log --name-only --pretty=format:COMMIT %H %P` output into commits.
 * Each commit is { hash, parents, files: [...] }. Merge commits (>1 parent)
 * are dropped here.
 */
export function parseGitLog(stdout) {
  const lines = stdout.split('\n');
  const commits = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (cur) commits.push(cur);
      cur = null;
      continue;
    }
    if (line.startsWith('COMMIT ')) {
      if (cur) commits.push(cur);
      const rest = line.slice('COMMIT '.length).split(/\s+/);
      const [hash, ...parents] = rest;
      cur = { hash, parents, files: [] };
    } else if (cur) {
      cur.files.push(line);
    }
  }
  if (cur) commits.push(cur);
  // Drop merges (2+ parents)
  return commits.filter(c => (c.parents || []).length < 2);
}

/**
 * Build co-change peers from parsed commits.
 * For each commit's filtered file list, increment count[a][b] for every
 * pair (a,b) with a != b. Keep only pairs with count >= minTogether.
 */
export function buildPeers(commits, minTogether = 3) {
  const co = new Map(); // file -> Map<peer, count>
  function bump(a, b) {
    let m = co.get(a);
    if (!m) { m = new Map(); co.set(a, m); }
    m.set(b, (m.get(b) || 0) + 1);
  }
  for (const c of commits) {
    const files = c.files.filter(isSource);
    if (files.length < 2) continue;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        bump(files[i], files[j]);
        bump(files[j], files[i]);
      }
    }
  }
  const peers = new Map();
  for (const [file, peerMap] of co) {
    const list = [];
    for (const [p, count] of peerMap) {
      if (count >= minTogether) list.push({ path: p, count });
    }
    if (list.length) {
      list.sort((a, b) => b.count - a.count);
      peers.set(file, list.slice(0, 5));
    }
  }
  return peers;
}

/**
 * Run git log and return co-change peers map.
 * Never throws -- returns { peers: empty Map, totalCommits: 0 } on failure.
 */
export async function computeCoChange({ repoRoot, sinceDays = 180, minTogether = 3 } = {}) {
  if (!repoRoot) return { peers: new Map(), totalCommits: 0, available: false, reason: 'no repoRoot' };
  let result;
  try {
    result = spawnSync('git', [
      'log',
      `--since=${sinceDays}.days.ago`,
      '--name-only',
      '--pretty=format:COMMIT %H %P',
      '--no-merges',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15000,
      windowsHide: true,
    });
  } catch (err) {
    return { peers: new Map(), totalCommits: 0, available: false, reason: String(err && err.message || err) };
  }
  if (result.error || result.status !== 0) {
    return {
      peers: new Map(),
      totalCommits: 0,
      available: false,
      reason: result.error ? String(result.error.message) : `git exit ${result.status}`,
    };
  }
  const commits = parseGitLog(result.stdout || '');
  const peers = buildPeers(commits, minTogether);
  return { peers, totalCommits: commits.length, available: true };
}
