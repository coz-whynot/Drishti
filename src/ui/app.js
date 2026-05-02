// vis-network UMD is loaded via a separate <script> tag in template.html and
// exposes itself as window.vis (containing both DataSet and Network).
const { DataSet, Network } = (typeof window !== 'undefined' && window.vis) || {};

import { renderSchemaTab as _renderSchemaTab } from './schema-tab.js';
import { renderFilesTab as _renderFilesTab } from './files-tab.js';
// Wrapper so the tab modules always read the latest module-level `snapshot`
// here (which is rebound on each renderSnapshot call).
function renderSchemaTab() { _renderSchemaTab(() => snapshot); }
function renderFilesTab() { _renderFilesTab(() => snapshot); }

const COLORS = {
  bot: '#5c8fd1', website: '#7a9e4a', app: '#b06fd1',
  firebase: '#e8b84a', minipc: '#d17a5c',
  'cloud-functions': '#a4c9d4',  // light teal
  storage: '#b8a356',             // muted gold
  external: '#888888',            // grey (not yours)
  auth: '#9f7a9e',                // muted purple
  cron: '#5cd1b8',                // mint
};
const HEALTH_BORDER = { green: '#2a3038', yellow: '#e8b84a', red: '#ff6b6b' };
const SEV_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

function shapeFor(type) {
  return ({ collection: 'database', handler: 'box', screen: 'box', function: 'ellipse',
    route: 'diamond', process: 'hexagon', rule: 'triangle', field: 'dot', endpoint: 'star',
    storage_path: 'database', service: 'star', role: 'triangle' })[type] || 'ellipse';
}

function buildTooltip(n) {
  const parts = [`<b>${n.label}</b> (${n.type})`];
  if (n.file) parts.push(n.file);
  if (n.issues.length) parts.push(`${n.issues.length} issue(s)`);
  if (n.securityTags.length) parts.push(n.securityTags.join(', '));
  return parts.join('<br>');
}

// Per-surface label colors so text stays readable on every node background.
// firebase = yellow bg → dark label; others have darker bg → light label.
const LABEL_COLOR = {
  firebase: '#0f1419',  // dark on yellow
  bot: '#ffffff',
  website: '#ffffff',
  app: '#ffffff',
  minipc: '#ffffff',
  'cloud-functions': '#0f1419',  // light teal needs dark text
  storage: '#0f1419',             // muted gold needs dark text
  external: '#ffffff',            // grey works with white
  auth: '#ffffff',                // muted purple works with white
  cron: '#0f1419',                // mint needs dark text
};

function toVisNodes(nodes) {
  return nodes.map(n => ({
    id: n.id, label: n.label,
    color: { background: COLORS[n.surface] || '#888', border: HEALTH_BORDER[n.health] },
    borderWidth: n.health === 'red' ? 3 : (n.health === 'yellow' ? 2 : 1),
    shape: shapeFor(n.type),
    font: {
      color: LABEL_COLOR[n.surface] || '#d7dce1',
      size: 12,
      strokeWidth: 2,
      // Stroke contrasts with the label color: dark labels get a white stroke
      // (so they remain readable on light surface fills like firebase, mint,
      // gold), light labels get a dark stroke.
      strokeColor: (LABEL_COLOR[n.surface] === '#0f1419') ? '#ffffff' : '#0f1419',
    },
    title: buildTooltip(n),
  }));
}

function toVisEdges(edges) {
  return edges.map(e => ({
    id: e.id, from: e.source, to: e.target, arrows: 'to',
    color: { color: '#3a4048', opacity: 0.5 },
    label: (e.type === 'writes' || e.type === 'reads') ? e.type : '',
    font: { size: 9, color: '#7a828c', strokeWidth: 0 },
  }));
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Module-level state — re-bound on every renderSnapshot() call so the
// dashboard can be refreshed in watch mode without a full page reload.
let snapshot = null;
let nodesDs = null;
let edgesDs = null;
let network = null;
let activeTab = 'overview';
let activePill = null;

// Step Mode state. stepMode=true means the user is walking the graph one
// node at a time; stepPath is the ordered list of node ids walked so far,
// with the last entry being the "current" node.
let stepMode = false;
let stepPath = [];

function renderSuggestions(n) {
  const s = [];
  if (n.meta && n.meta.silentFailure) s.push('Silent failure (e.g. swallowed exception). Fail loud at the correct layer.');
  // Plugin-contributed suggestions arrive on the node as `n.suggestions = [...]`.
  if (Array.isArray(n.suggestions)) for (const sug of n.suggestions) s.push(sug);
  if (n.issues.length >= 3) s.push(`${n.issues.length} open issues - stale work candidate.`);
  if (!s.length) return '<em>no active suggestions</em>';
  return s.map(x => `<div class="suggestion">${escapeHtml(x)}</div>`).join('');
}

function renderComplexityTag(n) {
  const c = n.meta && n.meta.complexity;
  if (!Number.isFinite(c) || c <= 15) return '';
  return `<section><h4>Complexity</h4><span class="tag yellow">Complexity: ${c} (consider splitting)</span></section>`;
}

function renderCoChangePeers(n) {
  const peers = n.meta && n.meta.coChangePeers;
  if (!peers || !peers.length) {
    return `<section><h4>Co-change peers</h4><em>no co-change history (changed alone)</em></section>`;
  }
  const items = peers.map(p =>
    `<li><code>${escapeHtml(p.path)}</code> <span class="cc-count">(changed together ${p.count} times)</span></li>`
  ).join('');
  return `<section><h4>Co-change peers</h4><ul class="cc-list">${items}</ul></section>`;
}

// "Lineage view": for any clicked node, show what calls/reads from it (incoming)
// and what it calls/writes to (outgoing). Each connection is a clickable
// button that navigates the detail panel to that node.
function renderLineage(n) {
  const byId = new Map(snapshot.nodes.map(x => [x.id, x]));
  const edges = snapshot.edges || [];
  const incoming = edges.filter(e => e.target === n.id);
  const outgoing = edges.filter(e => e.source === n.id);

  const renderBtn = (edge, otherId, dir) => {
    const other = byId.get(otherId);
    if (!other) return '';
    const surface = other.surface ? `<span class="lin-surf surf-${other.surface}">${other.surface}</span>` : '';
    const arrow = dir === 'in' ? '←' : '→';
    return `<button class="lin-btn" data-jump="${escapeHtml(otherId)}">
      <span class="lin-arrow">${arrow}</span>
      <span class="lin-edge">${escapeHtml(edge.type)}</span>
      <span class="lin-label">${escapeHtml(other.label)}</span>
      ${surface}
    </button>`;
  };

  const inHtml = incoming.length
    ? incoming.map(e => renderBtn(e, e.source, 'in')).join('')
    : '<em>nothing calls/reads this</em>';
  const outHtml = outgoing.length
    ? outgoing.map(e => renderBtn(e, e.target, 'out')).join('')
    : '<em>this is a leaf — calls nothing</em>';

  return `
    <section class="lineage">
      <h4>← Called by / reads from this (${incoming.length})</h4>
      <div class="lin-group">${inHtml}</div>
      <h4>→ Calls / leads to (${outgoing.length})</h4>
      <div class="lin-group">${outHtml}</div>
    </section>
  `;
}

function bindLineageListeners() {
  document.querySelectorAll('button.lin-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-jump');
      if (!target) return;
      // Re-open detail panel on the target node, and focus the graph if the Map tab is open.
      if (network) {
        try {
          network.selectNodes([target]);
          network.focus(target, { scale: 1.2, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
        } catch {}
      }
      showDetail(target);
    });
  });
}

