/**
 * deps.js -- dependency vulnerability scan across the four surfaces.
 *
 * Tools used:
 *   - npm audit --json --prefix <dir>     (cwd: repoRoot) for website + drishti
 *   - pip-audit --format json             (cwd: bot)      if on PATH
 *   - flutter pub outdated --json         (cwd: app)      if on PATH
 *
 * Each call uses spawnSync with a 10s timeout. NEVER throws -- always
 * returns { available, advisories, summary } or { available: false, reason }.
 *
 * Wired into scan.js as snapshot.deps so the dashboard can render a
 * Dependencies card on the Overview tab.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const TIMEOUT_MS = 10000;

function safeSpawn(cmd, args, opts) {
  try {
    // On Windows, .cmd / .bat shims require shell:true for spawnSync.
    // (Node's CVE-2024-27980 mitigation locked these down.)
    const useShell = process.platform === 'win32' && (cmd.endsWith('.cmd') || cmd.endsWith('.bat') || /^(npm|flutter|pip-audit)$/.test(cmd));
    const r = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      shell: useShell,
      ...opts,
    });
    if (r.error) return { ok: false, reason: String(r.error.message || r.error) };
    return { ok: true, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (err) {
    return { ok: false, reason: String(err && err.message || err) };
  }
}

function isOnPath(cmd) {
  // Try `<cmd> --version`. On Windows, npm/git/etc. need .cmd shimming, but
  // spawnSync with `npm` works on most setups; we still gracefully degrade.
  const r = safeSpawn(cmd, ['--version'], {});
  if (r.ok && r.status === 0) return true;
  // Windows fallback -- try with .cmd extension via shell.
  if (process.platform === 'win32') {
    const r2 = safeSpawn(cmd + '.cmd', ['--version'], {});
    return r2.ok && r2.status === 0;
  }
  return false;
}

/**
 * Run npm audit in a directory and return { advisories, summary }.
 * npm 7+ JSON shape: { vulnerabilities: { <pkg>: { severity, name, ... } } }
 * npm 6 (legacy):    { advisories: { <id>: { severity, module_name } }, metadata }
 */
export function parseNpmAudit(stdout) {
  let json;
  try { json = JSON.parse(stdout); } catch { return null; }
  const advisories = [];
  const summary = { critical: 0, high: 0, moderate: 0, low: 0 };
  if (json.vulnerabilities && typeof json.vulnerabilities === 'object') {
    for (const [name, info] of Object.entries(json.vulnerabilities)) {
      const sev = String(info.severity || '').toLowerCase();
      if (sev === 'info') continue;
      if (summary[sev] !== undefined) summary[sev] += 1;
      const via = Array.isArray(info.via) ? info.via : [];
      const title = via.map(v => typeof v === 'string' ? v : (v && v.title) || '').filter(Boolean)[0] || '';
      advisories.push({ name, severity: sev, title });
    }
  } else if (json.advisories && typeof json.advisories === 'object') {
    for (const [, info] of Object.entries(json.advisories)) {
      const sev = String(info.severity || '').toLowerCase();
      if (summary[sev] !== undefined) summary[sev] += 1;
      advisories.push({
        name: info.module_name || info.moduleName || '',
        severity: sev,
        title: info.title || '',
      });
    }
  }
  // Sort: critical > high > moderate > low.
  const order = { critical: 0, high: 1, moderate: 2, low: 3 };
  advisories.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  return { advisories, summary };
}

function npmAuditAt(cwd) {
  // Use the directory directly as cwd so package-lock.json is found.
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = safeSpawn(npmCmd, ['audit', '--json'], { cwd });
  if (!r.ok) return { available: false, reason: r.reason };
  // npm audit returns non-zero when vulns are found but JSON is still valid.
  const parsed = parseNpmAudit(r.stdout);
  if (!parsed) {
    return { available: false, reason: 'unparseable npm audit output' };
  }
  return { available: true, ...parsed };
}

function pipAuditAt(cwd) {
  if (!isOnPath('pip-audit')) {
    return { available: false, reason: 'pip-audit not on PATH' };
  }
  const r = safeSpawn('pip-audit', ['--format', 'json'], { cwd });
  if (!r.ok) return { available: false, reason: r.reason };
  let json;
  try { json = JSON.parse(r.stdout); } catch { return { available: false, reason: 'unparseable pip-audit output' }; }
  const advisories = [];
  const summary = { critical: 0, high: 0, moderate: 0, low: 0 };
  // pip-audit shape: { dependencies: [{ name, vulns: [{ id, fix_versions, ... }] }] }
  const deps = Array.isArray(json) ? json : (json.dependencies || []);
  for (const d of deps) {
    const vulns = d.vulns || d.vulnerabilities || [];
    for (const v of vulns) {
      // pip-audit doesn't always include severity; default to 'high'.
      const sev = String(v.severity || 'high').toLowerCase();
      if (summary[sev] !== undefined) summary[sev] += 1;
      else summary.high += 1;
      advisories.push({ name: d.name || '', severity: sev, title: v.id || v.summary || '' });
    }
  }
  return { available: true, advisories, summary };
}

function flutterPubOutdatedAt(cwd) {
  const flutterCmd = process.platform === 'win32' ? 'flutter.bat' : 'flutter';
  if (!isOnPath('flutter') && !isOnPath(flutterCmd)) {
    return { available: false, reason: 'flutter not on PATH' };
  }
  const r = safeSpawn(flutterCmd, ['pub', 'outdated', '--json'], { cwd });
  if (!r.ok) return { available: false, reason: r.reason };
  let json;
  try { json = JSON.parse(r.stdout); } catch { return { available: false, reason: 'unparseable flutter pub outdated output' }; }
  // flutter pub outdated isn't a vuln scanner; we surface "needs upgrade" as moderate.
  const packages = Array.isArray(json.packages) ? json.packages : [];
  const advisories = [];
  const summary = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const p of packages) {
    if (p.isDiscontinued) {
      summary.high += 1;
      advisories.push({ name: p.package, severity: 'high', title: 'discontinued' });
      continue;
    }
    const cur = p.current && p.current.version;
    const latest = p.latest && p.latest.version;
    if (cur && latest && cur !== latest) {
      summary.low += 1;
      advisories.push({ name: p.package, severity: 'low', title: `outdated ${cur} -> ${latest}` });
    }
  }
  return { available: true, advisories, summary };
}

/**
 * computeDeps -- run all four scans, return aggregated object.
 * Always resolves; never throws.
 */
export async function computeDeps({ repoRoot } = {}) {
  if (!repoRoot) {
    const blank = { available: false, reason: 'no repoRoot' };
    return { website: blank, drishti: blank, bot: blank, app: blank };
  }
  const websiteDir = path.join(repoRoot, 'website');
  const drishtiDir = path.join(repoRoot, 'scripts', 'drishti');
  const botDir = path.join(repoRoot, 'bot');
  const appDir = path.join(repoRoot, 'app');

  // npm audit can be slow but parallel-safe.
  const [website, drishti, bot, app] = await Promise.all([
    Promise.resolve().then(() => npmAuditAt(websiteDir)),
    Promise.resolve().then(() => npmAuditAt(drishtiDir)),
    Promise.resolve().then(() => pipAuditAt(botDir)),
    Promise.resolve().then(() => flutterPubOutdatedAt(appDir)),
  ]);

  return { website, drishti, bot, app };
}

// Exposed for testability: lets a test override PATH or stub spawn.
export const _internals = { safeSpawn, isOnPath, npmAuditAt, pipAuditAt, flutterPubOutdatedAt };
