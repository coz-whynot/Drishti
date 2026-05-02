// Supabase parser. Walks supabase/migrations/*.sql + supabase/seed.sql for:
//   - CREATE TABLE definitions → collection nodes + per-field schema rows
//   - CREATE POLICY statements → attached to the table's meta.policies array
//   - ALTER TABLE ... ENABLE ROW LEVEL SECURITY → table.meta.rlsEnabled = true
//
// Intentionally re-implements CREATE TABLE parsing (rather than reusing the
// SQLite parser) so we can attribute everything to the supabase surface and
// apply Supabase-specific drift checks (e.g. "RLS enabled but no policies").

import fs from 'node:fs/promises';
import path from 'node:path';
import { createNode } from '../../model.js';

// Walking `supabase/` recursively already covers `supabase/migrations/` and
// `supabase/seed.sql`, so we only need one root.
const SQL_DIRS = ['supabase'];

export default async function parseSupabase(ctx) {
  const { projectRoot } = ctx;
  const seen = new Set();
  const sqlFiles = [];
  for (const d of SQL_DIRS) {
    for (const f of await collectSqlIn(path.join(projectRoot, d))) {
      if (!seen.has(f)) { seen.add(f); sqlFiles.push(f); }
    }
  }
  if (!sqlFiles.length) return { nodes: [], edges: [], issues: [], schema: {} };

  sqlFiles.sort();
  const tables = new Map();   // tableName → { fields, file, policies, rlsEnabled }

  for (const file of sqlFiles) {
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text == null) continue;
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
    const stripped = stripComments(text);

    for (const t of extractCreateTables(stripped)) {
      if (!tables.has(t.name)) {
        tables.set(t.name, { name: t.name, fields: t.fields, file: rel, policies: [], rlsEnabled: false });
      } else {
        const cur = tables.get(t.name);
        const seen = new Set(cur.fields.map(f => f.name));
        for (const f of t.fields) if (!seen.has(f.name)) cur.fields.push(f);
      }
    }
    for (const policy of extractPolicies(stripped)) {
      const t = tables.get(policy.table);
      if (t) t.policies.push(policy);
    }
    for (const enabled of extractRlsEnabled(stripped)) {
      const t = tables.get(enabled);
      if (t) t.rlsEnabled = true;
    }
  }

  const nodes = [];
  const issues = [];
  const schema = {};

  for (const t of tables.values()) {
    const collId = `supabase.${t.name}`;
    const rlsHealth = t.rlsEnabled && t.policies.length === 0 ? 'red'
                    : t.rlsEnabled ? 'green'
                    : 'yellow';
    nodes.push(createNode({
      id: collId, type: 'collection', surface: 'database',
      label: t.name,
      file: t.file,
      health: rlsHealth,
      meta: {
        source: 'supabase',
        rlsEnabled: t.rlsEnabled,
        policies: t.policies.map(p => ({ name: p.name, command: p.command })),
        policyCount: t.policies.length,
      },
    }));
    if (t.rlsEnabled && t.policies.length === 0) {
      issues.push({
        id: `SB-RLS-${collId}`,
        severity: 'HIGH',
        title: `Table "${t.name}" has RLS enabled but no policies — all access denied`,
        source: 'supabase-parser', fileRef: t.file,
        nodeIds: [collId], firstSeenAt: null, openFor: 0, sourceLineRef: '',
      });
    }
    if (!t.rlsEnabled) {
      issues.push({
        id: `SB-NORLS-${collId}`,
        severity: 'MEDIUM',
        title: `Table "${t.name}" has no RLS — anyone with the anon key can read/write`,
        source: 'supabase-parser', fileRef: t.file,
        nodeIds: [collId], firstSeenAt: null, openFor: 0, sourceLineRef: '',
      });
    }

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

  return { nodes, edges: [], issues, schema };
}

// ===== file walking =====

async function collectSqlIn(dir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith('.sql')) out.push(full);
    else if (e.isDirectory() && e.name !== 'functions') {
      out.push(...await collectSqlIn(full));
    }
  }
  return out;
}