function showDetail(nodeId) {
  const n = snapshot.nodes.find(x => x.id === nodeId);
  if (!n) return;
  const issueList = (n.issues || []).map(id => snapshot.issues.find(i => i.id === id)).filter(Boolean);
  const baseHtml = `
    <h2>${escapeHtml(n.label)}</h2>
    <div class="meta">${escapeHtml(n.type)} - ${escapeHtml(n.surface)} - ${escapeHtml(n.file || '-')}</div>
    <section><h4>Health</h4><span class="tag ${n.health}">${n.health}</span></section>
    ${renderComplexityTag(n)}
    <section><h4>Security tags</h4>${n.securityTags.length ? n.securityTags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('') : '<em>none</em>'}</section>
    <section><h4>Open issues (${issueList.length})</h4>${issueList.length ? `<ul>${issueList.map(i => `<li><span class="tag ${i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'red' : 'yellow'}">${escapeHtml(i.severity)}</span> ${escapeHtml(i.id)} - ${escapeHtml(i.title)}</li>`).join('')}</ul>` : '<em>none</em>'}</section>
    <section><h4>Suggestions</h4>${renderSuggestions(n)}</section>
    ${renderLineage(n)}
    ${renderCoChangePeers(n)}
    <section><h4>Owned by</h4><code>${escapeHtml(n.owner)}</code>
      <button class="dispatch" data-owner="${escapeHtml(n.owner)}" data-node="${escapeHtml(n.id)}">Copy dispatch prompt</button>
    </section>
  `;
  const stepHtml = stepMode ? buildStepSection(n) : '';
  const detail = document.getElementById('detail');
  detail.classList.remove('hidden');
  document.body.classList.remove('detail-hidden');
  if (network) setTimeout(() => { try { network.redraw(); } catch {} }, 50);
  document.getElementById('detailContent').innerHTML = baseHtml + stepHtml;
  detail.querySelector('button.dispatch').addEventListener('click', (e) => {
    const owner = e.target.getAttribute('data-owner');
    const nid = e.target.getAttribute('data-node');
    const issueIds = issueList.map(i => i.id).join(', ') || 'none';
    const tags = n.securityTags.join(', ') || 'none';
    const prompt = `Agent({\n  subagent_type: "${owner}",\n  description: "Inspect ${nid}",\n  prompt: "Review ${n.label} at ${n.file || 'unknown'}. Open issues: ${issueIds}. Security tags: ${tags}."\n})`;
    navigator.clipboard.writeText(prompt).then(() => {
      e.target.textContent = 'Copied';
      setTimeout(() => { e.target.textContent = 'Copy dispatch prompt'; }, 1500);
    });
  });
  if (stepMode) bindStepSectionListeners();
  bindLineageListeners();
}

function hideDetail() {
  document.getElementById('detail').classList.add('hidden');
  document.body.classList.add('detail-hidden');
  if (network) setTimeout(() => { try { network.redraw(); } catch {} }, 50);
}

function applyOverlays() {
  if (!nodesDs || !snapshot) return;
  // Step Mode owns the canvas styling while it's on; ignore overlay churn.
  if (stepMode) return;
  const active = {};
  document.querySelectorAll('input[data-overlay]').forEach(cb => { active[cb.getAttribute('data-overlay')] = cb.checked; });
  const updates = snapshot.nodes.map(n => {
    let border = HEALTH_BORDER[n.health];
    if (!active.errors && n.issues.length) border = HEALTH_BORDER.green;
    if (active.silent && n.meta && n.meta.silentFailure) border = '#ff6b6b';
    return { id: n.id, color: { background: COLORS[n.surface] || '#888', border } };
  });
  nodesDs.update(updates);
}

function applySurfaceFilter() {
  if (!nodesDs || !snapshot) return;
  const active = {};
  document.querySelectorAll('input[data-surface]').forEach(cb => { active[cb.getAttribute('data-surface')] = cb.checked; });
  nodesDs.update(snapshot.nodes.map(n => ({ id: n.id, hidden: !active[n.surface] })));
}

