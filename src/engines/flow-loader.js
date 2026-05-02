import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Load all *.json flow files from flowsDir, validate, and return them.
 * Returns: { flows: FlowDefinition[], errors: [{file, error}] }
 *
 * A valid flow must have: id (string), name (string), trigger.surface (string),
 * trigger.input (string), steps (array with order + nodeId + action per step).
 */
export async function loadFlows({ flowsDir }) {
  const out = { flows: [], errors: [] };
  let entries;
  try {
    entries = await fs.readdir(flowsDir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(flowsDir, entry);
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      out.errors.push({ file: entry, error: 'read failed: ' + err.message });
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      out.errors.push({ file: entry, error: 'invalid JSON: ' + err.message });
      continue;
    }
    const validation = validateFlow(parsed);
    if (validation) {
      out.errors.push({ file: entry, error: validation });
      continue;
    }
    out.flows.push(parsed);
  }
  // Stable order by id for deterministic UI rendering.
  out.flows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

function validateFlow(f) {
  if (!f || typeof f !== 'object') return 'not an object';
  if (typeof f.id !== 'string' || !f.id) return 'missing id';
  if (typeof f.name !== 'string' || !f.name) return 'missing name';
  if (!f.trigger || typeof f.trigger !== 'object') return 'missing trigger';
  if (typeof f.trigger.surface !== 'string') return 'missing trigger.surface';
  if (typeof f.trigger.input !== 'string') return 'missing trigger.input';
  if (!Array.isArray(f.steps) || !f.steps.length) return 'missing or empty steps';
  for (let i = 0; i < f.steps.length; i++) {
    const s = f.steps[i];
    if (!s || typeof s !== 'object') return `step ${i}: not an object`;
    if (typeof s.order !== 'number') return `step ${i}: missing order`;
    if (typeof s.nodeId !== 'string') return `step ${i}: missing nodeId`;
    if (typeof s.action !== 'string') return `step ${i}: missing action`;
  }
  return null;
}
