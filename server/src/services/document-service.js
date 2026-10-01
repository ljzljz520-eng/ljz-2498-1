import {
  adoptUpgrade, applyTreeOps, assert, buildIndex, buildSnapshot, compareReusePlans, findNode,
  newDocumentId, nowIso, renderSnapshot, resolveReferences, stableStringify, validateDocument
} from '../../../shared/src/index.js';
import { ensureClauseIdentities } from './identity-service.js';

export class DocumentService {
  constructor(store, templateService, fontService) {
    this.store = store;
    this.templates = templateService;
    this.fonts = fontService;
  }

  async createDocument({ title, templateVersionId, variableValues = {}, scope = {}, signoff = {}, variables = null }) {
    const resolved = await this.templates.resolveVersion(templateVersionId);
    const id = newDocumentId();
    const doc = {
      id,
      title,
      templateId: resolved.templateId,
      baseVersionId: templateVersionId,
      currentVersionId: templateVersionId,
      version: 1,
      localOperations: [],
      variables: variables ?? resolved.variables,
      variableValues,
      scope,
      signoff
    };
    await this.store.put('documents', doc);
    await ensureClauseIdentities(this.store, { documentId: id, nodes: resolved.nodes, sourceTemplateId: resolved.templateId, sourceVersionId: resolved.id });
    return this.getDocument(id);
  }

  async getDocument(id) {
    const doc = await this.store.get('documents', id);
    assert(doc, `文档不存在: ${id}`, 'NOT_FOUND');
    return doc;
  }

  async listDocuments() { return this.store.list('documents'); }

  async resolveDocument(id) {
    const doc = await this.getDocument(id);
    const base = await this.templates.resolveVersion(doc.currentVersionId);
    const nodes = applyTreeOps(base.nodes, doc.localOperations);
    const validation = validateDocument({
      nodes,
      variables: doc.variableValues,
      variableDefinitions: doc.variables,
      fontPolicy: {},
      availableFonts: this.fonts.availableFonts
    });
    return { document: doc, base, nodes, validation };
  }

  async mutateDocument(id, operation, { actor = 'anonymous', reason = '' } = {}) {
    const doc = await this.getDocument(id);
    const before = await this.resolveDocument(id);
    // Validate operation before appending.
    applyTreeOps(before.nodes, [operation]);
    doc.localOperations.push(operation);
    doc.version += 1;
    doc.updatedAt = nowIso();
    await this.store.put('documents', doc);
    await this.store.put('documentChanges', {
      id: undefined,
      documentId: id,
      documentVersion: doc.version,
      operation,
      actor,
      reason
    });
    const after = await this.resolveDocument(id);
    await ensureClauseIdentities(this.store, { documentId: id, nodes: after.nodes, sourceTemplateId: doc.templateId, sourceVersionId: doc.currentVersionId });
    return after;
  }

  async splitClause(id, clauseId, { beforeBody, afterBody, title, actor = 'anonymous' } = {}) {
    const current = await this.resolveDocument(id);
    const node = findNode(current.nodes, clauseId);
    assert(node, `条款不存在: ${clauseId}`, 'NOT_FOUND');
    return this.mutateDocument(id, { type: 'split', id: clauseId, beforeBody, afterBody, title }, { actor, reason: 'split-clause' });
  }

  async moveClause(id, clauseId, newParentId, index, actor = 'anonymous') {
    return this.mutateDocument(id, { type: 'move', id: clauseId, newParentId: newParentId ?? null, index }, { actor, reason: 'move-clause' });
  }

  async setVariables(id, values, { actor = 'anonymous' } = {}) {
    const doc = await this.getDocument(id);
    doc.variableValues = { ...doc.variableValues, ...values };
    doc.version += 1;
    await this.store.put('documents', doc);
    await this.store.put('documentChanges', {
      documentId: id, documentVersion: doc.version, operation: { type: 'variables', values }, actor, reason: 'set-variables'
    });
    return this.resolveDocument(id);
  }

  async updateSignoff(id, signoff, { actor = 'anonymous' } = {}) {
    const doc = await this.getDocument(id);
    doc.signoff = { ...doc.signoff, ...signoff };
    doc.version += 1;
    await this.store.put('documents', doc);
    await this.store.put('documentChanges', {
      documentId: id, documentVersion: doc.version, operation: { type: 'signoff', signoff: doc.signoff }, actor, reason: 'update-signoff'
    });
    return this.resolveDocument(id);
  }

