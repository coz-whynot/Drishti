// Mongoose parser — finds `new Schema({...})` and `new mongoose.Schema({...})`
// definitions in any .js/.ts file and emits collection nodes + schema rows.
//
// The collection NAME comes from the first `mongoose.model('Name', schema)`
// call we find AFTER the schema (most projects pair them in the same file).
// If no model() pairing is found, we fall back to the variable name the
// schema was assigned to.
//
// Field types we recognise:
//   - shorthand: `email: String`  →  type=String
//   - object:    `email: { type: String, required: true, unique: true, default: 'x' }`
//   - array:     `tags: [String]` →  type=String[]
//   - subdoc:    `address: { type: addressSchema }` → relation=addressSchema

import fs from 'node:fs/promises';
import path from 'node:path';
import { createNode } from '../../model.js';

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', '.git', '.idea', '.vscode',
  'test-fixtures', 'fixtures', '__tests__', 'coverage',
]);

export default async function parseMongoose(ctx) {
  const { projectRoot } = ctx;
  const files = await collectFiles(projectRoot);
  const nodes = [];
  const schema = {};

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text == null) continue;
    if (!/(?:new\s+(?:mongoose\.)?Schema)/.test(text)) continue;
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
    for (const def of extractSchemaDefs(text)) {
      const collName = def.modelName || def.varName || 'AnonymousSchema';
      const collId = `mongoose.${collName}`;
      if (!nodes.find(n => n.id === collId)) {
        nodes.push(createNode({
          id: collId, type: 'collection', surface: 'database',
          label: collName,
          file: rel,
          health: 'green',
          meta: { source: 'mongoose' },
        }));
      }
      const rows = def.fields.map(f => ({
        field: f.name,
        doc: true,
        firebase: null,
        app: null, bot: null, website: null,
        refs: [{ file: rel, line: f.line, surface: 'database', op: 'declares' }],
        drift: [],
        meta: {
          type: f.type,
          nullable: !f.required,
          required: f.required,
          unique: f.unique,
          defaultValue: f.defaultValue,
        },
      }));
      schema[collName] = (schema[collName] || []).concat(rows);
    }
  }

  return { nodes, edges: [], issues: [], schema };
}

async function collectFiles(root) {
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
        out.push(full);
      }
    }
  }
}

// ===== Schema-definition extraction =====
//
// Walk for `new (mongoose.)?Schema(` anchors. For each, capture:
//   - varName = the identifier on the left of the assignment (if any)
//   - the inside-of-parens block (balanced)
//   - the FIRST argument inside that block (the schema definition object)
// Then look ahead in the file for `mongoose.model('Name', varName)` to bind
// the model name.

function extractSchemaDefs(text) {
  const defs = [];
  const re = /(?:(?:const|let|var)\s+(\w+)\s*=\s*)?new\s+(?:mongoose\.)?Schema\s*\(/g;
  for (const m of text.matchAll(re)) {
    const varName = m[1] || null;
    const openParenIdx = m.index + m[0].length - 1;
    const argsBlock = readBalancedParen(text, openParenIdx);
    if (!argsBlock) continue;
    const inner = argsBlock.slice(1, -1);
    // First arg = schema definition object literal.
    const braceIdx = inner.indexOf('{');
    if (braceIdx < 0) continue;
    const schemaObj = readBalancedBrace(inner, braceIdx);
    if (!schemaObj) continue;
    const fields = parseSchemaObject(schemaObj.slice(1, -1), text, m.index);
    const modelName = findModelName(text, varName);
    defs.push({ varName, modelName, fields });
  }
  return defs;
}

function findModelName(text, varName) {
  if (!varName) return null;
  // Match `mongoose.model('Foo', varName)` or `model('Foo', varName)`.
  const re = new RegExp(`(?:mongoose\\.)?model\\s*\\(\\s*['"]([\\w-]+)['"]\\s*,\\s*${varName}\\b`);
  const m = text.match(re);
  return m ? m[1] : null;
}

// Parse the inside of the schema definition object — top-level keys are
// field names. Each value is either a primitive type token (String, Number,
// Boolean, Date, ObjectId, Buffer, Mixed, Map) OR an object descriptor with
// `type`, `required`, `unique`, `default` etc.
function parseSchemaObject(inner, fullText, baseOffset) {
  const fields = [];
  const segments = splitTopLevel(inner, ',');
  let cursorOffset = 0;
  for (const segRaw of segments) {
    const seg = segRaw.trim();
    if (!seg) { cursorOffset += segRaw.length + 1; continue; }
    // Skip Schema options like `timestamps: true` if at the bottom — heuristic.
    const m = seg.match(/^["`]?(\w+)["`]?\s*:\s*(.*)$/s);
    if (!m) { cursorOffset += segRaw.length + 1; continue; }
    const name = m[1];
    const valueStr = m[2].trim();
    const f = parseFieldValue(name, valueStr);
    // Approximate line number = baseOffset + cursorOffset within fullText.
    const absPos = baseOffset + cursorOffset;
    f.line = fullText.slice(0, absPos).split('\n').length;
    fields.push(f);
    cursorOffset += segRaw.length + 1;
  }
  return fields;
}

function parseFieldValue(name, valueStr) {
  // Array shorthand: `[String]` or `[{type: String}]`
  if (valueStr.startsWith('[')) {
    const innerArr = valueStr.slice(1, valueStr.lastIndexOf(']')).trim();
    const elementType = innerArr.startsWith('{')
      ? extractObjType(innerArr) || 'Mixed'
      : innerArr.split(/[,\s]/)[0] || 'Mixed';
    return { name, type: elementType + '[]', required: false, unique: false, defaultValue: null };
  }
  // Object descriptor: `{ type: ..., required: ..., unique: ..., default: ... }`
  if (valueStr.startsWith('{')) {
    return {
      name,
      type: extractObjType(valueStr) || 'Mixed',
      required: /\brequired\s*:\s*true\b/.test(valueStr),
      unique: /\bunique\s*:\s*true\b/.test(valueStr),
      defaultValue: extractObjDefault(valueStr),
    };
  }
  // Shorthand primitive: `String` / `Number` / `mongoose.Schema.Types.ObjectId`
  return {
    name,
    type: valueStr.replace(/^.*\./, '').replace(/[,;]\s*$/, ''),
    required: false,
    unique: false,
    defaultValue: null,
  };
}

function extractObjType(objStr) {
  const m = objStr.match(/\btype\s*:\s*([A-Za-z][\w.]*(?:\[\])?)/);
  return m ? m[1].replace(/^.*\./, '') : null;
}

function extractObjDefault(objStr) {
  const m = objStr.match(/\bdefault\s*:\s*([^,}\n]+)/);
  return m ? m[1].trim() : null;
}

// ===== shared helpers =====

function readBalancedParen(text, startIdx) {
  if (text[startIdx] !== '(') return null;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

function readBalancedBrace(text, startIdx) {
  if (text[startIdx] !== '{') return null;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0;
  let buf = '';
  let inStr = null;
  for (const c of s) {
    if (inStr) {
      buf += c;
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; buf += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (c === sep && depth === 0) { out.push(buf); buf = ''; }
    else buf += c;
  }
  if (buf) out.push(buf);
  return out;
}
