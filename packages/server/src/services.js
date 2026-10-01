// Orchestration over core domain logic + repository.
import {
  materialize, computeNumbering, resolveReferences, validateForExport,
  renderHTML, makeSnapshot, snapshotStale, threeWayMerge, adoptMerge,
  compareStrategies, detectCycles, doc as makeDoc, newId, proposeVarMapping,
  template as makeTpl, templateVersion as makeVer, block as makeBlock,
  contentHash,
} from '@ct/core';

export class Services {
  constructor(repo, { fonts = ['DejaVu Serif'], requiredFonts = [{ family: 'Noto Serif CJK SC', why: '中文正文', fallback: 'DejaVu Serif' }] } = {}) {
    this.repo = repo;
    this.fonts = fonts;
    this.requiredFonts = requiredFonts;
  }

  async materializeDoc(d) {
    const ver = await this.repo.getVersion(d.baselineVersionId);
    return { blocks: materialize(ver.blocks, d.diff || {}), version: ver };
  }

  // Create a document by reusing a template (baseline + diff layer strategy).
  // varMap migration is captured; unmapped required vars are returned so the
  // UI can force explicit mapping before any formal export.
  async createDocFromTemplate({ title, versionId, sourceDocId = null, varMap = {}, values = {} }) {
    const ver = await this.repo.getVersion(versionId);
    if (!ver) throw httpErr(404, 'version not found');
    const migration = proposeVarMapping(
      ver.variables.filter((v) => v.required),
      Object.keys(values).map((name) => ({ name })),
    );
    const d = {
      id: newId('doc'), title: title || '未命名合同',
      templateId: ver.templateId, baselineVersionId: versionId, sourceDocId,
      diff: { edits: {}, deletes: [], moves: [], inserts: [] },
      values, varMap: { ...varMap },
      lineage: [{ templateId: ver.templateId, versionId, at: new Date().toISOString() }],
    };
    await this.repo.createDoc(d);
    return { doc: d, migration };
  }

  async updateDiff(docId, patch) {
    const d = await this.repo.getDoc(docId);
    if (!d) throw httpErr(404, 'doc not found');
    d.diff = mergeDiff(d.diff || {}, patch);
    return this.repo.saveDoc(d);
  }

  async insertBlock(docId, b) {
    const d = await this.repo.getDoc(docId);
    const blk = makeBlock({ title: b.title || '', body: b.body || '', kind: b.kind || 'clause' });
    d.diff.inserts.push(blk);
    const afterId = b.afterId ?? null;
    d.diff.moves.push({ id: blk.id, parentId: b.parentId || null, afterId });
    await this.repo.saveDoc(d);
    return blk;
  }

  async moveBlock(docId, { id, parentId = null, afterId = null }) {
    const d = await this.repo.getDoc(docId);
    d.diff.moves = d.diff.moves.filter((m) => m.id !== id);
    d.diff.moves.push({ id, parentId, afterId });
    await this.repo.saveDoc(d);
    return d.diff;
  }

  async editBlock(docId, id, edit) {
    const d = await this.repo.getDoc(docId);
    d.diff.edits[id] = { ...(d.diff.edits[id] || {}), ...edit };
    await this.repo.saveDoc(d);
    return d.diff.edits[id];
  }

  async deleteBlock(docId, id) {
    const d = await this.repo.getDoc(docId);
    if (!d.diff.deletes.includes(id)) d.diff.deletes.push(id);
    await this.repo.saveDoc(d);
    return d.diff;
  }

  async setValues(docId, values) {
    const d = await this.repo.getDoc(docId);
    d.values = { ...d.values, ...values };
    await this.repo.saveDoc(d);
    return d.values;
  }

  async setVarMapping(docId, varMap) {
    const d = await this.repo.getDoc(docId);
    d.varMap = { ...d.varMap, ...varMap };
    await this.repo.saveDoc(d);
    return d.varMap;
  }

  async preview(docId, { strict = false } = {}) {
    const d = await this.repo.getDoc(docId);
    const { blocks, version } = await this.materializeDoc(d);
    const meta = computeNumbering(blocks);
    const refs = resolveReferences(blocks, meta);
    const html = renderHTML(
      { title: d.title, blocks, values: d.values, signatureBlock: null },
      { strict, fonts: this.fonts, declared: version.variables },
    );
    return {
      html,
      numbering: [...meta.entries()].map(([id, m]) => ({ id, ...m })),
      references: refs,
      cycles: detectCycles(blocks),
      contentHash: d.contentHash,
    };
  }

  async validate(docId) {
    const d = await this.repo.getDoc(docId);
    const { blocks, version } = await this.materializeDoc(d);
    return validateForExport(blocks, {
      variables: version.variables,
      values: d.values, varMap: d.varMap,
      availableFonts: this.fonts,
      requiredFonts: this.requiredFonts,
    });
  }

  async comparison(docId) {
    const d = await this.repo.getDoc(docId);
    const ver = await this.repo.getVersion(d.baselineVersionId);
    return compareStrategies(ver.blocks, d.diff || {});
  }