  async compareReuse(id, { mappings = {}, mode = 'both' } = {}) {
    const current = await this.resolveDocument(id);
    const plans = compareReusePlans({
      sourceNodes: current.nodes,
      sourceTemplateId: current.document.templateId,
      sourceVersionId: current.document.currentVersionId,
      targetVariables: current.document.variables,
      mappings,
      regenerateIds: true
    });
    return {
      comparison: {
        fullCopy: summarizeNodes(plans.fullCopy.nodes, plans.fullCopy),
        baselineDiff: {
          ...plans.baselineDiff,
          summary: {
            operations: current.document.localOperations.length,
            duplicatedTemplateBytes: 0,
            upgradeSupported: true,
            provenancePreserved: true
          }
        }
      },
      variables: plans.variables,
      recommendation: plans.recommendation
    };
  }

  async previewUpgrade(id, targetVersionId) {
    const doc = await this.getDocument(id);
    const current = await this.resolveDocument(id);
    const preview = await this.templates.previewVersionUpgrade({
      documentBaseVersionId: doc.baseVersionId,
      currentParentVersionId: doc.currentVersionId,
      targetVersionId,
      localNodes: current.nodes,
      localOps: doc.localOperations
    });
    const unresolvedVariables = preview.variablePlan.added.filter(v => v.required !== false && !doc.variableValues[v.name]);
    return { ...preview, unresolvedVariables };
  }

  async adoptUpgrade(id, targetVersionId, choices, { actor = 'anonymous' } = {}) {
    const doc = await this.getDocument(id);
    const preview = await this.previewUpgrade(id, targetVersionId);
    const target = await this.templates.resolveVersion(targetVersionId);
    const { nodes } = adoptUpgrade({ preview, choices, parentNewNodes: target.nodes });
    // Materialize accepted upgrade as a new local full-tree baseline marker. The previous
    // base/version remains in template and change history for audit; current base advances.
    const oldBaseVersionId = doc.currentVersionId;
    const operations = await rebuildOperationsAgainstTarget(target.nodes, nodes);
    doc.baseVersionId = targetVersionId;
    doc.currentVersionId = targetVersionId;
    doc.localOperations = operations;
    doc.version += 1;
    doc.updatedAt = nowIso();
    await this.store.put('documents', doc);
    await this.store.put('documentChanges', {
      documentId: id,
      documentVersion: doc.version,
      operation: { type: 'adopt-template-upgrade', oldBaseVersionId, targetVersionId, choices, operationsCount: operations.length },
      actor,
      reason: 'manual-template-upgrade'
    });
    await ensureClauseIdentities(this.store, { documentId: id, nodes, sourceTemplateId: doc.templateId, sourceVersionId: targetVersionId });
    return this.resolveDocument(id);
  }

  async createReviewSnapshot(id, { reason = 'review', signoffOverride = undefined, actor = 'anonymous' } = {}) {
    const resolved = await this.resolveDocument(id);
    // Capture signoff before rendering. Later edits create a new document version and cannot mutate this row.
    const signoff = signoffOverride ?? resolved.document.signoff;
    const snapshot = buildSnapshot({
      document: resolved.document,
      nodes: resolved.nodes,
      variables: resolved.document.variableValues,
      variableDefinitions: resolved.document.variables,
      fontPolicy: { requiredFonts: this.fonts.requiredFonts },
      availableFonts: this.fonts.availableFonts,
      signoff,
      reason
    });
    const snapshotId = globalThis.crypto.randomUUID();
    snapshot.id = snapshotId;
    await this.store.put('reviewSnapshots', {
      id: snapshotId,
      documentId: id,
      documentVersion: resolved.document.version,
      reason,
      payload: snapshot,
      validation: snapshot.validation,
      signoff
    });
    await this.addReviewRecord(snapshotId, { action: 'created', comment: `创建审阅快照 v${resolved.document.version}`, actor });
    return this.getSnapshot(snapshotId);
  }

  async getSnapshot(snapshotId) {
    const row = await this.store.get('reviewSnapshots', snapshotId);
    assert(row, `审阅快照不存在: ${snapshotId}`, 'NOT_FOUND');
    return row;
  }

  async listSnapshots(id) {
    await this.getDocument(id);
    return this.store.list('reviewSnapshots', s => s.documentId === id);
  }

