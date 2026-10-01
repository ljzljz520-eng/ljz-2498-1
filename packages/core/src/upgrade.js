// Template upgrade: three-way merge over a baseline + diff layer.
// base = the version the doc currently inherits
// head = the new version (same template lineage, stable block ids)
// diff = the document's diff layer against base
//
// Conflict when the SAME block/field changed in BOTH head and diff.
// Everything else auto-merges. Result is a preview for HUMAN adoption:
// conflicts are returned, never silently overwritten.
import { proposeVarMapping } from './variables.js';

export function diffVersions(base, head) {
  const bm = new Map(base.blocks.map((b) => [b.id, b]));
  const hm = new Map(head.blocks.map((b) => [b.id, b]));
  const added = [], removed = [], changed = [];
  for (const id of hm.keys()) if (!bm.has(id)) added.push(id);
  for (const id of bm.keys()) {
    if (!hm.has(id)) removed.push(id);
    else {
      const a = bm.get(id), c = hm.get(id);
      const fields = [];
      if (a.title !== c.title) fields.push('title');
      if (a.body !== c.body) fields.push('body');
      if (JSON.stringify(a.page || null) !== JSON.stringify(c.page || null)) fields.push('page');
      if (a.parentId !== c.parentId) fields.push('parentId');
      if (fields.length) changed.push({ id, fields });
    }
  }
  return { added, removed, changed, orderChanged: !sameOrder(base, head) };
}

function sameOrder(a, b) {
  if (a.blocks.length !== b.blocks.length) return false;
  return a.blocks.every((x, i) => x.id === b.blocks[i].id && x.parentId === b.blocks[i].parentId);
}

export function threeWayMerge(base, head, diff = {}) {
  const dv = diffVersions(base, head);
  const edits = diff.edits || {};
  const deletes = new Set(diff.deletes || []);
  const conflicts = [];
  const autoHead = [];   // upstream changes the doc had not touched -> adopt
  const keepLocal = [];  // local-only edits -> preserved
  const dropped = [];    // blocks removed upstream that local layer references

  for (const ch of dv.changed) {
    const localFields = new Set(Object.keys(edits[ch.id] || {}));
    const overlap = ch.fields.filter((f) => localFields.has(f) && f !== 'parentId');
    if (overlap.length) {
      conflicts.push({
        type: 'edit-edit',
        blockId: ch.id,
        fields: overlap,
        base: pick(base, ch.id, overlap),
        head: pick(head, ch.id, overlap),
        local: pickLocal(edits[ch.id], overlap),
      });
    } else {
      autoHead.push({ blockId: ch.id, fields: ch.fields });
    }
    if (localFields.size && !overlap.length) keepLocal.push({ blockId: ch.id, fields: [...localFields] });
  }

  // upstream reorder vs local reorder
  if (dv.orderChanged && (diff.moves || []).length) {
    conflicts.push({ type: 'order-order', moveCount: diff.moves.length });
  }

  for (const id of dv.removed) {
    if (deletes.has(id)) continue;
    if (edits[id] || (diff.moves || []).some((m) => m.id === id)) {
      conflicts.push({ type: 'delete-edit', blockId: id });
    } else {
      dropped.push(id); // upstream deleted; doc never touched -> auto drop
    }
  }

  // variables: new vars in head must be mapped/filled; removed vars make
  // existing local values stale (reported, non-blocking).
  const bVars = new Set((base.variables || []).map((v) => v.name));
  const hVars = new Set((head.variables || []).map((v) => v.name));
  const addedVars = (head.variables || []).filter((v) => !bVars.has(v.name));
  const removedVars = (base.variables || []).filter((v) => !hVars.has(v.name));
  const proposal = proposeVarMapping(
    addedVars,
    // target context = variables already satisfied by the doc
    (head.variables || []).filter((v) => (diff.values || {})[v.name] !== undefined),
  );

  return {
    headVersionId: head.id,
    changes: dv,
    conflicts,
    autoHead,
    keepLocal,
    dropped,
    variables: { added: addedVars, removed: removedVars, unmapped: proposal.unmapped },
    hasConflicts: conflicts.length > 0 || proposal.unmapped.some((u) => u.required),
  };
}

function pick(ver, id, fields) {
  const b = ver.blocks.find((x) => x.id === id);
  const o = {};
  for (const f of fields) o[f] = f === 'page' ? JSON.stringify(b[f] || null) : b[f];
  return o;
}
function pickLocal(edit, fields) {
  const o = {};
  for (const f of fields) o[f] = f === 'page' ? JSON.stringify(edit[f] ?? null) : edit[f];
  return o;
}

// Produce a new diff layer against HEAD after human decisions.
// decisions: { [conflictIndex]: 'head'|'local', variables: {name: value} }
export function adoptMerge(base, head, diff, preview, decisions = {}) {
  if (preview.conflicts.length) {
    preview.conflicts.forEach((c, i) => {
      if (!decisions[i] || !['head', 'local'].includes(decisions[i])) {
        throw Object.assign(new Error('unresolved conflict'), { code: 'UNRESOLVED_CONFLICT', index: i });
      }
    });
  }
  const newDiff = {
    edits: JSON.parse(JSON.stringify(diff.edits || {})),
    deletes: [...(diff.deletes || [])],
    moves: diff.orderChanged && (diff.moves || []).length && decisions.order === 'head'
      ? [] : JSON.parse(JSON.stringify(diff.moves || [])),
    inserts: JSON.parse(JSON.stringify(diff.inserts || [])),
    values: { ...(diff.values || {}), ...(decisions.variables || {}) },
    varMap: { ...(diff.varMap || {}) },
  };
  preview.conflicts.forEach((c, i) => {
    if (c.type === 'edit-edit') {
      const d = decisions[i];
      if (d === 'head') delete newDiff.edits[c.blockId]; // take upstream text
      // 'local' keeps the edit as-is
    } else if (c.type === 'delete-edit') {
      if (decisions[i] === 'head') {
        newDiff.deletes.push(c.blockId);
        delete newDiff.edits[c.blockId];
        newDiff.moves = newDiff.moves.filter((m) => m.id !== c.blockId);
      }
    }
  });
  // edits against blocks upstream removed (auto-drop) must be discarded
  for (const id of preview.dropped) delete newDiff.edits[id];
  newDiff.baselineVersionId = head.id;
  return newDiff;
}
