import { spawnSync } from 'node:child_process';

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.trim();
}

export async function readGitInfo(cwd) {
  const commit = runGit(['rev-parse', '--short', 'HEAD'], cwd);
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const status = runGit(['status', '--porcelain'], cwd);
  if (commit === null || branch === null) {
    return { commit: 'unknown', branch: 'unknown', dirty: false };
  }
  return { commit, branch, dirty: (status || '').length > 0 };
}
