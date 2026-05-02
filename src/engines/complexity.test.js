import { describe, it, expect } from 'vitest';
import { complexityForFunction, computeComplexitiesForFile } from './complexity.js';

describe('complexityForFunction', () => {
  it('returns 1 for empty / no decisions', () => {
    expect(complexityForFunction('', 'python')).toBe(1);
    expect(complexityForFunction('return 1', 'python')).toBe(1);
    expect(complexityForFunction('return 1;', 'typescript')).toBe(1);
  });

  it('counts python if/elif/else/and/or', () => {
    const body = `
if x:
    return 1
elif y and z:
    return 2
elif w or q:
    return 3
return 0`;
    // 1 if + 1 elif + 1 elif + 1 and + 1 or = 5 decisions -> 6
    expect(complexityForFunction(body, 'python')).toBe(6);
  });

  it('counts python except blocks', () => {
    const body = `
try:
    x()
except ValueError:
    pass
except Exception:
    pass`;
    expect(complexityForFunction(body, 'python')).toBe(3);
  });

  it('counts ts if / && / || / ternary', () => {
    const body = `
if (a && b) {
  return c || d;
}
return e ? f : g;`;
    // 1 if + 1 && + 1 || + 1 ternary = 4 -> 5
    expect(complexityForFunction(body, 'typescript')).toBe(5);
  });

  it('ignores nullish coalescing and optional chaining', () => {
    const body = `
const v = a ?? b;
const w = obj?.field;
return v;`;
    // No real decisions -- ?? and ?. should not count.
    expect(complexityForFunction(body, 'typescript')).toBe(1);
  });

  it('counts catch blocks for ts', () => {
    const body = `
try { doThing(); } catch (e) { log(e); }`;
    // 1 catch -> 2
    expect(complexityForFunction(body, 'typescript')).toBe(2);
  });

  it('does not count keywords inside string literals', () => {
    const body = `const msg = "if you and me or them";\nreturn msg;`;
    expect(complexityForFunction(body, 'typescript')).toBe(1);
  });
});

describe('computeComplexitiesForFile', () => {
  it('extracts python def with complexity', () => {
    const text = `
def alpha(a, b):
    if a:
        return 1
    return 2

def beta():
    return 0
`;
    const fns = computeComplexitiesForFile(text, 'python');
    const names = fns.map(f => f.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    const alpha = fns.find(f => f.name === 'alpha');
    expect(alpha.complexity).toBe(2);
    const beta = fns.find(f => f.name === 'beta');
    expect(beta.complexity).toBe(1);
  });

  it('extracts ts function with complexity', () => {
    const text = `
export function processItems(items) {
  if (!items) return null;
  for (const i of items) {
    if (i.active && i.ready) doIt(i);
  }
  return items.length;
}
`;
    const fns = computeComplexitiesForFile(text, 'typescript');
    const fn = fns.find(f => f.name === 'processItems');
    expect(fn).toBeTruthy();
    // 1 if + 1 for + 1 if + 1 && = 4 -> 5
    expect(fn.complexity).toBe(5);
  });

  it('returns [] for unknown language', () => {
    expect(computeComplexitiesForFile('void main() {}', 'rust')).toEqual([]);
  });
});
