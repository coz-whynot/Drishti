// Prisma parser — reads prisma/schema.prisma (or related locations) and emits
// one collection node per model + schema rows for each field.
//
// schema.prisma syntax we handle:
//   model User {
//     id        String   @id @default(uuid())
//     email     String   @unique
//     posts     Post[]
//     createdAt DateTime @default(now())
//   }
//
// We extract the field name and a coarse type label. Relations (Post[],
// User?) are flagged so the UI can show them as join targets.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createNode } from '../../model.js';

const SCHEMA_LOCATIONS = [
  'prisma/schema.prisma',
  'schema.prisma',
  'apps/api/prisma/schema.prisma',
  'packages/db/prisma/schema.prisma',
];

export default async function parsePrisma(ctx) {
  const { projectRoot } = ctx;
  const text = await readFirstExisting(projectRoot, SCHEMA_LOCATIONS);
  if (!text) return { nodes: [], edges: [], issues: [], schema: {} };

  const models = extractModels(text);
  const nodes = [];
  const schema = {};

  for (const model of models) {
    const collId = `prisma.${model.name}`;
    nodes.push(createNode({
      id: collId, type: 'collection', surface: 'database',
      label: model.name,
      file: text.__sourcePath,
      health: 'green',
      meta: { source: 'prisma', primaryKey: model.primaryKey },
    }));
    schema[model.name] = model.fields.map(f => ({
      field: f.name,
      doc: true,                  // declared in prisma schema = documented
      firebase: null,             // n/a for relational
      app: null,
      bot: null,
      website: null,
      refs: [{ file: text.__sourcePath, line: f.line, surface: 'database', op: 'declares' }],
      drift: [],
      meta: {
        type: f.type,
        nullable: f.nullable,
        relation: f.relation,
        primaryKey: f.primaryKey,
        unique: f.unique,
        defaultValue: f.defaultValue,
      },
    }));
  }

  return { nodes, edges: [], issues: [], schema };
}

async function readFirstExisting(projectRoot, candidates) {
  for (const rel of candidates) {
    try {
      const full = path.join(projectRoot, rel);
      const content = await fs.readFile(full, 'utf8');
      const wrapped = new String(content);
      wrapped.__sourcePath = rel;
      return wrapped;
    } catch {}
  }
  return null;
}

// Walk the schema and extract `model X { ... }` blocks.
function extractModels(text) {
  const out = [];
  const src = String(text);
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*model\s+(\w+)\s*\{/);
    if (!m) continue;
    const name = m[1];
    let depth = 1;
    const fieldLines = [];
    let primaryKey = null;
    let j = i + 1;
    while (j < lines.length && depth > 0) {
      const line = lines[j];
      if (line.includes('{')) depth++;
      if (line.includes('}')) {
        depth--;
        if (depth === 0) break;
      }
      fieldLines.push({ line, lineNum: j + 1 });
      j++;
    }
    const fields = [];
    for (const { line, lineNum } of fieldLines) {
      const f = parseField(line, lineNum);
      if (!f) continue;
      if (f.primaryKey) primaryKey = f.name;
      fields.push(f);
    }
    out.push({ name, fields, primaryKey });
    i = j;
  }
  return out;
}

// Parse a single Prisma field declaration line:
//   id        String    @id @default(uuid())
//   email     String    @unique
//   posts     Post[]
//   author    User?     @relation(fields: [authorId], references: [id])
//   createdAt DateTime  @default(now())
function parseField(line, lineNum) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;
  // Skip block-level directives like @@index, @@unique
  if (trimmed.startsWith('@@')) return null;
  const m = trimmed.match(/^(\w+)\s+(\w+)(\?|\[\])?(?:\s+(.*))?$/);
  if (!m) return null;
  const [, name, baseType, modifier, rest = ''] = m;
  const isList = modifier === '[]';
  const nullable = modifier === '?';
  // Heuristic: if the type starts with a capital letter and isn't a primitive,
  // it's probably a relation (another model name).
  const PRIMITIVES = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes']);
  const isRelation = !PRIMITIVES.has(baseType) || isList;
  return {
    name,
    type: baseType + (isList ? '[]' : '') + (nullable ? '?' : ''),
    nullable,
    relation: isRelation ? baseType : null,
    primaryKey: /@id\b/.test(rest),
    unique: /@unique\b/.test(rest),
    defaultValue: extractDefault(rest),
    line: lineNum,
  };
}

function extractDefault(rest) {
  // @default(...) may contain function calls like now() / cuid() — match
  // balanced parens instead of stopping at the first `)`.
  const idx = rest.indexOf('@default(');
  if (idx < 0) return null;
  const start = idx + '@default('.length;
  let depth = 1;
  for (let i = start; i < rest.length; i++) {
    const c = rest[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return rest.slice(start, i);
    }
  }
  return null;
}
