// Acceptance: clause splitting.
// The ORIGINAL clause keeps its identity (and therefore keeps every
// [[#id]] reference pointing at it). Split-off text becomes NEW clauses
// inserted immediately after the original; references to the original still
// resolve to the original content, never silently to a fragment.
import { newId } from './model.js';

export function splitClause(block, segments, { kind = 'clause' } = {}) {
  if (!segments.length) throw new Error('split requires at least one segment');
  const keeps = { ...block, body: segments[0], page: block.page ? { ...block.page } : null };
  const created = segments.slice(1).map((body, i) => ({
    id: newId('cls'),
    parentId: block.parentId,
    kind,
    title: block.title ? `${block.title}（续${i + 1}）` : '',
    body,
    page: null,
    origin: null,
    splitFrom: block.id,
  }));
  return { keeps, created };
}

// Append split results into a doc diff layer (edits original + inserts new
// + moves that place fragments right after the original at same level).
export function applySplitToDoc(doc, blockId, segments) {
  const existing = (doc.inserts || []).find((b) => b.id === blockId);
  if (!existing) throw new Error('split target not found in doc inserts (split operates on a working block)');
  const { keeps, created } = splitClause(existing, segments);
  doc.inserts = (doc.inserts || []).map((b) => (b.id === blockId ? keeps : b));
  let after = blockId;
  for (const c of created) {
    doc.inserts.push(c);
    doc.moves = doc.moves || [];
    doc.moves = doc.moves.filter((m) => m.id !== c.id);
    doc.moves.push({ id: c.id, parentId: keeps.parentId, afterId: after });
    after = c.id;
  }
  return { keeps, created };
}
