// Postgres parser. Two sources:
//   1. Knex.js migrations:  knex.schema.createTable('users', t => { t.string('email'); ... })
//   2. Raw .sql DDL files in `migrations/`, `db/migrations/`, `pgmigrations/`
//
// We tag everything as the `postgres` source so the Schema tab can distinguish
// from the SQLite plugin's tables.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createNode } from '../../model.js';

const MIGRATION_DIRS = ['migrations', 'db/migrations', 'pgmigrations', 'database/migrations', 'src/migrations'];
const SQL_DIRS = MIGRATION_DIRS;
const KNEX_EXTS = ['.js', '.ts', '.cjs', '.mjs'];

export default async function parsePostgres(ctx) {
  const { projectRoot } = ctx;
  const tables = new Map();

  // Knex JS migrations
  for (const d of MIGRATION_DIRS) {
    const dir = path.join(projectRoot, d);
    for (const f of await listFiles(dir, KNEX_EXTS)) {
      const text = await fs.readFile(f, 'utf8').catch(() => null);
      if (text == null) continue;
      const rel = path.relative(projectRoot, f).replace(/\\/g, '/');
      for (const t of extractKnexTables(text)) {
        if (!tables.has(t.name)) tables.set(t.name, { ...t, file: rel });
      }
    }
  }

  // Raw SQL migrations
  for (const d of SQL_DIRS) {
    const dir = path.join(projectRoot, d);
    for (const f of await listFiles(dir, ['.sql'])) {
      const text = await fs.readFile(f, 'utf8').catch(() => null);
      if (text == null) continue;
      const rel = path.relative(projectRoot, f).replace(/\\/g, '/');
      const stripped = text.replace(/--[^\n]*/g, '');
      for (const t of extractSqlTables(stripped)) {
        if (!tables.has(t.name)) tables.set(t.name, { ...t, file: rel });
      }
    }
  }

  const nodes = [];
  const schema = {};
  for (const t of tables.values()) {
    const collId = `postgres.${t.name}`;
    nodes.push(createNode({
      id: collId, type: 'collection', surface: 'database',
      label: t.name,
      file: t.file,
      health: 'green',
      meta: { source: 'postgres' },
    }));
    schema[t.name] = t.fields.map(f => ({
      field: f.name,
      doc: true,
      firebase: null,
      app: null, bot: null, website: null,
      refs: [{ file: t.file, line: f.line || 1, surface: 'database', op: 'declares' }],
      drift: [],
      meta: {
        type: f.type,
        nullable: f.nullable !== false,
        primaryKey: f.primaryKey || false,
        unique: f.unique || false,
        defaultValue: f.defaultValue || null,
      },
    }));
  }

  return { nodes, edges: [], issues: [], schema };
}

async function listFiles(dir, exts) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && exts.some(x => e.name.endsWith(x))) out.push(full);
    else if (e.isDirectory()) out.push(...await listFiles(full, exts));
  }
  return out;
}

