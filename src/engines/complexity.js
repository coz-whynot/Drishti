/**
 * complexity.js -- regex-based McCabe cyclomatic complexity per function.
 *
 * Pure functions, no I/O. Counts decision points in a function body and
 * returns base 1 plus the decision count. Decision points (per language):
 *   Python:     if, elif, while, for, except, and, or
 *   JS/TS/Dart: if, else if, while, for, case, catch, AND, OR, ternary
 *
 * Heuristic only -- no real AST needed for "this function is hairy" signal.
 *
 * Two API levels:
 *   complexityForFunction(body)            -> integer (>=1)
 *   computeComplexitiesForFile(text, lang) -> [{ name, complexity, startLine, endLine }]
 *
 * Function extraction is intentionally simple:
 *   python:     def name(...) blocks ended by dedent
 *   typescript: function name, arrow const name = (...) =>, class methods
 *   dart:       Type name(...) and name(...) block-bodied methods
 */

/**
 * Strip comments and string literals so decision keywords don't false-match
 * inside strings/comments. Cheap heuristic.
 */
function stripCommentsAndStrings(body, lang) {
  let s = body;
  if (lang === 'python') {
    s = s.replace(/'''[\s\S]*?'''/g, "''");
    s = s.replace(/"""[\s\S]*?"""/g, '""');
    s = s.replace(/#[^\n]*/g, '');
  } else {
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
    s = s.replace(/\/\/[^\n]*/g, '');
  }
  s = s.replace(/"(?:\\.|[^"\\\n])*"/g, '""');
  s = s.replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  if (lang !== 'python') {
    s = s.replace(/`(?:\\.|[^`\\])*`/g, '``');
  }
  return s;
}

/**
 * Count decision points (cyclomatic complexity = 1 + decisions).
 */
export function complexityForFunction(body, lang = 'javascript') {
  if (!body) return 1;
  const cleaned = stripCommentsAndStrings(body, lang);
  let count = 0;

  const kwPatterns = [/\bif\b/g, /\bwhile\b/g, /\bfor\b/g, /\bcase\b/g];
  for (const re of kwPatterns) {
    const m = cleaned.match(re);
    if (m) count += m.length;
  }

  if (lang === 'python') {
    const pyEx = [/\belif\b/g, /\bexcept\b/g, /\band\b/g, /\bor\b/g];
    for (const re of pyEx) {
      const m = cleaned.match(re);
      if (m) count += m.length;
    }
  } else {
    const m1 = cleaned.match(/\bcatch\b/g);
    if (m1) count += m1.length;
    const andOr = cleaned.match(/&&|\|\|/g);
    if (andOr) count += andOr.length;
    // Ternary marker '?' -- exclude '??' (nullish) and '?.' (optional chaining).
    // Use both lookbehind (prev not '?') and lookahead (next not '?', '.', ':')
    // so neither half of '??' counts.
    const tern = cleaned.match(/(?<!\?)\?(?![?.:])/g);
    if (tern) count += tern.length;
  }

  return 1 + count;
}

/**
 * Extract functions and compute complexity per function.
 * Returns: [{ name, complexity, startLine, endLine }, ...]
 */
export function computeComplexitiesForFile(text, language) {
  if (!text) return [];
  if (language === 'python') return extractPythonFns(text);
  if (language === 'typescript' || language === 'javascript') return extractTsFns(text);
  if (language === 'dart') return extractDartFns(text);
  return [];
}

function extractPythonFns(text) {
  const lines = text.split('\n');
  const out = [];
  // Match `def foo(` and `async def foo(` at any indent (so methods inside classes are caught too).
  const defRe = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/;
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(defRe);
    if (m) {
      const indent = m[1].length;
      const name = m[2];
      const startLine = i + 1;
      let j = i + 1;
      while (j < lines.length) {
        const ln = lines[j];
        if (ln.trim() === '') { j++; continue; }
        const lead = ln.match(/^(\s*)/)[1].length;
        if (lead <= indent) break;
        j++;
      }
      const body = lines.slice(i + 1, j).join('\n');
      out.push({
        name,
        complexity: complexityForFunction(body, 'python'),
        startLine,
        endLine: j,
      });
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

function extractTsFns(text) {
  const out = [];
  const re = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>[\]|&,\s]+)?\s*\{|(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w]+)\s*=>\s*\{|(?:^|\n)\s*(?:public|private|protected|static|async)?\s*(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>[\]|&,\s]+)?\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1] || m[2] || m[3];
    if (!name) continue;
    if (['if', 'for', 'while', 'switch', 'return', 'catch', 'else'].includes(name)) continue;
    const matchStart = m.index;
    const matchedStr = m[0];
    const braceOffset = matchedStr.lastIndexOf('{');
    if (braceOffset < 0) continue;
    const braceIdx = matchStart + braceOffset;
    const endIdx = matchBrace(text, braceIdx);
    if (endIdx < 0) continue;
    const body = text.slice(braceIdx + 1, endIdx);
    const startLine = lineOf(text, matchStart) + 1;
    const endLine = lineOf(text, endIdx) + 1;
    out.push({
      name,
      complexity: complexityForFunction(body, 'typescript'),
      startLine,
      endLine,
    });
  }
  return out;
}

function extractDartFns(text) {
  const out = [];
  const re = /(?:^|\n)\s*(?:[\w<>?,\s]+\s+)?(\w+)\s*\([^)]*\)\s*(?:async\s*\*?\s*)?\{/g;
  let m;
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'else', 'do']);
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    if (!name || KEYWORDS.has(name)) continue;
    const matchStart = m.index;
    const braceIdx = text.indexOf('{', matchStart);
    if (braceIdx < 0) continue;
    const endIdx = matchBrace(text, braceIdx);
    if (endIdx < 0) continue;
    const body = text.slice(braceIdx + 1, endIdx);
    const startLine = lineOf(text, matchStart) + 1;
    const endLine = lineOf(text, endIdx) + 1;
    out.push({
      name,
      complexity: complexityForFunction(body, 'dart'),
      startLine,
      endLine,
    });
  }
  return out;
}

/**
 * Given index of `{` in text, find the matching `}` index. Skips strings
 * and comments crudely. Returns -1 if unmatched.
 */
function matchBrace(text, openIdx) {
  let depth = 0;
  let i = openIdx;
  let inStr = null;
  let inLine = false;
  let inBlock = false;
  for (; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inLine) {
      if (c === '\n') inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i++; }
      continue;
    }
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineOf(text, idx) {
  let n = 0;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}
