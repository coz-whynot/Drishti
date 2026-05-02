// Generic TypeScript / JavaScript parser. Handles .ts / .tsx / .js / .jsx /
// .mjs / .cjs files. Same shape as the Python parser:
//
//   { nodes: [...], edges: [...], issues: [...] }
//
// Node types: module · class · function (functions / methods / arrow fns)
// Edge types: contains (module → fn/class) · imports (module → module)
//
// Detections beyond complexity:
//   - swallowed promise:    .catch(() => {})           → MEDIUM issue
//   - swallowed promise:    .catch(() => null)         → MEDIUM issue
//   - silent try/catch:     try { ... } catch { }      → MEDIUM issue (empty catch)
//   - high complexity:      function complexity > 25   → HIGH issue, node turns red

import fs from 'node:fs/promises';
import path from 'node:path';
import { createNode, createEdge } from '../../model.js';
import { computeComplexitiesForFile } from '../../engines/complexity.js';

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', '.nuxt', '.svelte-kit',
  'out', 'coverage', '.git', '.idea', '.vscode',
  'test-fixtures', 'fixtures', '__tests__',  // own fixtures excluded
]);

export default async function parseTypescript(ctx) {
  const { projectRoot } = ctx;
  const tsFiles = await collectTsFiles(projectRoot);

  // moduleId per file. Key the lookup by both:
  //   - project-relative dotted form  (e.g. `src.lib.users`)
  //   - basename without extension    (e.g. `users` — for shallow imports)
  const fileMeta = new Map();
  const moduleByDotted = new Map();
  for (const file of tsFiles) {
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
    const moduleId = `ts.module.${relToDotted(rel)}`;
    fileMeta.set(file, { rel, moduleId });
    moduleByDotted.set(relToDotted(rel), moduleId);
    moduleByDotted.set(path.basename(file, path.extname(file)), moduleId);
  }

  const nodes = [];
  const edges = [];
  const issues = [];

  for (const file of tsFiles) {
    const meta = fileMeta.get(file);
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text == null) continue;
    const lines = text.split('\n');

    nodes.push(createNode({
      id: meta.moduleId, type: 'module', surface: 'typescript',
      label: path.basename(file),
      file: meta.rel,
      health: 'green',
      meta: { lineCount: lines.length },
    }));

    // Functions via the shared complexity engine — covers function decls,
    // arrow assignments, and methods. The engine's regex is permissive so a
    // few false positives are possible (e.g. object literals named like fns);
    // we filter obvious noise here.
    const langKey = file.endsWith('.ts') || file.endsWith('.tsx') ? 'typescript' : 'javascript';
    const fns = computeComplexitiesForFile(text, langKey);
    const seenFnKeys = new Set();
    for (const fn of fns) {
      // Dedupe — the engine's compound regex can match the same function twice.
      const key = `${fn.name}@${fn.startLine}`;
      if (seenFnKeys.has(key)) continue;
      seenFnKeys.add(key);

      const id = `ts.function.${relToDotted(meta.rel)}.${fn.name}@L${fn.startLine}`;
      const body = lines.slice(fn.startLine - 1, fn.endLine).join('\n');
      const swallow = hasSwallowedPromise(body);
      const silent = hasEmptyCatch(body);
      const complexity = fn.complexity || 1;
      let health = 'green';
      if (complexity > 25 || swallow || silent) health = 'red';
      else if (complexity > 15) health = 'yellow';

      nodes.push(createNode({
        id, type: 'function', surface: 'typescript',
        label: fn.name + '()',
        file: meta.rel,
        lineRange: [fn.startLine, fn.endLine],
        health,
        meta: { complexity, swallowedPromise: swallow, silentFailure: silent },
      }));
      edges.push(createEdge({
        source: meta.moduleId, target: id, type: 'contains', surfaces: ['typescript'],
      }));

      if (swallow) {
        issues.push({
          id: `TS-SWALLOW-${id}`, severity: 'MEDIUM',
          title: `${fn.name}() swallows a promise rejection (.catch(() => {}))`,
          source: 'typescript-parser', fileRef: `${meta.rel}:${fn.startLine}`,
          nodeIds: [id], firstSeenAt: null, openFor: 0, sourceLineRef: '',
        });
      }
      if (silent) {
        issues.push({
          id: `TS-SILENT-${id}`, severity: 'MEDIUM',
          title: `${fn.name}() has an empty catch block — error is swallowed`,
          source: 'typescript-parser', fileRef: `${meta.rel}:${fn.startLine}`,
          nodeIds: [id], firstSeenAt: null, openFor: 0, sourceLineRef: '',
        });
      }
      if (complexity > 25) {
        issues.push({
          id: `TS-CPX-${id}`, severity: 'HIGH',
          title: `${fn.name}() complexity ${complexity} — split into smaller functions`,
          source: 'typescript-parser', fileRef: `${meta.rel}:${fn.startLine}`,
          nodeIds: [id], firstSeenAt: null, openFor: 0, sourceLineRef: '',
        });
      }
    }

    // Classes — separate scan since the complexity engine doesn't track them.
    for (const cls of extractClasses(text)) {
      const id = `ts.class.${relToDotted(meta.rel)}.${cls.name}`;
      nodes.push(createNode({
        id, type: 'class', surface: 'typescript',
        label: cls.name,
        file: meta.rel,
        lineRange: [cls.startLine, cls.endLine],
        health: 'green',
        meta: {},
      }));
      edges.push(createEdge({
        source: meta.moduleId, target: id, type: 'contains', surfaces: ['typescript'],
      }));
    }

    // Imports → module-to-module edges (only for in-project paths).
    const seenEdges = new Set();
    for (const spec of extractImports(text)) {
      const targetId = resolveImport(spec, file, projectRoot, fileMeta);
      if (!targetId || targetId === meta.moduleId) continue;
      const k = `${meta.moduleId}|${targetId}`;
      if (seenEdges.has(k)) continue;
      seenEdges.add(k);
      edges.push(createEdge({
        source: meta.moduleId, target: targetId, type: 'imports', surfaces: ['typescript'],
      }));
    }
  }

  return { nodes, edges, issues };
}

