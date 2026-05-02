import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bundleEntry(entryPath) {
  const r = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'iife',
    write: false,
    minify: true,
    target: 'es2022',
    logLevel: 'silent',
  });
  return r.outputFiles[0].text;
}

// Load vis-network's pre-built UMD min directly. It's minified by vis-network's
// own build; bypassing esbuild here avoids minification bugs that mangle
// vis-network's internal symbols.
async function loadVisNetworkUmd() {
  // node_modules lives at the repo root — two levels up from src/ui/.
  const umdPath = path.resolve(
    __dirname, '..', '..', 'node_modules', 'vis-network', 'standalone', 'umd', 'vis-network.min.js'
  );
  return fs.readFile(umdPath, 'utf8');
}

export async function buildHtml(snapshot, outputPath) {
  const [template, styles, visUmd, appJs, wsClientJs] = await Promise.all([
    fs.readFile(path.join(__dirname, 'template.html'), 'utf8'),
    fs.readFile(path.join(__dirname, 'styles.css'), 'utf8'),
    loadVisNetworkUmd(),
    bundleEntry(path.join(__dirname, 'app.js')),
    bundleEntry(path.join(__dirname, 'ws-client.js')),
  ]);
  // Use split/join instead of String.replace because the bundled JS may contain
  // `$&`, `$'`, etc. which String.prototype.replace interprets as backreferences.
  const inject = (s, token, value) => s.split(token).join(value);
  let html = template;
  html = inject(html, '__STYLES__', styles);
  html = inject(html, '__SNAPSHOT__', JSON.stringify(snapshot));
  html = inject(html, '__VIS_NETWORK_UMD__', visUmd);
  html = inject(html, '__APP_JS__', appJs);
  html = inject(html, '__WS_CLIENT_JS__', wsClientJs);
  await fs.writeFile(outputPath, html);
  return outputPath;
}
