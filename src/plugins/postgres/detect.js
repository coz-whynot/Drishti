// Activates when Knex/pg/postgres-related signals are present.
import fs from 'node:fs/promises';
import path from 'node:path';

const KNEX_FILES = ['knexfile.js', 'knexfile.ts', 'knexfile.cjs'];

export default async function detect({ projectRoot }) {
  for (const f of KNEX_FILES) {
    try { await fs.access(path.join(projectRoot, f)); return true; } catch {}
  }
  // package.json deps
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.knex || deps.pg || deps.postgres || deps['postgres.js']) return true;
  } catch {}
  // node-pg-migrate convention
  try { await fs.access(path.join(projectRoot, 'pgmigrations')); return true; } catch {}
  return false;
}
