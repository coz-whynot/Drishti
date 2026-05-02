// Generic Python parser — produces module/class/function nodes, import edges,
// complexity warnings, silent-failure flags. Works on any Python codebase.
//
// Output (returned to plugin loader):
//   { nodes: [...], edges: [...], issues: [...] }
//
// Node types this plugin emits:
//   - module    — one per .py file
//   - class     — one per class declaration
//   - function  — one per def / async def (top-level or method)
//
// Edge types:
//   - imports   — module → another in-project module
//   - contains  — module → function/class
//
// Health rules (per function):
//   - red    if complexity > 25 OR has silent failure
//   - yellow if complexity > 15
//   - green  otherwise

import fs from 'node:fs/promises';
import path from 'node:path';
import { createNode, createEdge } from '../../model.js';
import { computeComplexitiesForFile } from '../../engines/complexity.js';

const SKIP_DIRS = new Set([
  '__pycache__', 'venv', '.venv', 'env',
  'node_modules', '.git', 'dist', 'build', '.tox',
  '.pytest_cache', '.mypy_cache', 'site-packages', '.idea', '.vscode',
  // Don't index our own test fixtures when scanning the Drishti repo
  // (they're test data, not real source).
  'test-fixtures', 'fixtures',
]);

// ===== Plugin entrypoint =====

export default async function parsePython(ctx) {
  const { projectRoot } = ctx;
  const pyFiles = await collectPyFiles(projectRoot);

  // Build a map of dotted-module-name → moduleId so import edges can resolve.
  // moduleId is derived from the project-relative path; we ALSO register the
  // bare basename so `from foo import x` resolves even when foo.py lives in a
  // subdirectory (best-effort match — Python's actual resolution is more nuanced).
  const fileMeta = new Map();
  const moduleByDotted = new Map();
  for (const file of pyFiles) {
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
    const moduleId = `python.module.${relToDotted(rel)}`;
    fileMeta.set(file, { rel, moduleId });
    moduleByDotted.set(relToDotted(rel), moduleId);
    moduleByDotted.set(path.basename(file, '.py'), moduleId);
  }

  const nodes = [];
  const edges = [];
  const issues = [];

  for (const file of pyFiles) {
    const meta = fileMeta.get(file);
    // null sentinel for read errors so we still index legitimately-empty files
    // (e.g. `__init__.py` is often 0 bytes but is a real module).
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text == null) continue;
    const lines = text.split('\n');

    // Module node — one per file.
    nodes.push(createNode({
      id: meta.moduleId,
      type: 'module',
      surface: 'python',
      label: path.basename(file),
      file: meta.rel,
      health: 'green',
      meta: { lineCount: lines.length },
    }));

    // Functions via the shared complexity engine.
    const fns = computeComplexitiesForFile(text, 'python');
    for (const fn of fns) {
      const id = `python.function.${relToDotted(meta.rel)}.${fn.name}`;
      const body = lines.slice(fn.startLine, fn.endLine).join('\n');
      const silent = hasSilentFailure(body);
      const complexity = fn.complexity || 1;
      let health = 'green';
      if (complexity > 25 || silent) health = 'red';
      else if (complexity > 15) health = 'yellow';

      nodes.push(createNode({
        id, type: 'function', surface: 'python',
        label: fn.name + '()',
        file: meta.rel,
        lineRange: [fn.startLine, fn.endLine],
        health,
        meta: { complexity, silentFailure: silent },
      }));
      edges.push(createEdge({
        source: meta.moduleId, target: id, type: 'contains', surfaces: ['python'],
      }));
      if (silent) {
        issues.push({
          id: `PY-SILENT-${id}`,
          severity: 'MEDIUM',
          title: `Silent failure in ${fn.name}() — try/except: pass swallows errors`,
          source: 'python-parser',
          fileRef: `${meta.rel}:${fn.startLine}`,
          nodeIds: [id],
          firstSeenAt: null, openFor: 0, sourceLineRef: '',
        });
      }
      if (complexity > 25) {
        issues.push({
          id: `PY-CPX-${id}`,
          severity: 'HIGH',
          title: `${fn.name}() complexity ${complexity} — split into smaller functions`,
          source: 'python-parser',
          fileRef: `${meta.rel}:${fn.startLine}`,
          nodeIds: [id],
          firstSeenAt: null, openFor: 0, sourceLineRef: '',
        });
      }
    }

    // Classes — separate scan since the complexity engine doesn't track them.
    for (const cls of extractClasses(lines)) {
      const id = `python.class.${relToDotted(meta.rel)}.${cls.name}`;
      nodes.push(createNode({
        id, type: 'class', surface: 'python',
        label: cls.name,
        file: meta.rel,
        lineRange: [cls.startLine, cls.endLine],
        health: 'green',
        meta: {},
      }));
      edges.push(createEdge({
        source: meta.moduleId, target: id, type: 'contains', surfaces: ['python'],
      }));
    }

    // Imports → edges between module nodes.
    const imports = extractImports(text);
    const seenEdges = new Set();
    for (const imp of imports) {
      const targetId = resolveImport(imp, file, projectRoot, moduleByDotted);
      if (!targetId || targetId === meta.moduleId) continue;
      const k = `${meta.moduleId}|${targetId}`;
      if (seenEdges.has(k)) continue;
      seenEdges.add(k);
      edges.push(createEdge({
        source: meta.moduleId, target: targetId, type: 'imports', surfaces: ['python'],
      }));
    }
  }

  return { nodes, edges, issues };
}