function matchQuery(n, q) {
  // Generic queries supported by the core UI. Plugins can extend matching by
  // pushing entries into window.__DRISHTI_QUERY_MATCHERS__ before render.
  if (q.startsWith('collection ')) return n.id === 'firestore.' + q.slice('collection '.length);
  if (q.startsWith('surface ')) {
    const parts = q.split(/\s+/);
    return n.surface === parts[1] && (parts[2] ? n.health === parts[2] : true);
  }
  if (q.startsWith('owner ')) return n.owner === q.slice('owner '.length);
  if (q === 'silent failure') return !!(n.meta && n.meta.silentFailure);
  // Plugin-supplied matchers run last so plugins can override.
  const ext = (typeof window !== 'undefined' && window.__DRISHTI_QUERY_MATCHERS__) || [];
  for (const m of ext) {
    try { if (m(n, q)) return true; } catch {}
  }
  return (n.label + ' ' + n.id + ' ' + (n.file || '')).toLowerCase().includes(q);
}

function renderStats() {
  const s = snapshot.stats;
  document.getElementById('stats').innerHTML = `
    <div>Nodes: ${s.nodeCount}</div>
    <div>Edges: ${s.edgeCount}</div>
    <div>Red: ${s.redNodes} / Yellow: ${s.yellowNodes}</div>
    <div>Issues: ${s.issueCount}</div>
    <div>i18n gaps: ${s.i18nGaps}</div>
    <div>Security: ${s.securityHotspots}</div>
    <div>Silent: ${s.silentFailures}</div>
    <div style="margin-top:8px;color:#7a828c">Commit: ${snapshot.gitCommit}${snapshot.gitDirty ? '*' : ''}</div>
  `;
}

function renderLaunchBadge() {
  const issues = snapshot.issues || [];
  const crit = issues.filter(i => i.severity === 'CRITICAL').length;
  const high = issues.filter(i => i.severity === 'HIGH').length;
  const b = document.getElementById('launchBadge');
  if (crit > 0) { b.className = 'badge red'; b.textContent = `Blocked (${crit})`; }
  else if (high > 0) { b.className = 'badge yellow'; b.textContent = `Caution (${high})`; }
  else { b.className = 'badge green'; b.textContent = 'Ready'; }
}

// ---------- Health score (mirrors engines/diff.js#computeHealthScore) ----------

function computeHealthScore(s) {
  if (!s || !s.issues) return 0;
  const crit = s.issues.filter(i => i.severity === 'CRITICAL').length;
  const high = s.issues.filter(i => i.severity === 'HIGH').length;
  const med = s.issues.filter(i => i.severity === 'MEDIUM').length;
  const silent = (s.stats && s.stats.silentFailures) || 0;
  return Math.max(0, Math.floor(100 - crit * 10 - high * 3 - med * 1 - silent * 0.5));
}

function healthBand(score) {
  if (score >= 80) return { cls: 'green', label: 'Healthy' };
  if (score >= 50) return { cls: 'yellow', label: 'Caution' };
  return { cls: 'red', label: 'Blocked' };
}

// ---------- Risk ranking ----------

function issuesById() {
  return new Map((snapshot.issues || []).map(i => [i.id, i]));
}
function sevOf(n, byId) {
  return Math.max(0, ...(n.issues || []).map(id => SEV_RANK[(byId.get(id) || {}).severity] || 0));
}
function topRedNodes(limit) {
  const byId = issuesById();
  return snapshot.nodes
    .filter(n => n.health === 'red')
    .sort((a, b) => sevOf(b, byId) - sevOf(a, byId) || (b.issues || []).length - (a.issues || []).length)
    .slice(0, limit);
}

// ---------- Overview tab ----------

function renderOverview() {
  const root = document.getElementById('tab-overview');
  if (!root) return;
  const score = computeHealthScore(snapshot);
  const band = healthBand(score);
  const byId = issuesById();
  const top3 = topRedNodes(3);
  const silentNodes = snapshot.nodes.filter(n => n.meta && n.meta.silentFailure).slice(0, 5);

  // Card 1: Health
  const healthCard = `
    <div class="ov-card">
      <h3>Health Score</h3>
      <div class="ov-health">
        <span class="num ${band.cls}">${score}</span>
        <span class="denom">/ 100</span>
        <span class="label ${band.cls}">${band.label}</span>
      </div>
      <div class="ov-formula">100 − 10·CRITICAL − 3·HIGH − 1·MEDIUM − 0.5·silent</div>
    </div>`;

  // Card 2: Top 3 risks
  const top3Html = top3.length ? top3.map((n, i) => {
    const issues = (n.issues || []).map(id => byId.get(id)).filter(Boolean);
    const worst = issues.reduce((a, b) => (SEV_RANK[a.severity] >= SEV_RANK[b.severity] ? a : b), { severity: 'INFO', title: '' });
    return `
      <div class="ov-risk">
        <div class="rk-row">
          <span class="sev ${escapeHtml(worst.severity)}">${escapeHtml(worst.severity)}</span>
          <span class="rk-label">${i + 1}. ${escapeHtml(n.label)}</span>
          <button class="dispatch-mini" data-owner="${escapeHtml(n.owner)}" data-node="${escapeHtml(n.id)}">Copy prompt</button>
        </div>
        <div class="rk-file">${escapeHtml(n.file || '—')}</div>
        ${worst.title ? `<div class="rk-file">→ ${escapeHtml(worst.title)}</div>` : ''}
      </div>`;
  }).join('') : '<div class="ov-empty">No red nodes — clean.</div>';
  const risksCard = `<div class="ov-card"><h3>Top 3 Risks</h3>${top3Html}</div>`;

  // Card 3: Quick wins
  const quickHtml = silentNodes.length ? silentNodes.map(n => {
    const lr = n.lineRange ? `:${n.lineRange[0]}` : '';
    return `<div class="ov-quick"><b>${escapeHtml(n.label)}</b> <span class="qf">— ${escapeHtml((n.file || '—') + lr)}</span></div>`;
  }).join('') : '<div class="ov-empty">No silent-failure spots flagged.</div>';
  const quickCard = `<div class="ov-card"><h3>Quick Wins (silent failures)</h3>${quickHtml}</div>`;

  // Card 4: What changed
  const changedCard = renderWhatChangedCard();

  // Card 5: Dependencies (per-surface vuln summary)
  const depsCard = renderDependenciesCard();

  // Card 6: Curated flows (Phase 3) — clickable list that walks via Step Mode
  const flowsCard = renderFlowsCard();

  root.innerHTML = `<div class="ov-grid">${healthCard}${risksCard}${quickCard}${changedCard}${depsCard}${flowsCard}</div>`;

  // Bind copy-prompt buttons
  root.querySelectorAll('button.dispatch-mini').forEach(btn => {
    btn.addEventListener('click', () => {
      const owner = btn.getAttribute('data-owner');
      const nid = btn.getAttribute('data-node');
      const n = snapshot.nodes.find(x => x.id === nid);
      const issues = (n.issues || []).map(id => byId.get(id)).filter(Boolean);
      const issueIds = issues.map(i => i.id).join(', ') || 'none';
      const tags = (n.securityTags || []).join(', ') || 'none';
      const prompt = `Agent({\n  subagent_type: "${owner}",\n  description: "Inspect ${nid}",\n  prompt: "Review ${n.label} at ${n.file || 'unknown'}. Open issues: ${issueIds}. Security tags: ${tags}."\n})`;
      navigator.clipboard.writeText(prompt).then(() => {
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = 'Copy prompt'; }, 1500);
      });
    });
  });

  // Bind flow walk buttons (Phase 3)
  root.querySelectorAll('button.flow-walk-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const flowId = btn.getAttribute('data-flow-id');
      walkFlow(flowId);
    });
  });
}

