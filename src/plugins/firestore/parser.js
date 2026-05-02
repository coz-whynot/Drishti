// Generic Firestore parser. Activates on any project that:
//   - has a firestore.rules file at the root, in `firebase/`, or in `website/`
//   - OR has any source file importing firebase/firestore | firebase_admin |
//     cloud_firestore | @firebase/firestore
//
// Produces:
//   - Collection nodes from firestore.rules `match /<coll>/{...}` blocks
//   - Indexed-fields metadata from firestore.indexes.json
//   - Field-usage refs by scanning .py/.ts/.tsx/.js/.jsx/.dart files for the
//     three Firestore client SDKs:
//       Python firebase_admin:    db.collection("X").document(...).set({...})
//                                 doc.to_dict()["field"]
//       JS/TS firebase:           setDoc(doc(db,"X",id), {...})
//                                 const { field } = snap.data()
//       Dart cloud_firestore:     FirebaseFirestore.instance.collection('X').doc(...).set({...})
//                                 data['field']
//
// Returns { nodes, edges, issues, schema } where `schema` is added to the
// snapshot directly (the plugin loader merges it via combineSchema in scan.js).
//
// This parser is intentionally heuristic — fancy edge cases (variable-stored
// refs, dynamic collection names) are best-effort. Click any field row in the
// Schema tab to see the exact source ref.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createNode, createEdge } from '../../model.js';

const RULE_LOCATIONS = [
  'firestore.rules',
  'firebase/firestore.rules',
  'website/firestore.rules',
  'web/firestore.rules',
];
const INDEX_LOCATIONS = [
  'firestore.indexes.json',
  'firebase/firestore.indexes.json',
  'website/firestore.indexes.json',
  'web/firestore.indexes.json',
];

const SOURCE_EXTS = ['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.dart'];
const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', 'venv', '.venv',
  'dist', 'build', '.next', '.dart_tool', '.git',
  'test-fixtures', 'fixtures', '__tests__',
]);

export default async function parseFirestore(ctx) {
  const { projectRoot } = ctx;

  // 1) Rules → collection nodes
  const rulesText = await readFirstExisting(projectRoot, RULE_LOCATIONS);
  const collections = rulesText ? extractCollectionsFromRules(rulesText) : [];

  // 2) Indexes
  const indexText = await readFirstExisting(projectRoot, INDEX_LOCATIONS);
  const indexedByCollection = indexText ? parseIndexes(indexText) : {};

  // 3) Walk source files for field-usage refs
  const sourceFiles = await collectSourceFiles(projectRoot);
  const usage = {};               // { collection: { field: { python|typescript|dart: 'R'|'W'|'R/W', refs: [...] } } }
  const collectionsFromCode = new Set();
  for (const file of sourceFiles) {
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text == null) continue;
    const lang = languageFor(file);
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
    extractFieldRefs(text, lang).forEach(ref => {
      collectionsFromCode.add(ref.collection);
      pushUsage(usage, ref.collection, ref.field, lang, ref.op, { file: rel, line: ref.line });
    });
  }

  // Union of collections we know about: rules + code mentions.
  const allColls = new Set([...collections.map(c => c.name), ...collectionsFromCode]);

  // 4) Emit collection nodes for the graph
  const nodes = [];
  const edges = [];
  for (const coll of allColls) {
    const id = `firestore.${coll}`;
    nodes.push(createNode({
      id, type: 'collection', surface: 'firebase',
      label: coll,
      file: rulesText ? RULE_LOCATIONS.find(p => p === rulesText.__sourcePath) || 'firestore.rules' : null,
      health: 'green',
      meta: {
        indexedFields: indexedByCollection[coll] || [],
      },
    }));
  }

  // 5) Build snapshot.schema rows (one entry per collection → array of field rows)
  const schema = {};
  for (const coll of allColls) {
    const fields = usage[coll] ? Object.keys(usage[coll]) : [];
    schema[coll] = fields.sort().map(field => {
      const slot = usage[coll][field];
      const indexed = (indexedByCollection[coll] || []).includes(field);
      return {
        field,
        doc: false,                 // generic plugin has no doc source — D-Hash plugin fills this
        firebase: null,             // sampler script populates this
        app: rwOf(slot, 'dart'),
        bot: rwOf(slot, 'python'),
        website: rwOf(slot, 'typescript'),
        refs: slot.refs || [],
        drift: computeDrift({ field, slot, indexed }),
        meta: { indexed },
      };
    });
  }

  return { nodes, edges, issues: [], schema };
}

