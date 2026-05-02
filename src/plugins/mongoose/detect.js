// Activates when Mongoose is in the project: import statement or
// `mongoose` listed in package.json dependencies.
import fs from 'node:fs/promises';
import path from 'node:path';

export default async function detect({ projectRoot }) {
  // Check package.json deps + devDeps
  try {
    const text = await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(text);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.mongoose) return true;
  } catch {}
  // Shallow scan for import/require of mongoose
  return await scanForImport(projectRoot, 0);
}

const SDK_RE = /(?:require\(['"]mongoose['"]\)|from\s+['"]mongoose['"])/;

async function scanForImport(dir, depth) {
  if (depth > 4) return false;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) {
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