function renderWhatChangedCard() {
  const prev = snapshot.previous;
  if (!prev || !prev.diff) {
    return `<div class="ov-card"><h3>What Changed</h3><div class="ov-empty">No previous scan to compare against.</div></div>`;
  }
  const d = prev.diff;
  const hd = d.healthDelta || { previous: 0, current: 0, change: 0 };
  const arrow = hd.change > 0 ? '↑' : hd.change < 0 ? '↓' : '→';
  const arrowCls = hd.change > 0 ? 'down' : hd.change < 0 ? 'up' : 'same';

  const closedPills = (d.closed || []).slice(0, 12).map(i => `<span class="ov-issue-pill closed">${escapeHtml(i.id)}</span>`).join('') || '<span class="ov-empty">none</span>';
  const newPills = (d.new || []).slice(0, 12).map(i => `<span class="ov-issue-pill added">${escapeHtml(i.id)}</span>`).join('') || '<span class="ov-empty">none</span>';

  const deltaCell = (n) => {
    const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'same';
    const sign = n > 0 ? '+' : '';
    return `<span class="val ${cls}">${sign}${n}</span>`;
  };

  return `
    <div class="ov-card">
      <h3>What Changed Since Last Scan</h3>
      <div class="ov-changed-row"><span class="key">Health score</span><span class="val ${arrowCls}">${hd.previous} → ${hd.current} ${arrow}</span></div>
      <div class="ov-changed-row"><span class="key">🟢 Closed (${(d.closed || []).length})</span></div>
      <div class="ov-pillrow">${closedPills}</div>
      <div class="ov-changed-row" style="margin-top:8px"><span class="key">🔴 New (${(d.new || []).length})</span></div>
      <div class="ov-pillrow">${newPills}</div>
      <div class="ov-changed-row" style="margin-top:10px"><span class="key">Red nodes Δ</span>${deltaCell(d.deltas.red)}</div>
      <div class="ov-changed-row"><span class="key">Yellow nodes Δ</span>${deltaCell(d.deltas.yellow)}</div>
      <div class="ov-changed-row"><span class="key">Silent failures Δ</span>${deltaCell(d.deltas.silent)}</div>
    </div>`;
}

function renderFlowsCard() {
  const flows = (snapshot && snapshot.flows) || [];
  if (!flows.length) {
    return `<div class="ov-card"><h3>🎬 Curated flows</h3><div style="color:#7a828c;font-style:italic">No flows defined.</div></div>`;
  }
  const nodeIds = new Set((snapshot && snapshot.nodes || []).map(n => n.id));
  const items = flows.map(f => {
    const missing = f.steps.filter(s => !nodeIds.has(s.nodeId)).length;
    const surfaces = new Set(f.steps.map(s => {
      const id = s.nodeId || '';
      return id.split('.')[0];
    }));
    const surfacesList = [...surfaces].join(' → ');
    const warn = missing ? `<span class="tag yellow" title="${missing} step(s) reference nodes not in current snapshot">⚠ ${missing}</span>` : '';
    return `<div class="flow-item" data-flow-id="${escapeHtml(f.id)}">
      <div class="flow-row">
        <strong>${escapeHtml(f.name)}</strong> ${warn}
      </div>
      <div class="flow-meta">${escapeHtml(surfacesList)} · ${f.steps.length} steps · ${(f.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')}</div>
      <button class="flow-walk-btn" data-flow-id="${escapeHtml(f.id)}">▶ Walk this flow</button>
    </div>`;
  }).join('');
  return `<div class="ov-card"><h3>🎬 Curated flows</h3>${items}</div>`;
}

// Walk a flow via Step Mode: find first valid node and let user step through.
// Falls back to focusing on the first existing step's node.
function walkFlow(flowId) {
  const flow = (snapshot.flows || []).find(f => f.id === flowId);
  if (!flow) return;
  const nodeIds = new Set(snapshot.nodes.map(n => n.id));
  const firstValid = flow.steps.find(s => nodeIds.has(s.nodeId));
  if (!firstValid) {
    alert('No steps in this flow reference nodes that exist in the current snapshot. The parser may not have indexed them yet.');
    return;
  }
  // Switch to Map tab + open detail panel for first node
  switchTab('map');
  setTimeout(() => {
    if (network) {
      try {
        network.selectNodes([firstValid.nodeId]);
        network.focus(firstValid.nodeId, { scale: 1.2, animation: { duration: 600, easingFunction: 'easeInOutQuad' } });
      } catch {}
    }
    showDetail(firstValid.nodeId);
    // Inform user of next steps
    if (typeof showToast === 'function') {
      showToast(`Walking "${flow.name}" — Step 1 of ${flow.steps.length}: ${firstValid.action} (${firstValid.expectedOutcome})`);
    }
  }, 300);
}