// ===== File walking =====

async function collectPyFiles(root) {
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
      } else if (e.isFile() && e.name.endsWith('.py')) {
        out.push(full);
      }
    }
  }
}

// ===== Class extraction =====
//
// Walks lines; for any `class Name` declaration at any indent, records the
// block until the next sibling-or-shallower line.
function extractClasses(lines) {
  const out = [];
  const re = /^(\s*)class\s+(\w+)\s*[(:]/;
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(re);
    if (m) {
      const indent = m[1].length;
      const name = m[2];
      const startLine = i + 1;
      let j = i + 1;
      while (j < lines.length) {
        const ln = lines[j];
        if (ln.trim() === '') { j++; continue; }
        const lead = ln.match(/^(\s*)/)[1].length;
        if (lead <= indent) break;
        j++;
      }
      out.push({ name, startLine, endLine: j });
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

// ===== Import extraction =====
// Returns dotted module specs as written: 'os', 'foo.bar', '.x', '..y.z'.
// Handles `import x`, `import x, y`, `import x as a`, `from x import a, b`.

function extractImports(text) {
  const out = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^from\s+(\.{0,3}[\w.]*)\s+import\s+/))) {
      if (m[1]) out.add(m[1]);
    } else if ((m = line.match(/^import\s+(.+)/))) {
      const rest = m[1].replace(/#.*$/, '');
      for (const part of rest.split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].split(/\s+/)[0];
        if (name) out.add(name);
      }
    }
  }
  return [...out];
}

// Resolve an import spec to a moduleId in the project, or null if it's a
// stdlib / 3rd-party import (i.e. doesn't match any project file).
function resolveImport(spec, fromFile, projectRoot, moduleByDotted) {
  if (!spec) return null;
  // Relative import: leading dots count = directory levels up from current file.
  if (spec.startsWith('.')) {
    const dotMatch = spec.match(/^(\.+)(.*)$/);
    if (!dotMatch) return null;
    const ups = dotMatch[1].length - 1;
    const rest = dotMatch[2];
    let baseDir = path.dirname(fromFile);
    for (let i = 0; i < ups; i++) baseDir = path.dirname(baseDir);
    const candidate = rest ? path.join(baseDir, rest.split('.').join(path.sep)) : baseDir;
    return tryModule(candidate, projectRoot, moduleByDotted);
  }
  // Absolute: dotted lookup, then leading-segment lookup.
  return moduleByDotted.get(spec)
    || moduleByDotted.get(spec.split('.')[0])
    || null;
}

function tryModule(absNoExt, projectRoot, moduleByDotted) {
  // Try `<absNoExt>.py` and `<absNoExt>/__init__.py`.
  const rel1 = path.relative(projectRoot, absNoExt + '.py').replace(/\\/g, '/');
  const id1 = `python.module.${relToDotted(rel1)}`;
  if ([...moduleByDotted.values()].includes(id1)) return id1;
  const rel2 = path.relative(projectRoot, path.join(absNoExt, '__init__.py')).replace(/\\/g, '/');
  const id2 = `python.module.${relToDotted(rel2)}`;
  if ([...moduleByDotted.values()].includes(id2)) return id2;
  return null;
}

function relToDotted(rel) {
  return rel.replace(/\.py$/, '').split('/').filter(Boolean).join('.');
}

// ===== Silent-failure detection =====
// Matches:
//   except: pass
//   except SomeError: pass
//   except: \n    pass
function hasSilentFailure(body) {
  return /except[^:\n]*:\s*\n\s*pass\b/.test(body) || /except[^:\n]*:\s*pass\b/.test(body);
}