// ===== helpers: file walking + language detection =====

async function collectSourceFiles(root) {
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
      } else if (e.isFile() && SOURCE_EXTS.some(x => e.name.endsWith(x))) {
        if (e.name.endsWith('.d.ts') || e.name.endsWith('.g.dart')) continue;
        out.push(full);
      }
    }
  }
}

function languageFor(file) {
  if (file.endsWith('.py')) return 'python';
  if (file.endsWith('.dart')) return 'dart';
  return 'typescript';   // .ts/.tsx/.js/.jsx all bucket as 'typescript' for the schema columns
}

async function readFirstExisting(projectRoot, candidates) {
  for (const rel of candidates) {
    try {
      const full = path.join(projectRoot, rel);
      const text = await fs.readFile(full, 'utf8');
      // Stamp the source path on the string so caller knows which one it was.
      const wrapped = new String(text);
      wrapped.__sourcePath = rel;
      return wrapped;
    } catch {}
  }
  return null;
}

// ===== rules + indexes =====

function extractCollectionsFromRules(text) {
  const out = [];
  for (const m of String(text).matchAll(/match\s+\/([\w-]+)\b/g)) {
    if (m[1] === 'databases') continue;
    if (!out.find(o => o.name === m[1])) out.push({ name: m[1] });
  }
  return out;
}

function parseIndexes(text) {
  let parsed;
  try { parsed = JSON.parse(String(text)); } catch { return {}; }
  const out = {};
  for (const idx of (parsed.indexes || [])) {
    const coll = idx.collectionGroup;
    if (!coll) continue;
    if (!out[coll]) out[coll] = [];
    for (const f of (idx.fields || [])) {
      if (f.fieldPath && !out[coll].includes(f.fieldPath)) {
        out[coll].push(f.fieldPath);
      }
    }
  }
  return out;
}

// ===== field-ref extraction per language =====
//
// Returns array of { collection, field, op: 'reads'|'writes', line }.

function extractFieldRefs(text, lang) {
  if (lang === 'python') return extractPyRefs(text);
  if (lang === 'dart') return extractDartRefs(text);
  return extractTsRefs(text);
}

// ===== Python: firebase_admin =====

