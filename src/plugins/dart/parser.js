// Generic Dart / Flutter parser. Same shape as Python + TS parsers:
//
//   { nodes: [...], edges: [...], issues: [...] }
//
// Node types: module · class · function (top-level functions OR methods)
// Edge types: contains (module → fn/class) · imports (module → module)
//
// Detections:
//   - missing await: a function returns Future<…> but body has Future calls
//                    without await — common Flutter foot-gun. MEDIUM issue.
//   - empty catch:   try { ... } catch (e) {}                            MEDIUM
//   - high complex:  function complexity > 25                             HIGH

import fs from 'node:fs/promises';
import path from 'node:path';
import { createNode, createEdge } from '../../model.js';
import { computeComplexitiesForFile } from '../../engines/complexity.js';

const SKIP_DIRS = new Set([
  'build', '.dart_tool', 'ios', 'android', 'macos', 'linux', 'windows', 'web',
  '.git', '.idea', '.vscode', 'node_modules',
  'test-fixtures', 'fixtures',
  // Flutter generated dirs
  '.pub-cache', '.flutter-plugins', 'gen_l10n',
]);

export default async function parseDart(ctx) {
  const { projectRoot } = ctx;
  const dartFiles = await collectDartFiles(projectRoot);

  // Map every project file's package: + relative paths → moduleId so imports
  // can resolve. We support two styles Flutter projects use:
  //   import 'package:my_app/foo/bar.dart'  → resolved against `lib/foo/bar.dart`
  //   import '../foo/bar.dart'              → relative
  const packageName = await readPackageName(projectRoot);
  const fileMeta = new Map();
  for (const file of dartFiles) {
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
    const moduleId = `dart.module.${relToDotted(rel)}`;
    fileMeta.set(file, { rel, moduleId });
  }

  const nodes = [];
  const edges = [];
  const issues = [];

  for (const file of dartFiles) {
    const meta = fileMeta.get(file);
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text == null) continue;
    const lines = text.split('\n');

    nodes.push(createNode({
      id: meta.moduleId, type: 'module', surface: 'dart',
      label: path.basename(file),
      file: meta.rel,
      health: 'green',
      meta: { lineCount: lines.length },
    }));

    // Functions via shared engine — Dart regex matches function-shape signatures
    // including methods. Some false positives (control flow already filtered there).
    const fns = computeComplexitiesForFile(text, 'dart');
    const seen = new Set();
    for (const fn of fns) {
      const key = `${fn.name}@${fn.startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const id = `dart.function.${relToDotted(meta.rel)}.${fn.name}@L${fn.startLine}`;
      const body = lines.slice(fn.startLine - 1, fn.endLine).join('\n');
      const sig = lines[fn.startLine - 1] || '';
      const missingAwait = hasMissingAwait(sig, body);
      const silent = hasEmptyCatch(body);
      const complexity = fn.complexity || 1;
      let health = 'green';
      if (complexity > 25 || missingAwait || silent) health = 'red';
      else if (complexity > 15) health = 'yellow';

      nodes.push(createNode({
        id, type: 'function', surface: 'dart',
        label: fn.name + '()',
        file: meta.rel,
        lineRange: [fn.startLine, fn.endLine],
        health,
        meta: { complexity, missingAwait, silentFailure: silent },
      }));
      edges.push(createEdge({
        source: meta.moduleId, target: id, type: 'contains', surfaces: ['dart'],
      }));

      if (missingAwait) {
        issues.push({
          id: `DART-AWAIT-${id}`, severity: 'MEDIUM',
          title: `${fn.name}() returns a Future but contains unawaited Future calls`,
          source: 'dart-parser', fileRef: `${meta.rel}:${fn.startLine}`,
          nodeIds: [id], firstSeenAt: null, openFor: 0, sourceLineRef: '',
        });
      }
      if (silent) {
        issues.push({
          id: `DART-SILENT-${id}`, severity: 'MEDIUM',
          title: `${fn.name}() has an empty catch block — error is swallowed`,
          source: 'dart-parser', fileRef: `${meta.rel}:${fn.startLine}`,
          nodeIds: [id], firstSeenAt: null, openFor: 0, sourceLineRef: '',
        });
      }
      if (complexity > 25) {
        issues.push({
          id: `DART-CPX-${id}`, severity: 'HIGH',
          title: `${fn.name}() complexity ${complexity} — split into smaller functions`,
          source: 'dart-parser', fileRef: `${meta.rel}:${fn.startLine}`,
          nodeIds: [id], firstSeenAt: null, openFor: 0, sourceLineRef: '',
        });
      }
    }

    for (const cls of extractClasses(text)) {
      const id = `dart.class.${relToDotted(meta.rel)}.${cls.name}`;
      nodes.push(createNode({
        id, type: 'class', surface: 'dart',
        label: cls.name,
        file: meta.rel,
        lineRange: [cls.startLine, cls.endLine],
        health: 'green',
        meta: {},
      }));
      edges.push(createEdge({
        source: meta.moduleId, target: id, type: 'contains', surfaces: ['dart'],
      }));
    }

    const seenEdges = new Set();
    for (const spec of extractImports(text)) {
      const targetId = resolveImport(spec, file, projectRoot, packageName, fileMeta);
      if (!targetId || targetId === meta.moduleId) continue;
      const k = `${meta.moduleId}|${targetId}`;
      if (seenEdges.has(k)) continue;
      seenEdges.add(k);
      edges.push(createEdge({
        source: meta.moduleId, target: targetId, type: 'imports', surfaces: ['dart'],
      }));
    }
  }

  return { nodes, edges, issues };
}

// ===== File walking =====

async function collectDartFiles(root) {
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
      } else if (e.isFile() && e.name.endsWith('.dart')) {
        if (e.name.endsWith('.g.dart') || e.name.endsWith('.freezed.dart')) continue;
        out.push(full);
      }
    }
  }
}

// Read `name:` from pubspec.yaml so package: imports resolve.
async function readPackageName(projectRoot) {
  try {
    const text = await fs.readFile(path.join(projectRoot, 'pubspec.yaml'), 'utf8');
    const m = text.match(/^name:\s*([\w-]+)/m);
    return m ? m[1] : null;
  } catch { return null; }
}

// ===== Class extraction =====
function extractClasses(text) {
  const out = [];
  const lines = text.split('\n');
  // Match `class Name`, `abstract class Name`, `mixin Name`
  const re = /^\s*(?:abstract\s+)?(?:class|mixin)\s+(\w+)/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const startLine = i + 1;
    // Find opening brace by walking forward (signature can span lines via `extends ... with ...`).
    const fileOffset = text.split('\n').slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
    const openIdx = text.indexOf('{', fileOffset);
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

// ===== Imports =====
function extractImports(text) {
  const out = new Set();
  const re = /^\s*(?:import|export)\s+['"]([^'"]+)['"]/gm;
  for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out];
}

function resolveImport(spec, fromFile, projectRoot, packageName, fileMeta) {
  // dart: imports → stdlib, skip
  if (spec.startsWith('dart:')) return null;
  // package:other_pkg/... → 3rd-party, skip
  if (spec.startsWith('package:')) {
    if (!packageName) return null;
    const pkgPrefix = `package:${packageName}/`;
    if (!spec.startsWith(pkgPrefix)) return null;  // different package
    const rel = spec.slice(pkgPrefix.length);
    const candidate = path.join(projectRoot, 'lib', rel);
    return fileMeta.has(candidate) ? fileMeta.get(candidate).moduleId : null;
  }
  // relative
  if (spec.startsWith('./') || spec.startsWith('../') || !spec.includes(':')) {
    const baseDir = path.dirname(fromFile);
    const candidate = path.resolve(baseDir, spec);
    return fileMeta.has(candidate) ? fileMeta.get(candidate).moduleId : null;
  }
  return null;
}

function relToDotted(rel) {
  return rel.replace(/\.dart$/, '').split('/').filter(Boolean).join('.');
}

// ===== Failure-mode detection =====

// try { ... } catch (e) { } OR catch { } — empty body.
function hasEmptyCatch(body) {
  return /catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(body);
}

// Best-effort: function returns `Future<…>` AND body has at least one
// `.then(` call without surrounding await. The engine's startLine can drift
// by a line or two (regex catches the leading `\n`), so we check both the
// passed-in signature line AND the body for the Future declaration.
function hasMissingAwait(signature, body) {
  const declaresFuture = /\bFuture\b/.test(signature) || /\bFuture\s*(?:<[^>]*>)?\s+\w+\s*\(/.test(body);
  if (!declaresFuture) return false;
  for (const line of body.split('\n')) {
    if (line.includes('.then(') && !/\bawait\b/.test(line)) return true;
  }
  return false;
}
