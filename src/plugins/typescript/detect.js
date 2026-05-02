import fs from 'node:fs/promises';
import path from 'node:path';

const TS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export default async function detect({ projectRoot }) {
  return await hasAnyExt(projectRoot, TS_EXTS, 0);
}

async function hasAnyExt(dir, exts, depth) {
  if (depth > 4) return false;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.isFile() && exts.some(x => e.name.endsWith(x))) return true;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(e.name)) continue;
    if (await hasAnyExt(path.join(dir, e.name), exts, depth + 1)) return true;
  }
  return false;
}
