/**
 * Snapshot diff engine.
 * Pure functions — no I/O. Compares two Drishti snapshots and reports what
 * changed between them so the dashboard can render a "what changed since
 * last scan" card.
 *
 * Both snapshots are expected to be the object shape produced by
 * model.js#createSnapshot (i.e. { stats, issues, nodes, ... }). previous
 * may be null/undefined — first-ever scan, no prior snapshot — in which
 * case empty arrays + null deltas are returned.
 */

const SEV_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

/**
 * computeHealthScore — same formula used by app.js Overview card so the
 * server and client agree on the number.
 *   100 - 10*CRITICAL - 3*HIGH - 1*MEDIUM - 0.5*silentFailures
 * Floored at 0, rounded down.
 */
export function computeHealthScore(snapshot) {
  if (!snapshot || !snapshot.issues) return 0;
  const issues = snapshot.issues;
  const crit = issues.filter((i) => i.severity === 'CRITICAL').length;
  const high = issues.filter((i) => i.severity === 'HIGH').length;
  const med = issues.filter((i) => i.severity === 'MEDIUM').length;
  const silent = (snapshot.stats && snapshot.stats.silentFailures) || 0;
  const raw = 100 - crit * 10 - high * 3 - med * 1 - silent * 0.5;
  return Math.max(0, Math.floor(raw));
}

/**
 * diffSnapshots(current, previous)
 *   → {
 *       closed: Issue[],   // present in previous, gone in current
 *       new: Issue[],      // present in current, absent in previous
 *       healthDelta: { previous, current, change } | null,
 *       deltas: { red, yellow, silent }                        // current - previous
 *     }
 *
 * If previous is null/undefined, returns empty arrays and null healthDelta
 * with all deltas at 0 (so the UI can render "No previous scan" cleanly).
 */
export function diffSnapshots(current, previous) {
  if (!current) {
    throw new Error('diffSnapshots: current snapshot is required');
  }
  if (!previous) {
    return {
      closed: [],
      new: [],
      healthDelta: null,
      deltas: { red: 0, yellow: 0, silent: 0 },
    };
  }

  const curIssues = current.issues || [];
  const prevIssues = previous.issues || [];
  const curIds = new Set(curIssues.map((i) => i.id));
  const prevIds = new Set(prevIssues.map((i) => i.id));

  const closed = prevIssues.filter((i) => !curIds.has(i.id));
  const added = curIssues.filter((i) => !prevIds.has(i.id));

  // Sort both lists by severity descending so the "most important first" UI
  // shows critical regressions / fixes at the top.
  const bySev = (a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0);
  closed.sort(bySev);
  added.sort(bySev);

  const curHealth = computeHealthScore(current);
  const prevHealth = computeHealthScore(previous);

  const cs = current.stats || {};
  const ps = previous.stats || {};

  return {
    closed,
    new: added,
    healthDelta: {
      previous: prevHealth,
      current: curHealth,
      change: curHealth - prevHealth,
    },
    deltas: {
      red: (cs.redNodes || 0) - (ps.redNodes || 0),
      yellow: (cs.yellowNodes || 0) - (ps.yellowNodes || 0),
      silent: (cs.silentFailures || 0) - (ps.silentFailures || 0),
    },
  };
}
