// Materialize a version baseline + a document diff layer into an ordered
// block list with stable identities. Identity (block.id / origin.blockId)
// never changes on reorder; ordering and numbering are derived afterwards.

export function moveIndex(moves) {
  const m = new Map();
  for (const mv of moves || []) m.set(mv.id, mv);
  return m;
}

// baseline: version.blocks (ordered array). diff: doc.
export function materialize(baselineBlocks, diff = {}) {
  const edits = diff.edits || {};
  const deletes = new Set(diff.deletes || []);
  const moves = moveIndex(diff.moves);
  const afterOf = new Map();
  for (const mv of diff.moves || []) afterOf.set(mv.id, mv.afterId ?? null);
  const inserts = (diff.inserts || []).map((b) => ({ ...b }));

  const nodes = [];
  for (const b0 of baselineBlocks || []) {
    if (deletes.has(b0.id)) continue;
    const b = { ...b0, page: b0.page ? { ...b0.page } : null };
    const e = edits[b0.id];
    if (e) {
      if (e.title !== undefined) b.title = e.title;
      if (e.body !== undefined) b.body = e.body;
      if (e.page !== undefined) b.page = e.page ? { ...e.page } : null;
    }
    const mv = moves.get(b.id);
    if (mv) { b.parentId = mv.parentId; }
    nodes.push(b);
  }
  for (const b of inserts) {
    const mv = moves.get(b.id);
    if (mv) { b.parentId = mv.parentId; afterOf.set(b.id, mv.afterId ?? null); }
    nodes.push(b);
  }

  // Resolve order: depth-first by parentId with sibling ordering honoring
  // afterId anchors (baseline order otherwise preserved).
  const childrenOf = new Map();
  const has = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const pid = n.parentId && has.has(n.parentId) ? n.parentId : null;
    n.parentId = pid;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(n);
  }

  // Seed non-moved nodes in baseline order; insert moved nodes right after
  // their anchor (afterId === null / dangling => first), resolving chains.
  const orderGroup = (arr) => {
    const byId = new Map(arr.map((n) => [n.id, n]));
    const wantsAfter = new Map();
    for (const n of arr) if (afterOf.has(n.id)) wantsAfter.set(n.id, afterOf.get(n.id));

    const seq = arr.filter((n) => !wantsAfter.has(n.id)).map((n) => n.id);
    const insertOne = (id, seen = new Set()) => {
      if (seq.includes(id)) return;
      const a = wantsAfter.get(id);
      if (a != null && byId.has(a)) {
        if (wantsAfter.has(a) && !seq.includes(a)) {
          if (seen.has(a)) { seq.unshift(id); return; } // anchor cycle guard
          seen.add(id); insertOne(a, seen);
        }
        const idx = seq.indexOf(a);
        if (idx >= 0) { seq.splice(idx + 1, 0, id); return; }
      }
      seq.unshift(id);
    };
    for (const n of arr) insertOne(n.id);
    return seq.map((id) => byId.get(id));
  };

  const ordered = [];
  const walk = (pid) => {
    const group = orderGroup(childrenOf.get(pid) || []);
    for (const n of group) { ordered.push(n); walk(n.id); }
  };
  walk(null);
  return ordered;
}

// Compare strategies: full copy vs baseline + diff layer.
// Returns byte-ish metrics plus content-equivalence result so callers can
// see that both strategies render identically while storage/upgrade differ.
export function compareStrategies(baselineBlocks, diff) {
  const fullCopy = materialize(baselineBlocks, diff).map((b) => structuredCloneSafe(b));
  const diffOnly = {
    baselineBlockCount: (baselineBlocks || []).length,
    layerOps: (diff?.edits ? Object.keys(diff.edits).length : 0)
      + (diff?.deletes?.length || 0)
      + (diff?.moves?.length || 0)
      + (diff?.inserts?.length || 0),
    renderedBlockCount: fullCopy.length,
  };
  const renderedFromLayer = materialize(baselineBlocks, diff);
  let equivalent = fullCopy.length === renderedFromLayer.length;
  if (equivalent) {
    for (let i = 0; i < fullCopy.length; i++) {
      if (fullCopy[i].id !== renderedFromLayer[i].id
        || fullCopy[i].title !== renderedFromLayer[i].title
        || fullCopy[i].body !== renderedFromLayer[i].body) { equivalent = false; break; }
    }
  }
  return {
    fullCopyBytes: JSON.stringify(fullCopy).length,
    diffLayerBytes: JSON.stringify(pickDiff(diff)).length,
    baselineBytes: JSON.stringify(baselineBlocks || []).length,
    ...diffOnly,
    equivalentRender: equivalent,
  };
}

function pickDiff(d) {
  if (!d) return {};
  return { edits: d.edits || {}, deletes: d.deletes || [], moves: d.moves || [], inserts: d.inserts || [] };
}
function structuredCloneSafe(x) { return JSON.parse(JSON.stringify(x)); }