  async addReviewRecord(snapshotId, { action, comment = '', actor = 'anonymous' }) {
    const row = await this.getSnapshot(snapshotId);
    const id = globalThis.crypto.randomUUID();
    const record = { id, snapshotId, action, comment, actor };
    await this.store.put('reviewRecords', record);
    return record;
  }

  async listReviewRecords(snapshotId) {
    await this.getSnapshot(snapshotId);
    return this.store.list('reviewRecords', r => r.snapshotId === snapshotId);
  }

  async renderSnapshot(snapshotId, { format = 'html' } = {}) {
    const row = await this.getSnapshot(snapshotId);
    const rendered = renderSnapshot(row.payload);
    return { snapshot: row, format, ...rendered };
  }

  async exportSnapshot(snapshotId, { format = 'print', actor = 'anonymous' }) {
    const row = await this.getSnapshot(snapshotId);
    assert(['print', 'pdf', 'html'].includes(format), '导出格式必须是 print、pdf 或 html', 'INVALID_FORMAT');
    if (format !== 'print') {
      assert(row.validation?.ok, '正式导出被阻止：当前审阅快照存在验证错误', 'EXPORT_BLOCKED', row.validation.issues);
    }
    const id = globalThis.crypto.randomUUID();
    const job = {
      id,
      snapshotId,
      format,
      status: 'rendered',
      artifactPath: null,
      error: format === 'pdf' && !this.fonts.pdfRendererAvailable ? {
        code: 'PDF_RENDERER_UNAVAILABLE',
        message: '服务端未配置 Chromium/Playwright；请使用同一快照的浏览器打印为 PDF。'
      } : null,
      actor
    };
    if (format === 'pdf' && !this.fonts.pdfRendererAvailable) job.status = 'blocked';
    await this.store.put('exportJobs', job);
    await this.addReviewRecord(snapshotId, { action: format === 'print' ? 'printed' : 'exported', comment: `使用不可变快照 ${snapshotId} 输出 ${format}`, actor });
    return job;
  }

  async listExports(snapshotId) {
    return this.store.list('exportJobs', job => job.snapshotId === snapshotId);
  }
}

function summarizeNodes(nodes, extra) {
  let count = 0;
  let bytes = 0;
  const walk = list => list.forEach(node => {
    count += 1;
    bytes += stableStringify(node).length;
    (node.children ?? []).forEach(walk);
  });
  walk(nodes);
  return { mode: 'full-copy', ...extra, summary: { clauses: count, duplicatedTemplateBytes: bytes, upgradeSupported: false, provenancePreserved: true } };
}

async function rebuildOperationsAgainstTarget(targetNodes, acceptedNodes) {
  const targetIndex = buildIndex(targetNodes);
  const acceptedIndex = buildIndex(acceptedNodes);
  const operations = [];

  const added = [...acceptedIndex.paths.entries()]
    .filter(([id]) => !targetIndex.byId.has(id))
    .sort((a, b) => comparePath(a[1].path, b[1].path));
  for (const [id, info] of added) {
    const node = acceptedIndex.byId.get(id);
    const { children, ...rest } = node;
    operations.push({ type: 'insert', parentId: info.parentId, index: info.path.at(-1), node: rest });
    (node.children ?? []).forEach(child => {
      const childInfo = acceptedIndex.paths.get(child.id);
      if (childInfo) operations.push({ type: 'move', id: child.id, newParentId: node.id, index: childInfo.path.at(-1) });
    });
  }

  for (const [id, node] of acceptedIndex.byId) {
    const old = targetIndex.byId.get(id);
    if (!old) continue;
    const patch = {};
    for (const key of ['kind', 'title', 'body', 'scope', 'metadata']) {
      if (stableStringify(old[key]) !== stableStringify(node[key])) patch[key] = node[key];
    }
    if (Object.keys(patch).length) operations.push({ type: 'update', id, patch });
  }

  for (const [id, info] of acceptedIndex.paths) {
    const oldInfo = targetIndex.paths.get(id);
    if (!oldInfo) continue;
    if (oldInfo.parentId !== info.parentId || oldInfo.path.at(-1) !== info.path.at(-1)) {
      operations.push({ type: 'move', id, newParentId: info.parentId, index: info.path.at(-1) });
    }
  }

  for (const id of targetIndex.byId.keys()) {
    if (!acceptedIndex.byId.has(id)) operations.push({ type: 'delete', id });
  }
  return operations;
}

function comparePath(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}
