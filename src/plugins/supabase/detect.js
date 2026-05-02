// Activates when a Supabase project is detected. Three signals:
//   1. supabase/ directory at project root (CLI scaffolded project)
//   2. supabase/config.toml exists
//   3. Any source file imports @supabase/supabase-js
import fs from 'node:fs/promises';
import path from 'node:path';

export default async function detect({ projectRoot }) {
  // (1) supabase/ directory
  try {
    const stat = await fs.stat(path.join(projectRoot, 'supabase'));
    if (stat.isDirectory()) return true;
  } catch {}
  // (2) supabase/config.toml — covered by (1) but kept explicit
  try {
    await fs.access(path.join(projectRoot, 'supabase', 'config.toml'));
    return true;
  } catch {}
  // (3) shallow scan for the SDK import
  return await scanForImport(projectRoot, 0);
}

const SDK_RE = /['"]@supabase\/supabase-js['"]/;

async function scanForImport(dir, depth) {
  if (depth > 4) return false;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.isFile() && /\.(ts|tsx|js|jsx)$/.test(e.name)) {
      try {
        const text = await fs.readFile(path.join(dir, e.name), 'utf8');
        if (SDK_RE.test(text)) return true;
      } catch {}
    }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (['node_modules', '.git', 'dist', 'build', '.next'].includes(e.name)) continue;
    if (e.name.startsWith('.')) continue;
    if (await scanForImport(path.join(dir, e.name), depth + 1)) return true;
  }
  return false;
}
