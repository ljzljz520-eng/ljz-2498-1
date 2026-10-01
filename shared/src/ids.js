export function stableId(prefix = 'cls') {
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex.slice(0, 8)}${hex.slice(8, 12)}${hex.slice(12, 16)}${hex.slice(16)}`;
}

export function newClauseId() { return stableId('cl'); }
export function newDocumentId() { return stableId('doc'); }
export function newTemplateId() { return stableId('tpl'); }
export function newVersionId() { return stableId('ver'); }
export function newSnapshotId() { return stableId('snap'); }
export function newReviewId() { return stableId('rev'); }
export function newExportId() { return stableId('exp'); }