function renderDependenciesCard() {
  const deps = snapshot.deps;
  if (!deps) {
    return `<div class="ov-card"><h3>Dependencies</h3><div class="ov-empty">No dep scan in this snapshot.</div></div>`;
  }
  const surfaces = ['website', 'drishti', 'bot', 'app'];
  const rows = surfaces.map(key => {
    const s = deps[key];
    if (!s || !s.available) {
      return `<div class="dep-row">
        <span class="dep-surface">${escapeHtml(key)}</span>
        <span class="dep-empty">${escapeHtml((s && s.reason) || 'unavailable')}</span>
      </div>`;
    }
    const sum = s.summary || { critical: 0, high: 0, moderate: 0, low: 0 };
    const total = sum.critical + sum.high + sum.moderate + sum.low;
    const cls = sum.critical > 0 ? 'red' : (sum.high > 0 || sum.moderate > 0 ? 'yellow' : 'green');
    const label = total === 0 ? 'clean' : `${sum.critical}C / ${sum.high}H / ${sum.moderate}M / ${sum.low}L`;
    const top = (s.advisories || []).slice(0, 3).map(a =>
      `<div class="dep-adv"><span class="dep-sev ${escapeHtml(a.severity)}">${escapeHtml(a.severity)}</span> <code>${escapeHtml(a.name)}</code> ${escapeHtml(a.title || '')}</div>`
    ).join('');
    return `<div class="dep-row">
      <span class="dep-surface">${escapeHtml(key)}</span>
      <span class="dep-badge ${cls}">${escapeHtml(label)}</span>
    </div>${top}`;
  }).join('');
  return `<div class="ov-card"><h3>Dependencies</h3>${rows}</div>`;
}

// ---------- Risks tab ----------

function renderRisksTab() {
  const root = document.getElementById('tab-risks');
  if (!root) return;
  const byId = issuesById();
  const ranked = snapshot.nodes
    .filter(n => n.health === 'red')
    .sort((a, b) => sevOf(b, byId) - sevOf(a, byId) || (b.issues || []).length - (a.issues || []).length)
    .slice(0, 50);

  const rows = ranked.map((n, i) => {
    const issues = (n.issues || []).map(id => byId.get(id)).filter(Boolean);
    const worst = issues.reduce((a, b) => (SEV_RANK[a.severity] >= SEV_RANK[b.severity] ? a : b), { severity: 'INFO', title: '' });
    return `<tr data-node="${escapeHtml(n.id)}">
      <td>${i + 1}</td>
      <td><b>${escapeHtml(n.label)}</b></td>
      <td>${escapeHtml(n.surface)}</td>
      <td class="file">${escapeHtml(n.file || '—')}</td>
      <td>${escapeHtml(worst.title || '—')}</td>
      <td class="sev-cell"><span class="sev ${escapeHtml(worst.severity)}" style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;background:${worst.severity === 'CRITICAL' || worst.severity === 'HIGH' ? '#3a1f1f' : '#2a3038'};color:${worst.severity === 'CRITICAL' || worst.severity === 'HIGH' ? '#ff6b6b' : '#9ba3ad'}">${escapeHtml(worst.severity)}</span></td>
    </tr>`;
  }).join('');

  root.innerHTML = `
    <div class="dt-toolbar">
      <span class="dt-counts">Top ${ranked.length} red nodes (by severity × issue count)</span>
    </div>
    <div class="dt-scroll">
      <table class="dt-table">
        <thead><tr><th>#</th><th>Label</th><th>Surface</th><th>File</th><th>Top Issue</th><th>Sev</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="ov-empty" style="padding:20px;text-align:center">No red nodes.</td></tr>'}</tbody>
      </table>
    </div>`;

  root.querySelectorAll('tbody tr[data-node]').forEach(tr => {
    tr.addEventListener('click', () => showDetail(tr.getAttribute('data-node')));
  });
}

// ---------- Issues tab ----------

let issuesFilter = { text: '', severity: 'ALL' };