function extractPyRefs(text) {
  const refs = [];
  // Direct chain: db.collection("X").{document(...).?}{set|update|add}({...})
  const writeRe = /\.collection\(["']([^"']+)["']\)(?:\.document\([^)]*\))?\.(?:set|update|add)\s*\(\s*\{/g;
  for (const m of text.matchAll(writeRe)) {
    const collection = m[1];
    const braceIdx = m.index + m[0].length - 1;
    const block = readBalancedBrace(text, braceIdx);
    if (!block) continue;
    const line = lineOf(text, m.index);
    for (const field of pyDictKeys(block)) {
      refs.push({ collection, field, op: 'writes', line });
    }
  }
  // Var-stored doc refs: `var = db.collection("X")...` then `var.set({...})`.
  const events = [];
  for (const m of text.matchAll(/\b([a-zA-Z_]\w*)\s*=\s*[^\n=]*?\.collection\(["']([^"']+)["']\)/g)) {
    events.push({ kind: 'assign', pos: m.index, varName: m[1], collection: m[2] });
  }
  for (const m of text.matchAll(/\b([a-zA-Z_]\w*)\.(?:set|update|add)\s*\(\s*\{/g)) {
    events.push({ kind: 'write', pos: m.index, varName: m[1], braceIdx: m.index + m[0].length - 1 });
  }
  events.sort((a, b) => a.pos - b.pos);
  const liveVars = new Map();
  for (const ev of events) {
    if (ev.kind === 'assign') liveVars.set(ev.varName, ev.collection);
    else {
      const collection = liveVars.get(ev.varName);
      if (!collection) continue;
      const block = readBalancedBrace(text, ev.braceIdx);
      if (!block) continue;
      const line = lineOf(text, ev.pos);
      for (const field of pyDictKeys(block)) {
        refs.push({ collection, field, op: 'writes', line });
      }
    }
  }
  return refs;   // reads for Python deferred; v0.5.1 if we get demand
}

function pyDictKeys(block) {
  const out = new Set();
  for (const m of block.matchAll(/["']([a-zA-Z_]\w*)["']\s*:/g)) out.add(m[1]);
  return [...out];
}

// ===== TS / JS: firebase v9+ modular SDK =====

function extractTsRefs(text) {
  const refs = [];
  for (const m of text.matchAll(/\b(?:setDoc|updateDoc|addDoc)\s*\(/g)) {
    const argsBlock = readBalancedParen(text, m.index + m[0].length - 1);
    if (!argsBlock) continue;
    const inner = argsBlock.slice(1, -1);
    const collMatch = inner.match(/(?:doc|collection)\s*\(\s*\w+\s*,\s*["']([^"']+)["']/);
    if (!collMatch) continue;
    const collection = collMatch[1];
    const docCallEnd = inner.indexOf(')', collMatch.index + collMatch[0].length);
    if (docCallEnd < 0) continue;
    const braceIdx = inner.indexOf('{', docCallEnd);
    if (braceIdx < 0) continue;
    const block = readBalancedBrace(inner, braceIdx);
    if (!block) continue;
    const line = lineOf(text, m.index);
    for (const field of tsObjectKeys(block)) {
      refs.push({ collection, field, op: 'writes', line });
    }
  }
  return refs;
}

const TS_RESERVED = new Set([
  'true', 'false', 'null', 'undefined', 'new', 'await', 'return', 'const',
  'let', 'var', 'function', 'async',
]);

function tsObjectKeys(block) {
  const out = new Set();
  const inner = stripNestedBraces(block.slice(1, -1));
  for (const m of inner.matchAll(/["']([a-zA-Z_]\w*)["']\s*:/g)) out.add(m[1]);
  for (const m of inner.matchAll(/(?:^|[{,\n])\s*([a-zA-Z_]\w*)\s*(?::|,|\s*$)/gm)) {
    if (!TS_RESERVED.has(m[1])) out.add(m[1]);
  }
  return [...out];
}

// ===== Dart: cloud_firestore =====

function extractDartRefs(text) {
  const refs = [];
  const writeRe = /\.collection\(\s*['"]([^'"]+)['"]\s*\)(?:\.doc\([^)]*\)|\.document\([^)]*\))?\.(?:set|update|add)\s*\(\s*\{/g;
  for (const m of text.matchAll(writeRe)) {
    const collection = m[1];
    const braceIdx = m.index + m[0].length - 1;
    const block = readBalancedBrace(text, braceIdx);
    if (!block) continue;
    const line = lineOf(text, m.index);
    for (const field of dartMapKeys(block)) {
      refs.push({ collection, field, op: 'writes', line });
    }
  }
  return refs;
}

function dartMapKeys(block) {
  const out = new Set();
  const inner = stripNestedBraces(block.slice(1, -1));
  for (const m of inner.matchAll(/['"]([a-zA-Z_]\w*)['"]\s*:/g)) out.add(m[1]);
  return [...out];
}

// ===== shared helpers =====

function lineOf(text, idx) { return text.slice(0, idx).split('\n').length; }

function readBalancedBrace(text, startIdx) {
  if (text[startIdx] !== '{') return null;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  return null;
}

function readBalancedParen(text, startIdx) {
  if (text[startIdx] !== '(') return null;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  return null;
}

function stripNestedBraces(s) {
  let prev;
  do { prev = s; s = s.replace(/\{[^{}]*\}/g, ''); } while (s !== prev);
  return s;
}

function pushUsage(usage, coll, field, lang, op, ref) {
  if (!usage[coll]) usage[coll] = {};
  if (!usage[coll][field]) usage[coll][field] = { refs: [] };
  const slot = usage[coll][field];
  const opCode = op === 'writes' ? 'W' : 'R';
  const cur = slot[lang];
  if (!cur) slot[lang] = opCode;
  else if (cur !== opCode) slot[lang] = 'R/W';
  slot.refs.push({ ...ref, surface: lang, op });
}

function rwOf(slot, lang) { return slot[lang] || null; }

function computeDrift({ field, slot, indexed }) {
  const reasons = [];
  const used = ['app', 'bot', 'website'].some(s => slot[s === 'app' ? 'dart' : s === 'bot' ? 'python' : 'typescript']);
  if (!indexed && !used) reasons.push('rules-only');   // declared in rules but no surface uses it
  if (used && !indexed && field.match(/^(created|updated|created_at|updatedAt)/i)) {
    reasons.push('not indexed');   // common indexable fields without an index
  }
  return reasons;
}