  async upgradePreview(docId, targetVersionId) {
    const d = await this.repo.getDoc(docId);
    const base = await this.repo.getVersion(d.baselineVersionId);
    const head = await this.repo.getVersion(targetVersionId);
    if (!head || head.templateId !== d.templateId) throw httpErr(400, 'target version not in same template lineage');
    return { preview: threeWayMerge(base, head, d.diff), baseVersionId: base.id, targetVersionId };
  }

  async upgradeAdopt(docId, targetVersionId, decisions) {
    const d = await this.repo.getDoc(docId);
    const base = await this.repo.getVersion(d.baselineVersionId);
    const head = await this.repo.getVersion(targetVersionId);
    const preview = threeWayMerge(base, head, d.diff);
    const newDiff = adoptMerge(base, head, d.diff, preview, decisions);
    d.baselineVersionId = targetVersionId;
    d.diff = { edits: newDiff.edits, deletes: newDiff.deletes, moves: newDiff.moves, inserts: newDiff.inserts };
    d.values = newDiff.values || d.values;
    d.lineage.push({ templateId: d.templateId, versionId: targetVersionId, at: new Date().toISOString() });
    await this.repo.saveDoc(d);
    return { doc: d, unresolvedVariables: preview.variables.unmapped };
  }

  // ---- review snapshot + export -------------------------------------------------

  async createSnapshot(docId, { reviewer = 'reviewer', action = 'submit', comment = '' } = {}) {
    const d = await this.repo.getDoc(docId);
    const { blocks, version } = await this.materializeDoc(d);
    const sig = blocks.find((b) => b.id === 'signature');
    const snap = makeSnapshot({
      docId, version, blocks, doc: d, reviewer,
      signatureBlock: sig ? sig.body : null,
    });
    await this.repo.saveSnapshot(snap);
    await this.repo.addRecord({ docId, snapshotId: snap.id, action, comment, actor: reviewer });
    return snap;
  }

  async addReview(snapshotId, { action, comment = '', actor = 'reviewer' }) {
    const snap = await this.repo.getSnapshot(snapshotId);
    if (!snap) throw httpErr(404, 'snapshot not found');
    return this.repo.addRecord({ docId: snap.docId, snapshotId, action, comment, actor });
  }

  // Formal export: validates, then verifies the snapshot is still the current
  // content. Any change made between review and export (incl. 落款) blocks it.
  async exportDoc(docId, { snapshotId, format = 'pdf', actor = 'reviewer' } = {}) {
    const d = await this.repo.getDoc(docId);
    const snap = await this.repo.getSnapshot(snapshotId);
    if (!snap || snap.docId !== docId) throw httpErr(404, 'snapshot not found');

    const { blocks } = await this.materializeDoc(d);
    if (snapshotStale(snap, blocks, d)) {
      await this.repo.addRecord({ docId, snapshotId, action: 'export', comment: '导出被阻止：审阅后内容已变更（含落款）', actor, meta: { blocked: true } });
      throw httpErr(409, 'REVIEW_STALE: 文档在审阅后发生变化，请重新审阅后再导出');
    }
    const ver = await this.repo.getVersion(d.baselineVersionId);
    const validation = validateForExport(snap.payload.blocks, {
      variables: ver.variables,
      values: snap.payload.values,
      availableFonts: this.fonts, requiredFonts: this.requiredFonts,
    });
    if (!validation.ok) {
      throw httpErr(422, 'EXPORT_BLOCKED', validation.errors);
    }
    const html = renderHTML(snap.payload, { strict: true, fonts: this.fonts, declared: ver.variables });
    const rec = await this.repo.addExport({ docId, snapshotId, format, status: 'ok', warnings: validation.warnings });
    await this.repo.addRecord({ docId, snapshotId, action: format === 'print' ? 'print' : 'export', comment: `导出 ${format}`, actor, meta: { warnings: validation.warnings } });
    return { html, warnings: validation.warnings, exportId: rec.id, snapshotId, contentHash: snap.contentHash };
  }

  async printHtml(snapshotId) {
    const snap = await this.repo.getSnapshot(snapshotId);
    if (!snap) throw httpErr(404, 'snapshot not found');
    // Same snapshot -> same HTML as PDF.
    const d = await this.repo.getDoc(snap.docId);
    const ver = await this.repo.getVersion(d.baselineVersionId);
    return renderHTML(snap.payload, { strict: true, fonts: this.fonts, declared: ver.variables });
  }
}

function mergeDiff(base, patch) {
  return {
    edits: { ...(base.edits || {}), ...(patch.edits || {}) },
    deletes: [...new Set([...(base.deletes || []), ...(patch.deletes || [])])],
    moves: [...(base.moves || []).filter((m) => !(patch.moves || []).some((n) => n.id === m.id)), ...(patch.moves || [])],
    inserts: [...(base.inserts || []), ...(patch.inserts || [])],
  };
}

export function httpErr(status, code, details) {
  const e = new Error(typeof code === 'string' ? code : 'http error');
  e.statusCode = status; e.code = code; e.details = details;
  return e;
}
