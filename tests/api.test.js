import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/src/app.js';

async function setupServer() {
  const app = await createApp({ seed: true, requiredFonts: ['Definitely Missing Contract Font'] });
  app.listen(0);
  await once(app, 'listening');
  const port = app.address().port;
  const base = `http://127.0.0.1:${port}`;
  return { app, base };
}

async function json(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  return { response, payload };
}

test('服务端拆分、移动后重编号且交叉引用保持指向稳定条款', async () => {
  const { app, base } = await setupServer();
  try {
    const { payload: docList } = await json(base, '/api/documents');
    const docId = docList.items[0].id;
    let doc = (await json(base, `/api/documents/${docId}`)).payload;
    const acceptance = doc.nodes.find(n => n.title === '验收');
    const split = await json(base, `/api/documents/${docId}/split`, {
      method: 'POST',
      body: { clauseId: acceptance.id, beforeBody: '验收分为初验、试运行和终验。', afterBody: '续条补充内容。', title: '验收（续）' }
    });
    assert.equal(split.response.status, 200);
    assert.equal(split.payload.nodes.find(n => n.id === acceptance.id).body, '验收分为初验、试运行和终验。');
    assert.ok(split.payload.nodes.some(n => n.splitFromId === acceptance.id));
    doc = split.payload;
    const attachment = doc.nodes.find(n => n.kind === 'attachment');
    const moved = await json(base, `/api/documents/${docId}/move`, { method: 'POST', body: { clauseId: attachment.id, newParentId: null, index: 1 } });
    assert.equal(moved.response.status, 200);
    assert.equal(moved.payload.validation.errors.filter(e => e.code === 'BROKEN_REFERENCE').length, 0);
  } finally {
    app.close();
  }
});

test('审阅快照固定落款；导出期间后续修改不会污染打印/PDF同一快照', async () => {
  const { app, base } = await setupServer();
  try {
    const docId = (await json(base, '/api/documents')).payload.items[0].id;
    const created = await json(base, `/api/documents/${docId}/snapshots`, { method: 'POST', body: { reason: 'frozen' } });
    const snapshotId = created.payload.id;
    assert.equal(created.payload.signoff.date, '2026-10-01');
    const updated = await json(base, `/api/documents/${docId}/signoff`, { method: 'POST', body: { signoff: { date: '2026-12-31', partyA: '导出期间新甲方', partyB: '乙方' } } });
    assert.equal(updated.response.status, 200);
    const frozen = (await json(base, `/api/snapshots/${snapshotId}`)).payload;
    assert.equal(frozen.signoff.date, '2026-10-01');
    assert.equal(frozen.payload.signoff.partyA, '杭州星河科技有限公司');
    const printed = await json(base, `/api/snapshots/${snapshotId}/export`, { method: 'POST', body: { format: 'print' } });
    assert.equal(printed.response.status, 200);
    assert.equal(printed.payload.snapshotId, snapshotId);
    const formalPdf = await json(base, `/api/snapshots/${snapshotId}/export`, { method: 'POST', body: { format: 'pdf' } });
    assert.equal(formalPdf.response.status, 422);
    assert.equal(formalPdf.payload.error.code, 'EXPORT_BLOCKED');
    const records = (await json(base, `/api/snapshots/${snapshotId}/records`)).payload.items;
    assert.ok(records.some(r => r.action === 'printed'));
  } finally {
    app.close();
  }
});

test('模板升级冲突必须人工逐条采纳，采纳后本地修改仍保留稳定身份', async () => {
  const { app, base } = await setupServer();
  try {
    const docId = (await json(base, '/api/documents')).payload.items[0].id;
    let doc = (await json(base, `/api/documents/${docId}`)).payload;
    const acceptance = doc.nodes.find(n => n.title === '验收');
    const localMutation = await json(base, `/api/documents/${docId}/mutate`, {
      method: 'POST',
      body: { operation: { type: 'update', id: acceptance.id, patch: { body: '本地编辑后的验收条款' } }, actor: '测试' }
    });
    assert.equal(localMutation.response.status, 200);

    const child = await json(base, `/api/templates/${doc.document.currentVersionId}/child-versions`, {
      method: 'POST',
      body: {
        version: '1.1.0',
        operations: [{ type: 'update', id: acceptance.id, patch: { body: '上游模板的验收条款' } }],
        note: 'upstream'
      }
    });
    assert.equal(child.response.status, 201);
    const targetId = child.payload.version.id;
    const preview = await json(base, `/api/documents/${docId}/upgrades`, { method: 'POST', body: { targetVersionId: targetId } });
    assert.equal(preview.response.status, 200);
    assert.ok(preview.payload.conflicts.length >= 1);
    const conflictId = preview.payload.conflicts[0].id;
    const blocked = await json(base, `/api/documents/${docId}/upgrades/${targetId}/adopt`, { method: 'POST', body: { choices: {} } });
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.payload.error.code, 'UNRESOLVED_CONFLICT');
    const adopted = await json(base, `/api/documents/${docId}/upgrades/${targetId}/adopt`, {
      method: 'POST',
      body: { choices: { [conflictId]: { source: 'local' } } }
    });
    assert.equal(adopted.response.status, 200);
    assert.equal(adopted.payload.nodes.find(n => n.id === conflictId).body, '本地编辑后的验收条款');
    assert.equal(adopted.payload.document.currentVersionId, targetId);
  } finally {
    app.close();
  }
});
