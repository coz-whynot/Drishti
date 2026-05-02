// SQLite (and generic SQL DDL) parser. Reads .sql files in common migration
// directories and extracts CREATE TABLE statements into Schema-tab rows.
//
// Recognised:
//   CREATE TABLE [IF NOT EXISTS] foo ( ... )
//   CREATE TABLE "foo" ( ... )
//   CREATE TABLE main.foo ( ... )
//
// Field-line patterns we parse:
//   id INTEGER PRIMARY KEY AUTOINCREMENT
//   email TEXT NOT NULL UNIQUE
//   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
//   user_id INTEGER REFERENCES users(id)
//
// Constraints / indexes at the table level (PRIMARY KEY (...), FOREIGN KEY,
// UNIQUE (...)) are skipped — we focus on declared field rows for v0.6.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createNode } from '../../model.js';

const SQL_DIRS = ['migrations', 'db/migrations', 'sql', 'sql/migrations', 'database/migrations'];

export default async function parseSqlite(ctx) {
  const { projectRoot } = ctx;
  const sqlFiles = [];
  for (const d of SQL_DIRS) {
    sqlFiles.push(...await collectSqlIn(path.join(projectRoot, d)));
  }
  if (!sqlFiles.length) return { nodes: [], edges: [], issues: [], schema: {} };

  // Process files in lexicographic order so later migrations can ALTER earlier
  // tables. v0.6 only handles CREATE; ALTER is deferred.
  sqlFiles.sort();

  const tables = new Map();   // tableName → { fields: [...], firstSeenFile }
  for (const file of sqlFiles) {
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text == null) continue;
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
    for (const t of extractCreateTables(text)) {
      if (!tables.has(t.name)) {
        tables.set(t.name, { name: t.name, fields: t.fields, file: rel });
      } else {
        // Merge — later files extend earlier definitions (best-effort).
        const cur = tables.get(t.name);
        const seen = new Set(cur.fields.map(f => f.name));
        for (const f of t.fields) if (!seen.has(f.name)) cur.fields.push(f);
      }
    }
  }

  const nodes = [];
  const schema = {};
  for (const t of tables.values()) {
    const collId = `sqlite.${t.name}`;
    nodes.push(createNode({
      id: collId, type: 'collection', surface: 'database',
      label: t.name,
      file: t.file,
      health: 'green',
      meta: { source: 'sqlite' },
    }));
    schema[t.name] = t.fields.map(f => ({
      field: f.name,
      doc: true,
      firebase: null,
      app: null, bot: null, website: null,
      refs: [{ file: t.file, line: f.line, surface: 'database', op: 'declares' }],
      drift: [],
      meta: {
        type: f.type,
        nullable: f.nullable,
        primaryKey: f.primaryKey,
        unique: f.unique,
        defaultValue: f.defaultValue,
        references: f.references,
      },
    }));
  }

  return { nodes, edges: [], issues: [], schema };
}

async function collectSqlIn(dir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith('.sql')) out.push(full);
    else if (e.isDirectory()) out.push(...await collectSqlIn(full));
  }
  return out;
}

// ===== CREATE TABLE extraction =====

function extractCreateTables(text) {
  const out = [];
  // Strip line comments (-- to EOL) so they don't interfere with parsing.
  // Keep newlines so line numbers stay correct.
  const stripped = text.replace(/--[^\n]*/g, '');
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w]+\.)?["`]?(\w+)["`]?\s*\(/gi;
  for (const m of stripped.matchAll(re)) {
    const tableName = m[1];
    const openParenIdx = m.index + m[0].length - 1;
    const block = readBalancedParen(stripped, openParenIdx);
    if (!block) continue;
    const inner = block.slice(1, -1);
    const baseLine = stripped.slice(0, m.index).split('\n').length;
    const fields = parseFieldLines(inner, baseLine);
    out.push({ name: tableName, fields });
  }
  return out;
}

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

// Split an inner-of-parens block on top-level commas (commas not inside
// nested parens) and parse each line as a field declaration.
function parseFieldLines(inner, baseLine) {
  const segments = splitTopLevel(inner, ',');
  const fields = [];
  let lineCursor = baseLine;
  for (const segRaw of segments) {
    const seg = segRaw.trim();
    if (!seg) continue;
    // Skip table-level constraints
    if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)/i.test(seg)) continue;
    // Field starts with an identifier followed by a type token.
    const m = seg.match(/^["`]?(\w+)["`]?\s+([A-Z]+(?:\s*\([^)]*\))?)/i);
    if (!m) continue;
    const name = m[1];
    const type = m[2].toUpperCase();
    const rest = seg.slice(m[0].length);
    fields.push({
      name,
      type,
      nullable: !/\bNOT\s+NULL\b/i.test(rest),
      primaryKey: /\bPRIMARY\s+KEY\b/i.test(rest),
      unique: /\bUNIQUE\b/i.test(rest),
      defaultValue: extractDefault(rest),
      references: extractReferences(rest),
      line: lineCursor,
    });
    // Bump line cursor by the number of newlines in this segment
    lineCursor += (segRaw.match(/\n/g) || []).length;
  }
  return fields;
}

function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === sep && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function extractDefault(rest) {
  const m = rest.match(/\bDEFAULT\s+(\w+(?:\([^)]*\))?|'[^']*'|"[^"]*"|\d+)/i);
  return m ? m[1] : null;
}

function extractReferences(rest) {
  const m = rest.match(/\bREFERENCES\s+["`]?(\w+)["`]?\s*\(\s*["`]?(\w+)["`]?\s*\)/i);
  if (!m) return null;
  return { table: m[1], column: m[2] };
}