// ===== SQL utilities =====

function stripComments(text) {
  return text.replace(/--[^\n]*/g, '');
}

function extractCreateTables(text) {
  const out = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w]+\.)?["`]?(\w+)["`]?\s*\(/gi;
  for (const m of text.matchAll(re)) {
    const tableName = m[1];
    const openParenIdx = m.index + m[0].length - 1;
    const block = readBalancedParen(text, openParenIdx);
    if (!block) continue;
    const inner = block.slice(1, -1);
    const baseLine = text.slice(0, m.index).split('\n').length;
    out.push({ name: tableName, fields: parseFieldLines(inner, baseLine) });
  }
  return out;
}

function extractPolicies(text) {
  const out = [];
  // Policy names can be unquoted (\w+) OR quoted with spaces ("name with spaces").
  // We try both shapes.
  const re = /CREATE\s+POLICY\s+(?:"([^"]+)"|`([^`]+)`|(\w+))\s+ON\s+(?:[\w]+\.)?["`]?(\w+)["`]?(?:\s+AS\s+(?:PERMISSIVE|RESTRICTIVE))?\s+FOR\s+(\w+)/gi;
  for (const m of text.matchAll(re)) {
    const name = m[1] || m[2] || m[3];
    const table = m[4];
    const command = m[5].toUpperCase();
    out.push({ name, table, command });
  }
  return out;
}

function extractRlsEnabled(text) {
  const out = [];
  const re = /ALTER\s+TABLE\s+(?:[\w]+\.)?["`]?(\w+)["`]?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  for (const m of text.matchAll(re)) out.push(m[1]);
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

function parseFieldLines(inner, baseLine) {
  const segments = splitTopLevel(inner, ',');
  const fields = [];
  let lineCursor = baseLine;
  for (const segRaw of segments) {
    const seg = segRaw.trim();
    if (!seg) continue;
    if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)/i.test(seg)) continue;
    // Identifier + type. Type may be one word (TEXT, BIGINT) or with parens
    // (VARCHAR(255), NUMERIC(10,2)). Anything beyond goes into `rest` for
    // constraint detection.
    const m = seg.match(/^["`]?(\w+)["`]?\s+(\w+(?:\s*\([^)]*\))?)/i);
    if (!m) continue;
    const name = m[1];
    const type = m[2].trim().toUpperCase();
    const rest = seg.slice(m[0].length);
    fields.push({
      name, type,
      nullable: !/\bNOT\s+NULL\b/i.test(rest),
      primaryKey: /\bPRIMARY\s+KEY\b/i.test(rest),
      unique: /\bUNIQUE\b/i.test(rest),
      defaultValue: extractDefault(rest),
      references: extractReferences(rest),
      line: lineCursor,
    });
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
    if (c === sep && depth === 0) { out.push(buf); buf = ''; }
    else buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

function extractDefault(rest) {
  const idx = rest.search(/\bDEFAULT\b/i);
  if (idx < 0) return null;
  const after = rest.slice(idx + 'DEFAULT'.length).trimStart();
  if (after.startsWith("'")) {
    const end = after.indexOf("'", 1);
    return end > 0 ? after.slice(1, end) : null;
  }
  // function call
  const fnMatch = after.match(/^(\w+)\s*\(/);
  if (fnMatch) {
    const inner = readBalancedParen(after, after.indexOf('('));
    return inner ? fnMatch[1] + inner : fnMatch[1] + '()';
  }
  // bare token (number, identifier, NULL, etc.)
  const m = after.match(/^[\w.]+/);
  return m ? m[0] : null;
}

function extractReferences(rest) {
  const m = rest.match(/\bREFERENCES\s+(?:[\w]+\.)?["`]?(\w+)["`]?\s*\(\s*["`]?(\w+)["`]?\s*\)/i);
  if (!m) return null;
  return { table: m[1], column: m[2] };
}