// ===== File walking =====

async function collectTsFiles(root) {
  const out = [];
  await walk(root);
  return out;
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full);
      } else if (e.isFile() && EXTS.some(x => e.name.endsWith(x))) {
        if (e.name.endsWith('.d.ts')) continue;  // type-only declarations
        out.push(full);
      }
    }
  }
}

// ===== Class extraction =====
function extractClasses(text) {
  const out = [];
  const lines = text.split('\n');
  const re = /^\s*(?:export\s+(?:default\s+)?(?:abstract\s+)?)?class\s+(\w+)/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const startLine = i + 1;
    // Find the opening brace and walk to its match.
    const openIdx = text.indexOf('{', text.split('\n').slice(0, i + 1).join('\n').length - lines[i].length);
    let endLine = startLine;
    if (openIdx >= 0) {
      const closeIdx = matchBrace(text, openIdx);
      if (closeIdx > 0) endLine = text.slice(0, closeIdx).split('\n').length;
    }
    out.push({ name: m[1], startLine, endLine });
  }
  return out;
}

function matchBrace(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ===== Import extraction =====
//
// Matches static imports only (no dynamic `import('x')` for v0.3 — those add
// noise from string-template paths). Captures both:
//   import x from 'spec'
//   import { a, b } from 'spec'
//   import 'spec'                     (side-effect import)
//   export { x } from 'spec'
//   export * from 'spec'
function extractImports(text) {
  const out = new Set();
  const re = /^\s*(?:import|export)\b[^'"]*?\s*['"]([^'"]+)['"]/gm;
  for (const m of text.matchAll(re)) {
    out.add(m[1]);
  }
  return [...out];
}

function resolveImport(spec, fromFile, projectRoot, fileMeta) {
  if (!spec) return null;
  // Skip bare package imports (e.g. 'react', '@scope/pkg') — only relative + alias paths.
  if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('@/')) return null;
  // Map TS path alias `@/` → projectRoot/src by convention. Fall back to projectRoot.
  let baseDir;
  let resolved;
  if (spec.startsWith('@/')) {
    baseDir = path.join(projectRoot, 'src');
    resolved = path.join(baseDir, spec.slice(2));
  } else if (spec.startsWith('/')) {
    resolved = path.join(projectRoot, spec.slice(1));
  } else {
    baseDir = path.dirname(fromFile);
    resolved = path.resolve(baseDir, spec);
  }
  // Try resolved as-is + with each extension + as `index.ts/.tsx/.js/.jsx`
  const candidates = [
    resolved,
    ...EXTS.map(x => resolved + x),
    ...EXTS.map(x => path.join(resolved, 'index' + x)),
  ];
  for (const c of candidates) {
    if (fileMeta.has(c)) return fileMeta.get(c).moduleId;
  }
  return null;
}

function relToDotted(rel) {
  return rel.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '').split('/').filter(Boolean).join('.');
}

// ===== Failure-mode detection =====

// .catch(() => {}) — empty arrow body OR body that ignores the error.
function hasSwallowedPromise(body) {
  return /\.catch\s*\(\s*(?:\(\s*\)|[a-zA-Z_$][\w$]*|\(\s*[a-zA-Z_$][\w$]*\s*\))\s*=>\s*(?:\{\s*\}|null|undefined|void\s+0)\s*\)/.test(body);
}

// try { ... } catch { ... } where catch body is empty.
function hasEmptyCatch(body) {
  return /catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(body);
}
