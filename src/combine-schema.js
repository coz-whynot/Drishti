// combine-schema.js — merges three sources into the canonical schema view.
//
// Inputs:
//   doc      — { collection: [field, ...] }            (from parsers/doc-schema.js)
//   usage    — { collection: { field: { app, bot, website, refs } } } (from parsers/field-usage.js)
//   firebase — { collection: [field, ...] } | null     (from sample-firebase.js, or null if not sampled)
//
// Output:
//   snapshot.schema = {
//     [collection]: [
//       {
//         field, doc (bool), firebase (bool|null), app, bot, website, refs, drift: [...]
//       }, ...
//     ]
//   }
//
// drift is an array of short reason strings. Empty = no drift.
// Reasons:
//   "doc-only orphan"        — declared in doc, not in firebase samples or any code surface
//   "undocumented"           — used in code but not in doc
//   "missing in <surface>"   — doc declares it, that surface has no R or W
//                              (only emitted if at least one OTHER surface uses it)
//   "name collision: <other>" — another field in the same collection with edit-distance ≤ 2

export function combineSchema({ doc, usage, firebase }) {
  const docCols = doc?.collections || {};
  const usageCols = usage || {};
  const fbCols = firebase || null;

  // Union of all collection names.
  const allColls = new Set([
    ...Object.keys(docCols),
    ...Object.keys(usageCols),
    ...(fbCols ? Object.keys(fbCols) : []),
  ]);

  const schema = {};
  for (const coll of allColls) {
    const docFields = new Set(docCols[coll] || []);
    const fbFields = fbCols ? new Set(fbCols[coll] || []) : null;
    const codeFields = usageCols[coll] || {};

    // All fields known for this collection.
    const allFields = new Set([
      ...docFields,
      ...(fbFields || []),
      ...Object.keys(codeFields),
    ]);

    const rows = [];
    for (const field of allFields) {
      const slot = codeFields[field] || { app: null, bot: null, website: null, refs: [] };
      const inDoc = docFields.has(field);
      const inFirebase = fbFields ? fbFields.has(field) : null;
      const drift = computeDrift({
        field,
        inDoc,
        inFirebase,
        app: slot.app,
        bot: slot.bot,
        website: slot.website,
        siblingFields: allFields,
      });
      rows.push({
        field,
        doc: inDoc,
        firebase: inFirebase,
        app: slot.app,
        bot: slot.bot,
        website: slot.website,
        refs: slot.refs || [],
        drift,
      });
    }

    // Sort: drift first (red rows surface up), then alphabetical.
    rows.sort((a, b) => {
      if ((a.drift.length > 0) !== (b.drift.length > 0)) {
        return a.drift.length > 0 ? -1 : 1;
      }
      return a.field.localeCompare(b.field);
    });

    schema[coll] = rows;
  }
  return schema;
}

function computeDrift({ field, inDoc, inFirebase, app, bot, website, siblingFields }) {
  const reasons = [];
  const surfacesUsing = [
    app ? 'app' : null,
    bot ? 'bot' : null,
    website ? 'website' : null,
  ].filter(Boolean);

  // 1) Doc-only orphan: in doc but no surface uses it AND firebase doesn't have it
  //    (firebase null = unknown, don't flag on null).
  if (inDoc && surfacesUsing.length === 0 && inFirebase !== true) {
    reasons.push('doc-only orphan');
  }

  // 2) Undocumented: used in code OR in firebase, but not in doc.
  if (!inDoc && (surfacesUsing.length > 0 || inFirebase === true)) {
    reasons.push('undocumented');
  }

  // 3) Missing in expected surface: doc declares it AND at least one surface uses it,
  //    and another surface is empty.
  if (inDoc && surfacesUsing.length > 0) {
    const all = ['app', 'bot', 'website'];
    const missing = all.filter(s => !{ app, bot, website }[s]);
    // Only flag missing surfaces where it's reasonable to expect it. v1 heuristic:
    // if at least 2 surfaces use it, the third is probably expected too.
    if (surfacesUsing.length >= 2 && missing.length) {
      reasons.push(`missing in ${missing.join(', ')}`);
    }
  }

  // 4) Name collision: any sibling field within edit-distance 2.
  for (const other of siblingFields) {
    if (other === field) continue;
    if (Math.abs(other.length - field.length) > 2) continue;
    const d = editDistance(field, other);
    if (d > 0 && d <= 2) {
      reasons.push(`name collision: ${other}`);
      break; // one is enough to flag
    }
  }

  return reasons;
}

// Standard Levenshtein distance.
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
