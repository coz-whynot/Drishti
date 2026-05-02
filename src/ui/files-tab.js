// Files tab — renders snapshot.fileTree as a left-side directory tree with a
// right-side preview pane. Click a file to load its inlined content; click a
// folder to expand/collapse. Keyboard navigation is intentionally minimal in
// v0.8 — focus + arrow keys land in v0.8.1 if there's demand.
//
// State persists across re-renders so expanded folders survive watch-mode
// snapshot updates.

const FILES_STATE = {
  selectedPath: null,
  expanded: new Set(),       // set of relPath of expanded directories
  searchText: '',
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function setBody(el, html) {
  Object.assign(el, { innerHTML: html });
}

// Build a nested tree { name, path, isDir, children?: {...}, file?: fileObj }
// from the flat fileTree.files list.
function buildNested(files) {
  const root = { name: '', path: '', isDir: true, children: new Map() };
  for (const f of files) {
    const parts = f.relPath.split('/');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join('/');
      if (!cur.children.has(part)) {
        cur.children.set(part, {
          name: part,
          path: childPath,
          isDir: !isFile,
          children: isFile ? null : new Map(),
          file: isFile ? f : null,
        });
      }
      cur = cur.children.get(part);
    }
  }
  return root;
}

function renderTreeNode(node, depth) {
  if (node.isDir) {
    const isExpanded = FILES_STATE.expanded.has(node.path) || depth === 0;
    const caret = isExpanded ? '▼' : '▶';
    const childArr = [...(node.children?.values() || [])].sort(sortNode);
    const childHtml = isExpanded
      ? childArr.map(c => renderTreeNode(c, depth + 1)).join('')
      : '';
    if (depth === 0) return childHtml;   // root node has no row, just children
    return (
      '<div class="ft-row ft-dir" data-path="' + escapeHtml(node.path) + '" data-kind="dir" style="padding-left:' + (depth * 14) + 'px">' +
      '<span class="ft-caret">' + caret + '</span>' +
      '<span class="ft-icon">📁</span>' +
      '<span class="ft-name">' + escapeHtml(node.name) + '</span>' +
      '</div>' +
      '<div class="ft-children">' + childHtml + '</div>'
    );
  } else {
    const f = node.file;
    const icon = f.isText ? (f.isInlined ? '📄' : '📃') : '📦';
    const sizeLabel = formatBytes(f.size);
    const isSelected = FILES_STATE.selectedPath === node.path;
    return (
      '<div class="ft-row ft-file ' + (isSelected ? 'selected' : '') + '" data-path="' + escapeHtml(node.path) + '" data-kind="file" style="padding-left:' + (depth * 14 + 14) + 'px">' +
      '<span class="ft-icon">' + icon + '</span>' +
      '<span class="ft-name">' + escapeHtml(node.name) + '</span>' +
      '<span class="ft-size">' + sizeLabel + '</span>' +
      '</div>'
    );
  }
}

function sortNode(a, b) {
  // dirs first, then files; alpha within each.
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function renderPreview(file) {
  if (!file) {
    return '<div class="ft-preview-empty">Select a file to preview.</div>';
  }
  const header = '<div class="ft-preview-header">' +
    '<code>' + escapeHtml(file.relPath) + '</code>' +
    '<span class="ft-preview-meta">' + formatBytes(file.size) + ' · ' + escapeHtml(file.ext || '(no ext)') + '</span>' +
    '</div>';
  if (file.isInlined && file.content != null) {
    return header + '<pre class="ft-preview-content">' + escapeHtml(file.content) + '</pre>';
  }
  const reason = file.reason || (file.isText ? 'not inlined' : 'binary');
  return header + '<div class="ft-preview-empty">Preview unavailable: ' + escapeHtml(reason) + '.</div>';
}

export function renderFilesTab(getSnapshot) {
  const root = document.getElementById('tab-files');
  if (!root) return;
  const snapshot = getSnapshot();
  const tree = snapshot && snapshot.fileTree;
  if (!tree || !tree.files || tree.files.length === 0) {
    setBody(root, '<div class="files-empty">No files indexed in the snapshot.</div>');
    return;
  }
  const filtered = FILES_STATE.searchText
    ? { ...tree, files: tree.files.filter(f => f.relPath.toLowerCase().includes(FILES_STATE.searchText.toLowerCase())) }
    : tree;
  const nested = buildNested(filtered.files);
  const treeHtml = renderTreeNode(nested, 0);
  const selected = filtered.files.find(f => f.relPath === FILES_STATE.selectedPath);
  const headerHtml = '<div class="ft-toolbar">' +
    '<input id="ftSearch" type="text" placeholder="Filter files…" value="' + escapeHtml(FILES_STATE.searchText) + '" />' +
    '<span class="ft-counts">' + filtered.files.length + ' files' +
    (tree.truncated ? ' (truncated at 10,000)' : '') +
    '</span></div>';

  setBody(root,
    headerHtml +
    '<div class="ft-split">' +
      '<div class="ft-tree">' + treeHtml + '</div>' +
      '<div class="ft-preview">' + renderPreview(selected) + '</div>' +
    '</div>'
  );

  document.getElementById('ftSearch').addEventListener('input', e => {
    FILES_STATE.searchText = e.target.value;
    renderFilesTab(getSnapshot);
  });
  root.querySelectorAll('.ft-row').forEach(el => {
    el.addEventListener('click', () => {
      const p = el.getAttribute('data-path');
      const kind = el.getAttribute('data-kind');
      if (kind === 'dir') {
        if (FILES_STATE.expanded.has(p)) FILES_STATE.expanded.delete(p);
        else FILES_STATE.expanded.add(p);
      } else {
        FILES_STATE.selectedPath = p;
      }
      renderFilesTab(getSnapshot);
    });
  });
}