function renderIssuesTab() {
  const root = document.getElementById('tab-issues');
  if (!root) return;
  const all = (snapshot.issues || []).slice().sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));
  const filtered = all.filter(i => {
    if (issuesFilter.severity !== 'ALL' && i.severity !== issuesFilter.severity) return false;
    if (issuesFilter.text) {
      const blob = (i.id + ' ' + i.title + ' ' + (i.fileRef || '')).toLowerCase();
      if (!blob.includes(issuesFilter.text.toLowerCase())) return false;
    }
    return true;
  });

  const rows = filtered.map(i => {
    const sevBg = i.severity === 'CRITICAL' || i.severity === 'HIGH' ? '#3a1f1f'
      : i.severity === 'MEDIUM' ? '#3a2f1f' : '#2a3038';
    const sevFg = i.severity === 'CRITICAL' || i.severity === 'HIGH' ? '#ff6b6b'
      : i.severity === 'MEDIUM' ? '#e8b84a' : '#9ba3ad';
    // Find a node referenced by this issue, if any, so click → detail
    const linkedNode = (snapshot.nodes.find(n => (n.issues || []).includes(i.id)) || {}).id || '';
    return `<tr ${linkedNode ? `data-node="${escapeHtml(linkedNode)}"` : ''}>
      <td><code>${escapeHtml(i.id)}</code></td>
      <td><span class="sev" style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;background:${sevBg};color:${sevFg}">${escapeHtml(i.severity)}</span></td>
      <td>${escapeHtml(i.title)}</td>
      <td class="file">${escapeHtml(i.fileRef || '—')}</td>
    </tr>`;
  }).join('');

  root.innerHTML = `
    <div class="dt-toolbar">
      <input id="issuesFilterText" type="text" placeholder="Filter title / id / file…" value="${escapeHtml(issuesFilter.text)}" />
      <select id="issuesFilterSev">
        ${['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].map(s =>
          `<option value="${s}" ${issuesFilter.severity === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <span class="dt-counts">${filtered.length} of ${all.length}</span>
    </div>
    <div class="dt-scroll">
      <table class="dt-table">
        <thead><tr><th>ID</th><th>Sev</th><th>Title</th><th>File</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="ov-empty" style="padding:20px;text-align:center">No matching issues.</td></tr>'}</tbody>
      </table>
    </div>`;

  document.getElementById('issuesFilterText').addEventListener('input', (e) => {
    issuesFilter.text = e.target.value;
    renderIssuesTab();
  });
  document.getElementById('issuesFilterSev').addEventListener('change', (e) => {
    issuesFilter.severity = e.target.value;
    renderIssuesTab();
  });
  root.querySelectorAll('tbody tr[data-node]').forEach(tr => {
    tr.addEventListener('click', () => showDetail(tr.getAttribute('data-node')));
  });
}

// ---------- Tab switching ----------

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => {
    const isActive = t.getAttribute('data-tab') === tab;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + tab);
  });
  if (tab === 'overview') renderOverview();
  else if (tab === 'risks') renderRisksTab();
  else if (tab === 'issues') renderIssuesTab();
  else if (tab === 'schema') renderSchemaTab();
  else if (tab === 'files') renderFilesTab();
  else if (tab === 'map' && network) {
    // Map became visible — give vis-network a beat to compute its size,
    // then re-fit so the graph isn't squished from the previous layout.
    setTimeout(() => { try { network.redraw(); network.fit(); } catch {} }, 50);
  }
}

// ---------- Filter pills (plugin-driven) ----------
//
// Pills are registered by plugins via window.__DRISHTI_PILLS__ before render.
// Each entry: { id, label, query }. Built-in shell ships none — empty filter
// bar by default. Plugins push entries to register domain-specific filters.

const PILL_QUERIES = {};

function registerPills() {
  const filterBar = document.getElementById('filterbar');
  if (!filterBar) return;
  const pills = (typeof window !== 'undefined' && window.__DRISHTI_PILLS__) || [];
  // Reset both the DOM and the query map so re-registration is idempotent.
  filterBar.replaceChildren();
  for (const k of Object.keys(PILL_QUERIES)) delete PILL_QUERIES[k];
  for (const p of pills) {
    PILL_QUERIES[p.id] = p.query;
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.setAttribute('data-pill', p.id);
    btn.textContent = p.label;
    filterBar.appendChild(btn);
  }
}

function applyPill(pill) {
  const input = document.getElementById('nlQuery');
  if (activePill === pill) {
    activePill = null;
    input.value = '';
  } else {
    activePill = pill;
    input.value = PILL_QUERIES[pill] || '';
  }
  document.querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('active', p.getAttribute('data-pill') === activePill);
  });
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------- Refresh / toast ----------

function showToast(message, isError) {
  const t = document.createElement('div');
  t.className = 'refresh-toast' + (isError ? ' error' : '');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.4s'; }, 3000);
  setTimeout(() => t.remove(), 3500);
}

async function triggerRefresh() {
  const btn = document.getElementById('refreshBtn');
  if (location.protocol === 'file:') {
    showToast('Static mode: re-run `node src/scan.js <project>` from the Drishti install directory, or use watch mode for live updates.');
    return;
  }
  btn.disabled = true;
  btn.classList.add('spinning');
  btn.textContent = '↻ Scanning...';
  try {
    const r = await fetch('/api/scan', { method: 'POST' });
    const data = await r.json();
    if (data.ok) {
      showToast(`Scan complete in ${data.elapsedMs}ms — ${data.stats.nodeCount} nodes, ${data.stats.redNodes} red`);
    } else {
      showToast('Scan failed: ' + (data.error || 'unknown error'), true);
    }
  } catch (err) {
    showToast('Refresh failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
    btn.textContent = '↻ Refresh';
  }
}

// ---------- Step Mode ----------

const SURFACE_RGB = {
  bot: '92,143,209', website: '122,158,74', app: '176,111,209',
  firebase: '232,184,74', minipc: '209,122,92',
};
function rgba(surface, alpha) {
  const c = SURFACE_RGB[surface] || '136,136,136';
  return `rgba(${c},${alpha})`;
}

function outgoingEdgesFor(nodeId) {
  if (!snapshot) return [];
  return (snapshot.edges || []).filter(e => e.source === nodeId);
}

function showStepToast(message) {
  // Remove any existing step toast first.
  document.querySelectorAll('.step-toast').forEach(el => el.remove());
  const t = document.createElement('div');
  t.className = 'step-toast';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; }, 2400);
  setTimeout(() => t.remove(), 3000);
}

function enterStepMode() {
  if (stepMode) return;
  stepMode = true;
  stepPath = [];
  const btn = document.getElementById('stepBtn');
  btn.setAttribute('data-step', 'on');
  btn.textContent = '■ Step Mode';
  // Step Mode is graph-only: jump to Map tab.
  if (activeTab !== 'map') switchTab('map');
  // Stop physics so nodes hold position while user clicks.
  if (network) {
    try { network.setOptions({ physics: { enabled: false } }); } catch {}
  }
  applyStepStyling();
  hideDetail();
  showStepToast('Click any node to start stepping');
}

function exitStepMode() {
  if (!stepMode) return;
  stepMode = false;
  stepPath = [];
  const btn = document.getElementById('stepBtn');
  btn.setAttribute('data-step', 'off');
  btn.textContent = '▶ Step Mode';
  // Re-enable physics for normal interaction.
  if (network) {
    try { network.setOptions({ physics: { enabled: true } }); } catch {}
  }
  // Restore normal node styling via the regular overlay machinery.
  applyOverlays();
  // And reset edge colors.
  if (edgesDs && snapshot) {
    edgesDs.update(toVisEdges(snapshot.edges || []));
  }
  hideDetail();
}

/**
 * Recolor every node and edge based on the current step path.
 * Uses explicit RGBA backgrounds because vis-network 9.x does not honor
 * a top-level `opacity` property on nodes.
 */
function applyStepStyling() {
  if (!nodesDs || !edgesDs || !snapshot) return;
  const path = stepPath;
  const current = path[path.length - 1] || null;
  const pathSet = new Set(path);
  const neighbors = new Set();
  let outgoingEdgeIds = new Set();
  let pathEdgeIds = new Set();
  if (current) {
    for (const e of outgoingEdgesFor(current)) {
      neighbors.add(e.target);
      outgoingEdgeIds.add(e.id);
    }
  }
  // Edges between consecutive path entries are "path edges".
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i], to = path[i + 1];
    const e = (snapshot.edges || []).find(x => x.source === from && x.target === to);
    if (e) pathEdgeIds.add(e.id);
  }

  const nodeUpdates = snapshot.nodes.map(n => {
    let bgAlpha = 0.15;
    let border = '#2a3038';
    let borderWidth = 1;
    if (n.id === current) {
      bgAlpha = 1.0; border = '#e8b84a'; borderWidth = 5;
    } else if (pathSet.has(n.id)) {
      bgAlpha = 0.7; border = '#8a6a2a'; borderWidth = 3;
    } else if (neighbors.has(n.id)) {
      bgAlpha = 0.6; border = HEALTH_BORDER[n.health]; borderWidth = 1;
    }
    return {
      id: n.id,
      color: { background: rgba(n.surface, bgAlpha), border },
      borderWidth,
    };
  });
  nodesDs.update(nodeUpdates);

  const edgeUpdates = (snapshot.edges || []).map(e => {
    let color = '#3a4048';
    let opacity = 0.08;
    let width = 1;
    if (pathEdgeIds.has(e.id)) {
      color = '#e8b84a'; opacity = 1.0; width = 3;
    } else if (outgoingEdgeIds.has(e.id)) {
      color = '#9ba3ad'; opacity = 0.7; width = 2;
    }
    return {
      id: e.id,
      color: { color, opacity },
      width,
      label: (e.type === 'writes' || e.type === 'reads') ? e.type : '',
    };
  });
  edgesDs.update(edgeUpdates);
}

function buildStepSection(n) {
  const idx = stepPath.indexOf(n.id);
  const total = stepPath.length;
  const pos = idx >= 0 ? (idx + 1) : total + 1;
  const totalShown = idx >= 0 ? total : pos;
  const outs = outgoingEdgesFor(n.id);
  const nodeById = new Map(snapshot.nodes.map(x => [x.id, x]));
  const seenTargets = new Set();
  const buttons = [];
  for (const e of outs) {
    // Dedupe identical edge-type+target pairs.
    const k = e.type + '|' + e.target;
    if (seenTargets.has(k)) continue;
    seenTargets.add(k);
    const target = nodeById.get(e.target);
    if (!target) continue;
    const verb = e.type || 'connects';
    buttons.push(
      `<button class="step-next" data-target="${escapeHtml(e.target)}">` +
        `<span class="edge-type">${escapeHtml(verb)}</span>` +
        `${escapeHtml(target.label)}` +
        `<span class="step-owner"> (${escapeHtml(target.owner || '—')})</span>` +
      `</button>`
    );
  }
  const nextHtml = buttons.length
    ? `<div class="step-next-list">${buttons.join('')}</div>`
    : `<div class="step-empty">(no outgoing edges — this is a leaf)</div>`;
  const canBack = stepPath.length > 1 && idx === stepPath.length - 1;
  return `
    <section class="step-section">
      <div class="step-header">Step Mode</div>
      <div class="step-pos">Step <b>${pos}</b> of <b>${totalShown}</b> — ${escapeHtml(n.label)}</div>
      <div class="step-header" style="font-size:10px">Next steps</div>
      ${nextHtml}
      <div class="step-controls">
        <button class="step-ctrl back" ${canBack ? '' : 'disabled'}>← Back</button>
        <button class="step-ctrl reset">Reset</button>
        <button class="step-ctrl exit">Exit Step Mode</button>
      </div>
    </section>
  `;
}

function bindStepSectionListeners() {
  const detail = document.getElementById('detail');
  if (!detail) return;
  detail.querySelectorAll('button.step-next').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      stepNext(target);
    });
  });
  const back = detail.querySelector('button.step-ctrl.back');
  if (back) back.addEventListener('click', stepBack);
  const reset = detail.querySelector('button.step-ctrl.reset');
  if (reset) reset.addEventListener('click', stepReset);
  const exit = detail.querySelector('button.step-ctrl.exit');
  if (exit) exit.addEventListener('click', exitStepMode);
}

function stepNext(targetId) {
  if (!stepMode) return;
  if (!snapshot.nodes.find(n => n.id === targetId)) return;
  stepPath.push(targetId);
  applyStepStyling();
  showDetail(targetId);
  if (network) try { network.focus(targetId, { scale: 1.0, animation: { duration: 300 } }); } catch {}
}

function stepBack() {
  if (!stepMode || stepPath.length <= 1) return;
  stepPath.pop();
  const prev = stepPath[stepPath.length - 1];
  applyStepStyling();
  showDetail(prev);
}

function stepReset() {
  if (!stepMode) return;
  stepPath = [];
  applyStepStyling();
  hideDetail();
  showStepToast('Click any node to start stepping');
}

function handleStepClick(nodeId) {
  if (!stepMode) return;
  // If the clicked node is the current node's outgoing neighbor, step into it.
  const current = stepPath[stepPath.length - 1];
  if (current) {
    const isNeighbor = outgoingEdgesFor(current).some(e => e.target === nodeId);
    if (isNeighbor) {
      stepNext(nodeId);
      return;
    }
    // Clicked an off-path node: implicit reset, this becomes the new start.
    stepPath = [nodeId];
  } else {
    stepPath = [nodeId];
  }
  applyStepStyling();
  showDetail(nodeId);
}

// ---------- Listener wiring ----------

let listenersBound = false;
function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;

  document.getElementById('closeDetail').addEventListener('click', hideDetail);
  document.querySelectorAll('input[data-overlay]').forEach(cb => cb.addEventListener('change', applyOverlays));
  document.querySelectorAll('input[data-surface]').forEach(cb => cb.addEventListener('change', applySurfaceFilter));

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', triggerRefresh);

  const stepBtn = document.getElementById('stepBtn');
  if (stepBtn) stepBtn.addEventListener('click', () => {
    if (stepMode) exitStepMode();
    else enterStepMode();
  });

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.getAttribute('data-tab')));
  });
  document.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => applyPill(p.getAttribute('data-pill')));
  });

  document.getElementById('nlQuery').addEventListener('input', (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    if (!nodesDs || !snapshot) return;
    // Step Mode owns the canvas; let it keep painting.
    if (stepMode) return;
    if (!q) {
      nodesDs.update(snapshot.nodes.map(n => ({
        id: n.id, borderWidth: n.health === 'red' ? 3 : n.health === 'yellow' ? 2 : 1,
        color: { background: COLORS[n.surface] || '#888', border: HEALTH_BORDER[n.health] },
      })));
      return;
    }
    const matches = new Set(snapshot.nodes.filter(n => matchQuery(n, q)).map(n => n.id));
    nodesDs.update(snapshot.nodes.map(n => ({
      id: n.id,
      borderWidth: matches.has(n.id) ? 5 : 1,
      color: { background: COLORS[n.surface] || '#888', border: matches.has(n.id) ? '#e8b84a' : HEALTH_BORDER[n.health] },
    })));
  });
}

/**
 * renderSnapshot — (re)render the full dashboard from a snapshot object.
 * Called once at load with window.__DRISHTI_SNAPSHOT__, and again on each
 * watch-mode update from ws-client.js.
 */
export function renderSnapshot(next) {
  if (!next || !next.nodes) return;
  snapshot = next;
  if (typeof document !== 'undefined') document.body.classList.add('detail-hidden');
  const nodeIds = new Set(snapshot.nodes.map(n => n.id));
  const validEdges = snapshot.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  if (!nodesDs) {
    nodesDs = new DataSet(toVisNodes(snapshot.nodes));
    edgesDs = new DataSet(toVisEdges(validEdges));
    const container = document.getElementById('graph');
    network = new Network(container, { nodes: nodesDs, edges: edgesDs }, {
      layout: { improvedLayout: false, randomSeed: 2 },
      physics: {
        solver: 'forceAtlas2Based',
        forceAtlas2Based: { gravitationalConstant: -50, springLength: 100, avoidOverlap: 0.3 },
        stabilization: { iterations: 150, fit: true },
      },
      interaction: { hover: true, tooltipDelay: 300, navigationButtons: true, keyboard: true },
      nodes: { font: { color: '#d7dce1', size: 12 } },
    });
    network.on('click', (params) => {
      if (params.nodes.length) {
        if (stepMode) handleStepClick(params.nodes[0]);
        else showDetail(params.nodes[0]);
      } else if (!stepMode) {
        hideDetail();
      }
    });
    network.once('stabilizationIterationsDone', () => {
      try { network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } }); } catch {}
    });
    setTimeout(() => { try { network && network.fit(); } catch {} }, 3000);
  } else {
    snapshot = { ...snapshot, edges: validEdges };
    const nextNodeMap = new Map(toVisNodes(snapshot.nodes).map(n => [n.id, n]));
    const nextEdgeMap = new Map(toVisEdges(snapshot.edges).map(e => [e.id, e]));
    const removeNodes = nodesDs.getIds().filter(id => !nextNodeMap.has(id));
    const removeEdges = edgesDs.getIds().filter(id => !nextEdgeMap.has(id));
    if (removeNodes.length) nodesDs.remove(removeNodes);
    if (removeEdges.length) edgesDs.remove(removeEdges);
    nodesDs.update(Array.from(nextNodeMap.values()));
    edgesDs.update(Array.from(nextEdgeMap.values()));
  }
  renderStats();
  renderLaunchBadge();
  bindListeners();
  // Re-render whichever tab is currently visible (default: overview).
  if (activeTab === 'overview') renderOverview();
  else if (activeTab === 'risks') renderRisksTab();
  else if (activeTab === 'issues') renderIssuesTab();
  else if (activeTab === 'schema') renderSchemaTab();
  else if (activeTab === 'files') renderFilesTab();
  if (typeof window !== 'undefined') {
    window.__DRISHTI_SNAPSHOT__ = snapshot;
  }
}

function bootDrishti() {
  if (typeof window === 'undefined') return;
  console.log('[Drishti] boot start. nodes:', (window.__DRISHTI_SNAPSHOT__ && window.__DRISHTI_SNAPSHOT__.nodes && window.__DRISHTI_SNAPSHOT__.nodes.length) || 0);
  const container = document.getElementById('graph');
  if (!container) {
    console.error('[Drishti] #graph container missing');
    return;
  }
  if (!window.__DRISHTI_SNAPSHOT__) {
    console.error('[Drishti] no snapshot on window');
    return;
  }
  try {
    renderSnapshot(window.__DRISHTI_SNAPSHOT__);
    window.__DRISHTI_RENDER__ = renderSnapshot;
    console.log('[Drishti] render complete. network:', !!network, 'nodes in DataSet:', nodesDs && nodesDs.length);
  } catch (err) {
    console.error('[Drishti] render failed:', err);
    const msg = document.createElement('pre');
    msg.style.cssText = 'color:#ff6b6b;padding:20px;font-family:monospace;font-size:12px;white-space:pre-wrap;';
    msg.textContent = 'Drishti render failed:\n' + (err && err.stack ? err.stack : String(err));
    container.appendChild(msg);
  }
}

if (typeof window !== 'undefined') {
  const start = () => requestAnimationFrame(() => requestAnimationFrame(bootDrishti));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  window.addEventListener('resize', () => {
    if (network) try { network.redraw(); } catch {}
  });
}
