// Firestore detection: presence of firestore.rules / firestore.indexes.json,
// OR any source file importing the Firestore SDK.
import fs from 'node:fs/promises';
import path from 'node:path';

const RULE_FILES = ['firestore.rules', 'firestore.indexes.json'];
const SDK_IMPORT_RE = /firebase\/firestore|firebase_admin|cloud_firestore|@firebase\/firestore/;

export default async function detect({ projectRoot }) {
  for (const f of RULE_FILES) {
    try { await fs.access(path.join(projectRoot, f)); return true; } catch {}
    // Common nested location
    try { await fs.access(path.join(projectRoot, 'website', f)); return true; } catch {}
    try { await fs.access(path.join(projectRoot, 'firebase', f)); return true; } catch {}
  }
  return await scanForImport(projectRoot, 0);
}

async function scanForImport(dir, depth) {
  if (depth > 4) return false;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.isFile() && /\.(ts|tsx|js|jsx|py|dart)$/.test(e.name)) {
      try {
        const text = await fs.readFile(path.join(dir, e.name), 'utf8');
        if (SDK_IMPORT_RE.test(text)) return true;
      } catch {}
    }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (['node_modules', '.git', 'dist', 'build', '.next', '.dart_tool', '__pycache__'].includes(e.name)) continue;
    if (await scanForImport(path.join(dir, e.name), depth + 1)) return true;
  }
  return false;
}
