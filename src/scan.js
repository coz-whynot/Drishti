#!/usr/bin/env node
// scan.js — entry point. Takes a project root, discovers + activates plugins,
// runs all parsers, merges into a snapshot, writes JSON + builds the dashboard.
//
// CLI: `node src/scan.js <projectRoot>` (defaults to current working directory)
//
// STATUS: v0.1.0-alpha skeleton. Plugin loader works; built-in plugins are
// stubs (Phase D). External plugins under `plugins/` are auto-loaded if
// present (gitignored — bring your own).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverPlugins, detectActive, runParsers } from './plugin-loader.js';
import { createSnapshot } from './model.js';
import { combine } from './combine.js';
import { combineSchema } from './combine-schema.js';
import { readGitInfo } from './git-info.js';
import { buildFileTree } from './file-tree.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

export async function runScan({ projectRoot, outputDir, writeHtml = true }) {
  const t0 = Date.now();
  const gitInfo = await readGitInfo(projectRoot).catch(() => ({ commit: 'unknown', branch: 'unknown', dirty: false }));

  // Build a quick fileList for plugins that need it during detection.
  const fileList = await collectFiles(projectRoot, 0);

  const plugins = await discoverPlugins({ projectRoot, repoRoot: REPO_ROOT });
  const active = await detectActive(plugins, { projectRoot, fileList });
  console.log(`[drishti] discovered ${plugins.length} plugin(s), ${active.length} active: ${active.map(p => p.name).join(', ') || 'none'}`);

  const ctx = { projectRoot, fileList, repoRoot: REPO_ROOT };
  const parsed = await runParsers(active, ctx);

  const { nodes, edges } = combine({
    graphs: [parsed],
    issues: parsed.issues,
    i18n: { gaps: [], totalEnKeys: 0, totalHiKeys: 0 },
    coChange: { peers: new Map(), totalCommits: 0, available: false },
  });

  const snapshot = createSnapshot({
    nodes, edges,
    issues: parsed.issues,
    flows: [],
    gitCommit: gitInfo.commit,
    gitBranch: gitInfo.branch,
    gitDirty: gitInfo.dirty,
  });
  snapshot.projectRoot = projectRoot;
  snapshot.projectName = path.basename(projectRoot);
  snapshot.activePlugins = active.map(p => p.name);
  // Schema rows come from any plugin that contributes them (currently the
  // firestore plugin; future Prisma/SQL/Mongoose plugins will too).
  snapshot.schema = parsed.schema || {};
  snapshot.schemaSources = { docWarnings: [], firebaseSampledAt: null };

  // File tree for the Files tab — walks the project, inlines small text files.
  // Independent of plugins so it works on any project type.
  snapshot.fileTree = await buildFileTree({ projectRoot });

  await fs.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const snapshotPath = path.join(outputDir, `${stamp}-${gitInfo.commit}.json`);
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
  await fs.writeFile(path.join(outputDir, 'current.json'), JSON.stringify(snapshot, null, 2));

  let htmlPath = null;
  if (writeHtml) {
    const { buildHtml } = await import('./ui/build.js');
    htmlPath = path.join(REPO_ROOT, 'drishti.html');
    await buildHtml(snapshot, htmlPath);
  }
  return { snapshot, snapshotPath, htmlPath, elapsedMs: Date.now() - t0 };
}

async function collectFiles(dir, depth, out = []) {
  if (depth > 6) return out;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', '.next', '.dart_tool', '__pycache__', 'venv', '.venv'].includes(e.name)) continue;
      await collectFiles(full, depth + 1, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const outputDir = path.join(REPO_ROOT, 'drishti-scans');
  const result = await runScan({ projectRoot, outputDir, writeHtml: true });
  console.log(`Scanned ${result.snapshot.stats.nodeCount} nodes, ${result.snapshot.stats.edgeCount} edges in ${result.elapsedMs}ms`);
  if (result.htmlPath) console.log(`Dashboard: ${result.htmlPath}`);
}
