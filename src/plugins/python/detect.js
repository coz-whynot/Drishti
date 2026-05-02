// Activates when the project contains any .py file.
import fs from 'node:fs/promises';
import path from 'node:path';

export default async function detect({ projectRoot }) {
  return await hasExt(projectRoot, '.py', 0);
}

async function hasExt(dir, ext, depth) {
  if (depth > 4) return false;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(ext)) return true;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (['node_modules', '.git', '__pycache__', 'venv', '.venv', 'dist', 'build'].includes(e.name)) continue;
    if (await hasExt(path.join(dir, e.name), ext, depth + 1)) return true;
  }
  return false;
}
