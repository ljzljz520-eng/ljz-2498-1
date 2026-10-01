import { newClauseId } from '../../../shared/src/index.js';

export async function ensureClauseIdentities(store, { documentId = null, templateVersionId = null, nodes, sourceTemplateId = null, sourceVersionId = null }) {
  const existing = await store.list('clauseIdentities', item => documentId ? item.documentId === documentId : item.templateVersionId === templateVersionId);
  const seen = new Set(existing.map(item => item.id));
  const created = [];
  const walk = async list => {
    for (const node of list) {
      if (!seen.has(node.id)) {
        const identity = {
          id: node.id,
          documentId,
          templateVersionId,
          sourceClauseId: node.sourceId ?? node.splitFromId ?? null,
          sourceTemplateId: node.sourceTemplateId ?? sourceTemplateId ?? null,
          sourceVersionId: node.sourceVersionId ?? sourceVersionId ?? null,
          kind: node.kind ?? 'clause'
        };
        await store.put('clauseIdentities', identity);
        created.push(identity);
        seen.add(node.id);
      }
      if (Array.isArray(node.children) && node.children.length) await walk(node.children);
    }
  };
  await walk(nodes);
  return created;
}

export function freshClauseId() { return newClauseId(); }
