// Immutable review snapshots. Printing and PDF export MUST render the SAME
// snapshot: review comments/signatures attach to snapshotId, and export is
// blocked if the working doc changed since the snapshot was reviewed.
import { fnv1a } from './hash.js';

// Deterministic content hash (FNV-1a over canonical JSON). Not a security
// primitive — it is a tamper/staleness detector during one export session.
export function contentHash(obj) {
  return fnv1a(canonical(obj));
}

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export function makeSnapshot({ docId, version, blocks, numbering, doc, reviewer, signatureBlock }) {
  const now = new Date().toISOString();
  const payload = contentFields({
    docId,
    baselineVersionId: version?.id || doc?.baselineVersionId || null,
    templateId: version?.templateId || doc?.templateId || null,
    title: doc?.title || '',
    blocks,
    values: doc?.values || {},
    signatureBlock: signatureBlock || null,
    reviewer: reviewer || null,
  });
  const wrapped = { ...payload, at: now };
  return {
    id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    docId,
    at: now,
    reviewer: reviewer || null,
    contentHash: contentHash(payload),
    payload: wrapped,
  };
}

// Compare the current working content hash with the reviewed snapshot.
// A mismatch (including signature/落款 edits made DURING export) blocks export.
export function snapshotStale(snapshot, currentBlocks, currentDoc) {
  const current = contentFields({
    docId: snapshot.docId,
    baselineVersionId: snapshot.payload.baselineVersionId,
    templateId: snapshot.payload.templateId,
    title: currentDoc?.title ?? snapshot.payload.title,
    blocks: currentBlocks,
    values: currentDoc?.values ?? snapshot.payload.values,
    signatureBlock: snapshot.payload.signatureBlock,
    reviewer: snapshot.reviewer,
  });
  return contentHash(current) !== snapshot.contentHash;
}

function contentFields(f) {
  return {
    docId: f.docId,
    baselineVersionId: f.baselineVersionId,
    templateId: f.templateId,
    title: f.title,
    blocks: f.blocks,
    values: f.values,
    signatureBlock: f.signatureBlock,
    reviewer: f.reviewer,
  };
}
