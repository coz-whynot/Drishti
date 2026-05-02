// file-tree.js — walks the project root and produces a flat list of files
// with metadata + inlined content for small text files. The Files tab in the
// UI renders this into a tree + click-to-preview.
//
// Static-mode constraint: we have to inline content because the rendered HTML
// runs from file:// and can't read arbitrary disk files at runtime. Watch
// mode could fetch on demand, but inlining keeps both modes consistent.
//
// Caps:
//   - Per-file size limit: 64 KB (files larger get isInlined=false; preview
//                                 will say "Too large to preview, open externally")
//   - Total inlined budget: 5 MB (after exceeding, remaining files get
//                                 isInlined=false even if individually small)
//   - Total file count cap: 10,000 (enormous projects would crash the snapshot;
//                                   anything over reports a warning + truncates)

import fs from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', 'venv', '.venv', 'env',
  'dist', 'build', '.next', '.nuxt', '.svelte-kit',
  '.dart_tool', '.pub-cache', '.gradle',
  '.git', '.idea', '.vscode',
  'coverage', '.tox', '.pytest_cache', '.mypy_cache',
  'tmp', 'temp', '.cache', '.parcel-cache',
  'target',                     // Rust / Java build output
  'site-packages', 'vendor',
]);

// Text-file extensions we'll inline. Anything else (binary) gets size + a
// "binary" tag and is shown without preview.
const TEXT_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.dart', '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.php',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.scala',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.md', '.markdown', '.txt', '.rst', '.adoc',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.cfg', '.conf',
  '.sql', '.graphql', '.gql', '.proto', '.prisma',
  '.xml', '.svg',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.dockerfile',
  '.lock',
  '.gitignore', '.gitattributes', '.editorconfig',
]);

const DENY_PATTERNS = [
  /\.env(\.|$)/,                  // .env, .env.local, .env.production
  /credentials/i,
  /secrets?\.json$/i,
  /service-account/i,
  /\.firebase-credentials/i,
  /\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/,
  /id_rsa|id_dsa|id_ecdsa|id_ed25519/,
];

const PER_FILE_CAP = 64 * 1024;
const TOTAL_BUDGET = 5 * 1024 * 1024;
const MAX_FILES = 10_000;

export async function buildFileTree({ projectRoot }) {
  const files = [];
  let totalInlined = 0;
  let truncated = false;
  await walk(projectRoot);

  return {
    files,                          // flat list — UI builds the tree from `relPath`
    truncated,                      // true if MAX_FILES hit
    totalFiles: files.length,
    totalInlinedBytes: totalInlined,
  };

  async function walk(dir) {
    if (files.length >= MAX_FILES) { truncated = true; return; }
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name.startsWith('.') && e.name !== '.github' && e.name !== '.vscode') continue;
        await walk(full);
      } else if (e.isFile()) {
        if (files.length >= MAX_FILES) { truncated = true; return; }
        const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
        const ext = path.extname(e.name).toLowerCase();
        const stat = await fs.stat(full).catch(() => null);
        if (!stat) continue;
        const size = stat.size;
        const isText = TEXT_EXTS.has(ext) || isExtensionlessText(e.name);
        const denied = DENY_PATTERNS.some(re => re.test(rel));
        let content = null;
        let isInlined = false;
        let reason = null;
        if (denied) {
          reason = 'sensitive (deny-list)';
        } else if (!isText) {
          reason = 'binary';
        } else if (size > PER_FILE_CAP) {
          reason = `too large (${formatBytes(size)} > 64 KB cap)`;
        } else if (totalInlined + size > TOTAL_BUDGET) {
          reason = 'inline-budget exhausted';
        } else {
          content = await fs.readFile(full, 'utf8').catch(() => null);
          if (content != null) {
            isInlined = true;
            totalInlined += size;
          } else {
            reason = 'read error';
          }
        }
        files.push({
          relPath: rel,
          name: e.name,
          ext,
          size,
          isText,
          isInlined,
          content,
          reason,
        });
      }
    }
  }
}

function isExtensionlessText(name) {
  // Common no-extension text files.
  return ['Dockerfile', 'Makefile', 'Rakefile', 'Gemfile', 'Procfile', 'README', 'LICENSE', 'CHANGELOG'].includes(name);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
