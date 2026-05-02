import { mergeGraphs } from './model.js';

export function combine({ graphs, issues, i18n, coChange = null }) {
  const merged = mergeGraphs(graphs);
  const { nodes, edges } = merged;
  const missingHiSet = new Set(i18n.missingHindi);
  // coChange.peers is a Map<filePath, Array<{path, count}>> -- normalise so
  // a missing engine result still reads cleanly.
  const peersMap = (coChange && coChange.peers instanceof Map) ? coChange.peers : null;
  for (const n of nodes) {
    const matched = issues.filter(i => fileMatches(i.fileRef, n.file));
    if (matched.length) {
      n.issues = [...new Set([...n.issues, ...matched.map(i => i.id)])];
      const worst = matched.reduce((w, i) => (severity(i.severity) > severity(w) ? i.severity : w), 'INFO');
      if (severity(worst) >= severity('HIGH')) n.health = 'red';
      else if (severity(worst) >= severity('MEDIUM')) n.health = worstHealth(n.health, 'yellow');
    }
    if (n.surface === 'app' && n.type === 'screen' && n.meta.i18nKeys && n.meta.i18nKeys.length) {
      const hasGap = n.meta.i18nKeys.some(k => missingHiSet.has(k));
      n.i18nStatus = hasGap ? 'en_only' : 'en_hi';
    }
    // Attach co-change peers (top 5 already from the engine) when this node
    // has a file we can look up. Node file paths may be prefixed with
    // `../../` etc. depending on the cwd of the scan run; co-change keys
    // are repo-relative. Match by suffix-equality so both forms resolve.
    if (peersMap && n.file) {
      const normFile = n.file.replace(/\\/g, '/').replace(/^(?:\.\.\/)+/, '');
      const peers = peersMap.get(n.file) || peersMap.get(normFile);
      if (peers && peers.length) {
        n.meta.coChangePeers = peers.map(p => ({ path: p.path, count: p.count }));
      }
    }
    // Complexity-driven health bump: if any function in this node is >15,
    // the node turns yellow (or stays red).
    if (n.meta && Number.isFinite(n.meta.complexity) && n.meta.complexity > 15) {
      n.health = worstHealth(n.health, 'yellow');
    }
  }
  return { nodes, edges };
}

function fileMatches(issueRef, nodeFile) {
  if (!issueRef || !nodeFile) return false;
  const refPath = issueRef.split(':')[0].trim();
  if (!refPath) return false;
  if (nodeFile === refPath) return true;
  if (nodeFile.endsWith('/' + refPath) || nodeFile.endsWith('\\' + refPath)) return true;
  if (refPath.includes('/') || refPath.includes('\\')) {
    if (nodeFile.endsWith(refPath)) return true;
  }
  return false;
}

function severity(s) { return { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 }[s] ?? 0; }
function worstHealth(a, b) {
  const order = { green: 0, yellow: 1, red: 2 };
  return order[a] >= order[b] ? a : b;
}
