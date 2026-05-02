/**
 * Blast Radius engine — given a proposed change, walk the graph and return
 * every file/surface that would need updating.
 *
 * Currently handles: `renameField`, `deleteCollection`, `deleteHandler`,
 * `renameRoute`. Plugins can register additional change kinds by exporting
 * a `findSeedNodes(change, nodes)` returning seed node array, and a
 * `suggestMigration(change, surfaces)` returning a string array.
 *
 * Input:
 *   { kind: 'renameField', collection: 'users', from: 'oldField', to: 'newField' }
 *   { kind: 'deleteCollection', collection: 'audit_log' }
 *   { kind: 'deleteHandler', handler: 'bot.handler.legacy_route' }
 *
 * Output:
 *   {
 *     change: { ... },
 *     seedNodeIds: string[],
 *     surfaces: { bot, website, app, firebase, minipc }: NodeRef[],
 *     totalFiles: number,
 *     relatedIssues: Issue[],
 *     migrationOrder: string[]
 *   }
 */

export function computeBlastRadius(snapshot, change) {
  const { nodes = [], edges = [], issues = [] } = snapshot || {};
  if (!change || !change.kind) {
    throw new Error('computeBlastRadius: change must have a kind');
  }

  // 1. Find seed node(s)
  const seeds = findSeedNodes(nodes, change);
  if (!seeds.length) {
    return {
      change, seedNodeIds: [], surfaces: emptySurfaces(),
      totalFiles: 0, relatedIssues: [], migrationOrder: [],
      warning: 'No seed node found in snapshot for the given change target.',
    };
  }

  // 2. BFS through reads/writes/validates/enforces edges from seed(s)
  const adj = buildAdjacency(edges);
  const reached = new Set(seeds.map(s => s.id));
  const queue = [...seeds.map(s => s.id)];
  while (queue.length) {
    const id = queue.shift();
    const peers = adj.get(id) || [];
    for (const peerId of peers) {
      if (!reached.has(peerId)) {
        reached.add(peerId);
        queue.push(peerId);
      }
    }
  }

  // 3. Collect reached nodes, bucket by surface
  const surfaces = emptySurfaces();
  const byId = new Map(nodes.map(n => [n.id, n]));
  const reachedNodes = [...reached].map(id => byId.get(id)).filter(Boolean);
  for (const n of reachedNodes) {
    const bucket = surfaces[n.surface] || surfaces.firebase;
    bucket.push({
      id: n.id, label: n.label, file: n.file, lineRange: n.lineRange,
      owner: n.owner, type: n.type,
    });
  }

  // 4. Pull related issues (issues whose fileRef matches any reached node's file)
  const reachedFiles = new Set(reachedNodes.map(n => n.file).filter(Boolean));
  const relatedIssues = issues.filter(i => {
    if (!i.fileRef) return false;
    const ref = i.fileRef.split(':')[0];
    return [...reachedFiles].some(f => f === ref || f.endsWith('/' + ref) || f.endsWith('\\' + ref) || (ref.includes('/') && f.endsWith(ref)));
  });

  // 5. Suggested migration order
  const migrationOrder = suggestMigration(change, surfaces);

  return {
    change,
    seedNodeIds: seeds.map(s => s.id),
    surfaces,
    totalFiles: reachedNodes.length,
    relatedIssues,
    migrationOrder,
  };
}

function emptySurfaces() {
  return { bot: [], website: [], app: [], firebase: [], minipc: [] };
}

function findSeedNodes(nodes, change) {
  switch (change.kind) {
    case 'renameField':
    case 'deleteCollection': {
      const collId = `firestore.${change.collection}`;
      return nodes.filter(n => n.id === collId);
    }
    case 'deleteHandler': {
      return nodes.filter(n => n.id === change.handler);
    }
    case 'renameRoute': {
      return nodes.filter(n =>
        n.id === change.route ||
        (n.type === 'route' && n.label === change.route)
      );
    }
    default:
      return [];
  }
}

function buildAdjacency(edges) {
  const map = new Map();
  for (const e of edges) {
    if (!map.has(e.source)) map.set(e.source, []);
    if (!map.has(e.target)) map.set(e.target, []);
    map.get(e.source).push(e.target);
    map.get(e.target).push(e.source); // bidirectional walk for blast radius
  }
  return map;
}

function suggestMigration(change, surfaces) {
  const surfaceCount = Object.entries(surfaces).filter(([, list]) => list.length > 0).length;
  const out = [];
  if (change.kind === 'renameField') {
    out.push(`1. Phase A: in every consumer surface, READ the new field name with a fallback to the old one (read-old-write-new).`);
    out.push(`2. Phase B: backfill — write a one-time script to copy ${change.from} → ${change.to} on all existing docs.`);
    out.push(`3. Phase C: switch all writes to the new field name. Stop writing the old field.`);
    out.push(`4. Phase D: stop reading the old field. Update DB rules + indexes to reference the new name.`);
    out.push(`5. Phase E: remove the old field from all docs (cleanup script). Remove backward-compat read fallback in code.`);
    out.push(`6. CROSS-SURFACE CHECK: touches ${surfaceCount} surface(s). Confirm every surface migrated before Phase D.`);
  } else if (change.kind === 'deleteCollection') {
    out.push(`1. Confirm no live data is essential — export collection first.`);
    out.push(`2. Find every read/write site (listed above) and replace with no-op or alternative storage.`);
    out.push(`3. Update DB rules to deny all access to the collection.`);
    out.push(`4. After cooldown, remove the rule block + index definitions.`);
    out.push(`5. Clean up any related open issues — listed above.`);
  } else if (change.kind === 'deleteHandler') {
    out.push(`1. Find all callers (handlers that route to this one — see edges above).`);
    out.push(`2. Update routing/dispatch tables in any router or master file.`);
    out.push(`3. Remove any external trigger configuration (HTTP route, intent training data, queue subscription) referencing this handler.`);
    out.push(`4. Add a deprecation notice in user-facing surfaces for ~1 release before removal.`);
  } else {
    out.push(`Manual migration plan required. See affected files above.`);
  }
  return out;
}
