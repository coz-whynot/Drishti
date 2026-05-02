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
  // Plugins can contribute four things:
  //   nodes, edges, issues — flat arrays merged across plugins
  //   schema               — per-collection field rows merged keyed by
  //                          collection name (later plugins extend / override
  //                          rows from earlier plugins)
  const all = { nodes: [], edges: [], issues: [], schema: {} };
  for (const p of activePlugins) {
    for (const parserPath of p.parsers || []) {
      try {
        const abs = path.resolve(p.root, parserPath);
        const mod = await import(pathToFileURL(abs).href);
        const out = await mod.default(ctx);
        if (out?.nodes) all.nodes.push(...out.nodes);
        if (out?.edges) all.edges.push(...out.edges);
        if (out?.issues) all.issues.push(...out.issues);
        if (out?.schema) {
          for (const [coll, rows] of Object.entries(out.schema)) {
            if (!all.schema[coll]) all.schema[coll] = rows;
            else all.schema[coll] = mergeSchemaRows(all.schema[coll], rows);
          }
        }
      } catch (err) {
        console.error(`[drishti] plugin "${p.name}" parser ${parserPath} failed:`, err.message);
      }
    }
  }
  return all;
}

// Merge two arrays of field rows for the same collection. Rows are matched by
// `field` name. Later rows extend earlier ones (set fields that were null /
// concat refs). Drift reasons are unioned. This lets, e.g., a D-Hash-specific
// plugin add `doc: true` to rows the generic firestore plugin found.
function mergeSchemaRows(a, b) {
  const byField = new Map(a.map(r => [r.field, { ...r }]));
  for (const incoming of b) {
    const cur = byField.get(incoming.field);
    if (!cur) {
      byField.set(incoming.field, { ...incoming });
      continue;
    }
    cur.doc = cur.doc || incoming.doc;
    cur.firebase = cur.firebase != null ? cur.firebase : incoming.firebase;
    cur.app = cur.app || incoming.app;
    cur.bot = cur.bot || incoming.bot;
    cur.website = cur.website || incoming.website;
    cur.refs = [...(cur.refs || []), ...(incoming.refs || [])];
    cur.drift = [...new Set([...(cur.drift || []), ...(incoming.drift || [])])];
    cur.meta = { ...(cur.meta || {}), ...(incoming.meta || {}) };
  }
  return [...byField.values()];
}
