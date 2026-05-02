// Activates when a SQL migration directory or .sqlite file is present.
import fs from 'node:fs/promises';
import path from 'node:path';

const SQL_DIRS = ['migrations', 'db/migrations', 'sql', 'sql/migrations', 'database/migrations'];
const SQLITE_EXTS = ['.sqlite', '.sqlite3', '.db'];

export default async function detect({ projectRoot }) {
  for (const d of SQL_DIRS) {
    if (await dirHasSql(path.join(projectRoot, d))) return true;
  }
  return await rootHasSqlite(projectRoot);
}

async function dirHasSql(dir) {
  let entries;
  try { entries = await fs.readdir(dir); } catch { return false; }
  return entries.some(name => name.endsWith('.sql'));
}

async function rootHasSqlite(root) {
  let entries;
  try { entries = await fs.readdir(root); } catch { return false; }
  return entries.some(name => SQLITE_EXTS.some(ext => name.endsWith(ext)));
}
