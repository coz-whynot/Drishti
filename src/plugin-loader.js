// Plugin loader — discovers, detects, and runs plugins.
//
// Plugin discovery order:
//   1. Built-in plugins under `src/plugins/<name>/`
//   2. External plugins under `<repoRoot>/plugins/<name>/` (gitignored)
//      → user-installed plugins live here
//   3. Local plugins under `<repoRoot>/plugins/local/<name>/` (gitignored)
//
// Each plugin directory must contain `manifest.json` with shape:
//   {
//     "name": "string",
//     "version": "string",
//     "detect": "./detect.js",     // optional — if omitted, always activates
//     "parsers": ["./parser1.js"]  // each module exports default async fn (ctx) → { nodes, edges, issues? }
//   }
//
// detect.js exports default async fn ({ projectRoot, fileList }) → boolean | { active: boolean, confidence: number }
// Plugins are activated when detect() returns true (or { active: true }).
//
// Each parser receives ctx = { projectRoot, snapshot (read-only so far), pluginConfig }
// and returns its contribution to the snapshot.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function discoverPlugins({ projectRoot, repoRoot }) {
  const builtinDir = path.join(__dirname, 'plugins');
  const externalDir = path.join(repoRoot || __dirname, '..', 'plugins');
  const localDir = path.join(externalDir, 'local');

  const plugins = [];
  for (const dir of [builtinDir, externalDir, localDir]) {
    plugins.push(...await loadPluginsInDir(dir));
  }
  return plugins;
}

async function loadPluginsInDir(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'local') continue;     // recursed into separately
    const root = path.join(dir, e.name);
    const manifestPath = path.join(root, 'manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch {
      continue;   // not a plugin folder, skip
    }
    out.push({ ...manifest, root });
  }
  return out;
}

export async function detectActive(plugins, ctx) {
  const active = [];
  for (const p of plugins) {
    if (!p.detect) {
      active.push(p);
      continue;
    }
    try {
      const detectPath = path.resolve(p.root, p.detect);
      const mod = await import(pathToFileURL(detectPath).href);
      const result = await mod.default(ctx);
      const isActive = typeof result === 'object' ? !!result.active : !!result;
      if (isActive) active.push(p);
    } catch (err) {
      console.error(`[drishti] plugin "${p.name}" detect() failed:`, err.message);
    }
  }
  return active;
}

export async function runParsers(activePlugins, ctx) {
  const all = { nodes: [], edges: [], issues: [] };
  for (const p of activePlugins) {
    for (const parserPath of p.parsers || []) {
      try {
        const abs = path.resolve(p.root, parserPath);
        const mod = await import(pathToFileURL(abs).href);
        const out = await mod.default(ctx);
        if (out?.nodes) all.nodes.push(...out.nodes);
        if (out?.edges) all.edges.push(...out.edges);
        if (out?.issues) all.issues.push(...out.issues);
      } catch (err) {
        console.error(`[drishti] plugin "${p.name}" parser ${parserPath} failed:`, err.message);
      }
    }
  }
  return all;
}