// ===== Knex extraction =====
//
// Match `knex.schema.createTable('name', table => { ... })` or
// `.createTable('name', function (table) { ... })`. Inside the body, lines
// like `table.string('email')` map to a field. Builder methods we recognise:
//   string, text, integer, bigInteger, float, decimal, boolean, date,
//   datetime, timestamp, time, binary, uuid, json, jsonb, increments,
//   bigIncrements, enum, enu, specificType
function extractKnexTables(text) {
  const out = [];
  const re = /\.createTable\s*\(\s*['"]([\w.]+)['"]\s*,\s*(?:function\s*\(\s*(\w+)\s*\)|\(\s*(\w+)\s*\)\s*=>)\s*\{/g;
  for (const m of text.matchAll(re)) {
    const tableName = m[1];
    const param = m[2] || m[3] || 't';
    const openBraceIdx = m.index + m[0].length - 1;
    const block = readBalancedBrace(text, openBraceIdx);
    if (!block) continue;
    const inner = block.slice(1, -1);
    const fields = extractKnexFields(inner, param);
    out.push({ name: tableName, fields });
  }
  return out;
}

const KNEX_TYPES = {
  string: 'VARCHAR', text: 'TEXT', integer: 'INTEGER', bigInteger: 'BIGINT',
  float: 'FLOAT', decimal: 'DECIMAL', boolean: 'BOOLEAN',
  date: 'DATE', datetime: 'DATETIME', timestamp: 'TIMESTAMP', time: 'TIME',
  binary: 'BYTEA', uuid: 'UUID', json: 'JSON', jsonb: 'JSONB',
  increments: 'SERIAL', bigIncrements: 'BIGSERIAL',
  enum: 'ENUM', enu: 'ENUM', specificType: 'CUSTOM',
};

function extractKnexFields(body, paramName) {
  const fields = [];
  const lines = body.split('\n');
  const re = new RegExp(`\\b${paramName}\\.(\\w+)\\s*\\(\\s*['"]([\\w-]+)['"]([^)]*)\\)`, 'g');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(re)) {
      const builder = m[1];
      const fieldName = m[2];
      const restArgs = m[3];
      // builder must be a known type; chained modifiers like .notNullable() come after.
      if (!KNEX_TYPES[builder]) continue;
      const fullLine = line + (line.includes(';') ? '' : (lines[i + 1] || ''));
      fields.push({
        name: fieldName,
        type: KNEX_TYPES[builder],
        nullable: !/\.notNullable\(\)/.test(fullLine),
        primaryKey: /\.primary\(\)/.test(fullLine),
        unique: /\.unique\(\)/.test(fullLine),
        defaultValue: extractKnexDefault(fullLine),
        line: i + 1,
      });
    }
  }
  return fields;
}

function extractKnexDefault(line) {
  const m = line.match(/\.defaultTo\s*\(\s*([^)]+)\s*\)/);
  return m ? m[1] : null;
}

// ===== Raw SQL extraction (Postgres dialect) =====
//
// Same shape as the SQLite parser's CREATE TABLE handling but accepts
// Postgres-specific types in `parseFieldLines`. We re-implement here rather
// than importing from sqlite to keep plugins independent.
function extractSqlTables(text) {
  const out = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w]+\.)?["`]?(\w+)["`]?\s*\(/gi;
  for (const m of text.matchAll(re)) {
    const openIdx = m.index + m[0].length - 1;
    const block = readBalancedParen(text, openIdx);
    if (!block) continue;
    const inner = block.slice(1, -1);
    const baseLine = text.slice(0, m.index).split('\n').length;
    const fields = parseSqlFieldLines(inner, baseLine);
    out.push({ name: m[1], fields });
  }
  return out;
}

function parseSqlFieldLines(inner, baseLine) {
  const segments = splitTopLevel(inner, ',');
  const fields = [];
  let lineCursor = baseLine;
  for (const segRaw of segments) {
    const seg = segRaw.trim();
    if (!seg) continue;
    if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)/i.test(seg)) continue;
    const m = seg.match(/^["`]?(\w+)["`]?\s+(\w+(?:\s*\([^)]*\))?(?:\s+ARRAY)?)/i);
    if (!m) continue;
    const name = m[1];
    const type = m[2].trim().toUpperCase();
    const rest = seg.slice(m[0].length);
    fields.push({
      name, type,
      nullable: !/\bNOT\s+NULL\b/i.test(rest),
      primaryKey: /\bPRIMARY\s+KEY\b/i.test(rest),
      unique: /\bUNIQUE\b/i.test(rest),
      defaultValue: extractSqlDefault(rest),
      line: lineCursor,
    });
    lineCursor += (segRaw.match(/\n/g) || []).length;
  }
  return fields;
}

function extractSqlDefault(rest) {
  const m = rest.match(/\bDEFAULT\s+([^,\s]+(?:\s*\([^)]*\))?)/i);
  return m ? m[1] : null;
}

// ===== shared helpers =====

function readBalancedBrace(text, startIdx) {
  if (text[startIdx] !== '{') return null;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  return null;
}

function readBalancedParen(text, startIdx) {
  if (text[startIdx] !== '(') return null;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  return null;
}

function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === sep && depth === 0) { out.push(buf); buf = ''; }
    else buf += c;
  }
  if (buf) out.push(buf);
  return out;
}
