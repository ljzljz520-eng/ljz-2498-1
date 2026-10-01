// Stable identity factories. Clause identity (id) is independent of any
// display number: numbers are computed at render time from tree order.

let counter = 0;
export function newId(prefix = 'b') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function block({ id, parentId = null, kind = 'clause', title = '', body = '', page = null, origin = null }) {
  return {
    id: id || newId(kind === 'annex' ? 'anx' : 'cls'),
    parentId,
    kind, // 'clause' | 'annex'  (annexes are still clauses identity-wise, typed for display numbering)
    title,
    body,
    // page = { orientation: 'portrait'|'landscape', header?, footer? }
    // A non-null page opens a new page SCOPE: settings apply to this block
    // and its descendants until another block opens a scope.
    page: page || null,
    // origin = { templateId, versionId, blockId } provenance for reuse/upgrade
    origin: origin || null,
  };
}

export function template({ id = newId('tpl'), name, currentVersionId = null }) {
  return { id, name, currentVersionId, createdAt: new Date().toISOString() };
}

export function templateVersion({ id = newId('ver'), templateId, parentVersionId = null, version, blocks = [], variables = [], note = '' }) {
  return {
    id, templateId, parentVersionId, version, note,
    blocks,
    variables, // [{name,label,required,default}]
    createdAt: new Date().toISOString(),
  };
}

export function doc({ id = newId('doc'), title, templateId = null, baselineVersionId = null, edits, deletes, moves, inserts, values, varMap, lineage } = {}) {
  return {
    id, title, templateId, baselineVersionId,
    // diff layer against the baseline version:
    edits: edits || {},
    deletes: deletes || [],
    moves: moves || [],
    inserts: inserts || [],
    values: values || {},
    varMap: varMap || {},
    lineage: lineage || [],
    updatedAt: new Date().toISOString(),
  };
}

export function moveSpec(id, parentId, afterId) { return { id, parentId, afterId }; }
