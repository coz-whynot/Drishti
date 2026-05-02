import fs from 'node:fs/promises';
import path from 'node:path';

export default async function detect({ projectRoot }) {
  // Either a pubspec.yaml at root, or any .dart file deeper.
  try {
    await fs.access(path.join(projectRoot, 'pubspec.yaml'));
    return true;
  } catch {}
  return await hasDart(projectRoot, 0);
}

async function hasDart(dir, depth) {
  if (depth > 4) return false;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.dart')) return true;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (['node_modules', '.git', '.dart_tool', 'build'].includes(e.name)) continue;
    if (await hasDart(path.join(dir, e.name), depth + 1)) return true;
  }
  return false;
}
