#!/usr/bin/env node
// Build the static frontend Tauri loads. This is the startup screen — a
// folder picker + recent-projects list. After scanning, it navigates the
// webview to the generated drishti.html (which lives in the same install dir).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'dist-tauri');

await fs.mkdir(OUT_DIR, { recursive: true });

// All dynamic JS uses textContent + appendChild to avoid the innerHTML lint
// warning while still producing the same runtime UI.
const STARTUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Drishti — Pick a project</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #0f1419; color: #d7dce1;
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 40px;
  }
  .card {
    max-width: 540px; width: 100%;
    background: #141920; border: 1px solid #2a3038;
    border-radius: 12px;
    padding: 40px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .brand {
    font-size: 38px; color: #e8b84a; font-weight: 700;
    text-align: center; margin-bottom: 6px;
  }
  .brand .sub {
    display: block; font-size: 14px; color: #9ba3ad;
    font-weight: 400; letter-spacing: 1px;
  }
  h1 {
    font-size: 18px; color: #d7dce1;
    text-align: center; margin: 28px 0 8px;
    font-weight: 500;
  }
  p.subtitle {
    color: #7a828c; font-size: 13px; text-align: center;
    margin-bottom: 28px;
  }
  button.primary {
    display: block; width: 100%;
    padding: 14px 20px;
    background: #e8b84a; color: #0f1419;
    border: 0; border-radius: 8px;
    font-size: 15px; font-weight: 700;
    cursor: pointer; transition: background 0.15s;
  }
  button.primary:hover { background: #f2c85c; }
  button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .recent-section { margin-top: 32px; }
  .recent-header {
    font-size: 11px; text-transform: uppercase; color: #7a828c;
    margin-bottom: 10px; letter-spacing: 0.5px; font-weight: 600;
  }
  .recent-list { list-style: none; max-height: 260px; overflow-y: auto; }
  .recent-item {
    padding: 10px 12px; margin: 4px 0;
    background: #1a2028; border: 1px solid #2a3038; border-radius: 6px;
    cursor: pointer; transition: all 0.1s;
    font-family: 'Consolas', monospace; font-size: 12px;
    color: #9ba3ad;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .recent-item:hover {
    background: #20272f; border-color: #e8b84a; color: #e8b84a;
  }
  .recent-empty { color: #5a6068; font-style: italic; font-size: 12px; padding: 8px 0; text-align: center; }
  .status {
    margin-top: 24px; padding: 14px;
    background: #1a2028; border-radius: 6px;
    font-family: 'Consolas', monospace; font-size: 12px;
    color: #9ba3ad; max-height: 200px; overflow-y: auto;
    white-space: pre-wrap; display: none;
  }
  .status.visible { display: block; }
  .status.error { background: rgba(255,107,107,0.08); color: #ff6b6b; border-left: 3px solid #ff6b6b; }
  .status.success { background: rgba(92,209,139,0.08); color: #5cd18b; border-left: 3px solid #5cd18b; }
  .footer { text-align: center; margin-top: 24px; color: #5a6068; font-size: 11px; }
  .footer a { color: #7a828c; text-decoration: none; }
  .footer a:hover { color: #e8b84a; }
</style>
</head>
<body>
<div class="card">
  <div class="brand">दृष्टि <span class="sub">Drishti v1.0.0</span></div>
  <h1>Pick a project to scan</h1>
  <p class="subtitle">Drishti walks any code repository and produces an interactive dashboard with file/function graph, complexity warnings, schema inspection, and risk ranking.</p>
  <button id="browseBtn" class="primary">📂 Browse for folder</button>
  <div class="recent-section">
    <div class="recent-header">Recent projects</div>
    <ul id="recentList" class="recent-list"></ul>
  </div>
  <div id="status" class="status"></div>
  <div class="footer">
    Runs offline. No telemetry.
    &nbsp;&middot;&nbsp;
    <a href="https://github.com/coz-whynot/Drishti" target="_blank">GitHub</a>
  </div>
</div>
<script>
  const tauri = window.__TAURI__;
  const invoke = tauri && tauri.core && tauri.core.invoke;

  const browseBtn = document.getElementById('browseBtn');
  const recentList = document.getElementById('recentList');
  const status = document.getElementById('status');

  function show(msg, kind) {
    status.className = 'status visible' + (kind ? ' ' + kind : '');
    status.textContent = msg;
  }

  function makeRecentItem(p) {
    const li = document.createElement('li');
    li.className = 'recent-item';
    li.setAttribute('data-path', p);
    li.textContent = p;
    li.addEventListener('click', () => scan(p));
    return li;
  }

  function makeEmptyMsg(text) {
    const li = document.createElement('li');
    li.className = 'recent-empty';
    li.textContent = text;
    return li;
  }

  async function refreshRecent() {
    while (recentList.firstChild) recentList.removeChild(recentList.firstChild);
    if (!invoke) {
      recentList.appendChild(makeEmptyMsg('Tauri runtime unavailable.'));
      return;
    }
    const list = await invoke('list_recent_projects');
    if (!list || list.length === 0) {
      recentList.appendChild(makeEmptyMsg('No recent projects yet.'));
      return;
    }
    for (const p of list) recentList.appendChild(makeRecentItem(p));
  }

  async function scan(projectRoot) {
    if (!invoke) { show('Tauri runtime unavailable.', 'error'); return; }
    browseBtn.disabled = true;
    show('Scanning ' + projectRoot + '...');
    try {
      const result = await invoke('start_scan', { projectRoot });
      if (result.success) {
        await invoke('add_recent_project', { path: projectRoot });
        show('Scan complete in ' + result.elapsed_ms + 'ms. Loading dashboard...', 'success');
        setTimeout(() => {
          if (result.dashboard_path) {
            window.location.href = 'file:///' + result.dashboard_path.replace(/\\\\/g, '/');
          }
        }, 600);
      } else {
        show('Scan failed:\\n' + (result.stderr || 'unknown error'), 'error');
        browseBtn.disabled = false;
      }
    } catch (err) {
      show('Error: ' + err, 'error');
      browseBtn.disabled = false;
    }
  }

  browseBtn.addEventListener('click', async () => {
    if (!invoke) { show('Tauri runtime unavailable.', 'error'); return; }
    const folder = await invoke('pick_folder');
    if (folder) scan(folder);
  });

  refreshRecent();
</script>
</body>
</html>
`;

await fs.writeFile(path.join(OUT_DIR, 'index.html'), STARTUP_HTML);
console.log('[drishti] Built Tauri startup frontend -> ' + path.join(OUT_DIR, 'index.html'));
