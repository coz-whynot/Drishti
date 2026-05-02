const VALID_HEALTH = ['green', 'yellow', 'red'];
const VALID_I18N = ['na', 'en_only', 'en_hi'];

export function createNode({
  id, type, surface, label,
  file = null, lineRange = null,
  health = 'green', issues = [],
  i18nStatus = 'na', securityTags = [],
  owner = 'bug-hunter', meta = {},
}) {
  if (!id) throw new Error('createNode: id is required');
  if (!type) throw new Error('createNode: type is required');
  if (!surface) throw new Error('createNode: surface is required');
  if (!label) throw new Error('createNode: label is required');
  if (!VALID_HEALTH.includes(health)) throw new Error(`createNode: bad health`);
  if (!VALID_I18N.includes(i18nStatus)) throw new Error(`createNode: bad i18nStatus`);
  return { id, type, surface, label, file, lineRange, health, issues: [...issues], i18nStatus, securityTags: [...securityTags], owner, meta };
}

export function createEdge({ source, target, type, surfaces, field = null, weight = 1 }) {
  if (!source || !target || !type) throw new Error('createEdge: source, target, type required');
  const id = `${source}->${target}:${type}`;
  return { id, source, target, type, surfaces: [...(surfaces || [])], field, weight };
}

function severity(h) { return { green: 0, yellow: 1, red: 2 }[h] ?? 0; }
function dedup(arr) { return [...new Set(arr)]; }
function i18nMerge(a, b) {
  if (a === 'na') return b;
  if (b === 'na') return a;
  if (a === 'en_only' || b === 'en_only') return 'en_only';
  return 'en_hi';
}
function mergeNode(a, b) {
  return {
    ...a,
    health: severity(a.health) > severity(b.health) ? a.health : b.health,
    issues: dedup([...a.issues, ...b.issues]),
    securityTags: dedup([...a.securityTags, ...b.securityTags]),
    i18nStatus: i18nMerge(a.i18nStatus, b.i18nStatus),
    meta: { ...a.meta, ...b.meta },
  };
}

export function mergeGraphs(graphs) {
  const nodeMap = new Map();
  const edgeMap = new Map();
  for (const g of graphs) {
    for (const n of g.nodes) {
      nodeMap.set(n.id, nodeMap.has(n.id) ? mergeNode(nodeMap.get(n.id), n) : n);
    }
    for (const e of g.edges) {
      edgeMap.set(e.id, e);
    }
  }
  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
}

export function createSnapshot({ nodes, edges, issues, flows, gitCommit, gitBranch, gitDirty }) {
  const stats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    issueCount: issues.length,
    redNodes: nodes.filter(n => n.health === 'red').length,
    yellowNodes: nodes.filter(n => n.health === 'yellow').length,
    i18nGaps: nodes.filter(n => n.i18nStatus === 'en_only').length,
    securityHotspots: nodes.filter(n => n.securityTags.length > 0).length,
    silentFailures: nodes.filter(n => n.meta.silentFailure).length,
  };
  return {
    timestamp: new Date().toISOString(),
    gitCommit, gitBranch, gitDirty,
    nodes, edges, issues, flows, stats,
  };
}
