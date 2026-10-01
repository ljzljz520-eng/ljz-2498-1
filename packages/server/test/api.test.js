import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/index.js';

let app, svc, tplId, verId, docId, snapId;

before(async () => {
  const built = await buildServer();
  app = built.app;
  const tpls = await app.inject({ method: 'GET', url: '/api/templates' });
  tplId = tpls.json()[0].id;
  const vers = await app.inject({ method: 'GET', url: `/api/templates/${tplId}/versions` });
  verId = vers.json()[0].id;
});
after(async () => app.close());

const j = (r) => r.json();

test('end-to-end: reuse -> edit/move -> validate blocks -> fill -> snapshot -> export guard', async () => {
  // 1. create doc from template (reuse)
  let r = await app.inject({ method: 'POST', url: '/api/docs', payload: { title: '测试服务合同', versionId: verId } });
  assert.equal(r.statusCode, 200);
  docId = j(r).doc.id;
  assert.ok(j(r).migration);

  // 2. validation must block due to unmapped required vars
  r = await app.inject({ method: 'GET', url: `/api/docs/${docId}/validate` });
  assert.equal(j(r).ok, false);
  assert.ok(j(r).errors.some((e) => e.code === 'UNMAPPED_VAR'));

  // 3. insert a new clause and move scope right after it; verify renumber only
  r = await app.inject({ method: 'POST', url: `/api/docs/${docId}/blocks`, payload: { title: '新增：通知', body: '所有通知以书面形式送达。', afterId: null } });
  const newId = j(r).id;
  await app.inject({ method: 'POST', url: `/api/docs/${docId}/move`, payload: { id: 'scope', parentId: null, afterId: newId } });
  r = await app.inject({ method: 'GET', url: `/api/docs/${docId}/materialized` });
  const blocks = j(r).blocks;
  assert.equal(blocks[0].id, newId);
  assert.equal(blocks[1].id, 'scope');
  // cross-reference from 定义 still resolves to stable id 'scope' with new number
  r = await app.inject({ method: 'GET', url: `/api/docs/${docId}/preview` });
  const pv = j(r);
  const scopeNum = pv.numbering.find((n) => n.id === 'scope').number;
  assert.equal(scopeNum, '第二条');
  assert.ok(pv.references.resolved.some((x) => x.target === 'scope' && x.label === scopeNum));

  // 4. fill variables
  r = await app.inject({ method: 'PUT', url: `/api/docs/${docId}/values`, payload: { values: { party_a: '甲公司', party_b: '乙公司', amount: '99,000' } } });
  r = await app.inject({ method: 'GET', url: `/api/docs/${docId}/validate` });
  assert.equal(j(r).ok, true, JSON.stringify(j(r).errors));
  assert.ok(j(r).warnings.some((w) => w.code === 'MISSING_FONT'));
  assert.ok(j(r).warnings.some((w) => w.code === 'LONG_TABLE'));

  // 5. review snapshot
  r = await app.inject({ method: 'POST', url: `/api/docs/${docId}/snapshots`, payload: { reviewer: '法务-张', action: 'approve', comment: '同意' } });
  assert.equal(r.statusCode, 200);
  snapId = j(r).id;

  // 6. print and export use same snapshot
  const print = await app.inject({ method: 'GET', url: `/api/snapshots/${snapId}/print` });
  assert.match(print.body, /甲公司/);

  // 7. edit 落款 AFTER review -> export blocked (409)
  await app.inject({ method: 'PATCH', url: `/api/docs/${docId}/blocks/signature`, payload: { body: '甲方：甲公司（变更）\n乙方：乙公司' } });
  r = await app.inject({ method: 'POST', url: `/api/docs/${docId}/export`, payload: { snapshotId: snapId, format: 'html' } });
  assert.equal(r.statusCode, 409);
  assert.match(j(r).error, /REVIEW_STALE/);
  const records = (await app.inject({ method: 'GET', url: `/api/docs/${docId}/records` })).json();
  assert.ok(records.some((x) => x.meta?.blocked));

  // 8. re-review, then export succeeds
  r = await app.inject({ method: 'POST', url: `/api/docs/${docId}/snapshots`, payload: { reviewer: '法务-张', action: 'approve' } });
  snapId = j(r).id;
  r = await app.inject({ method: 'POST', url: `/api/docs/${docId}/export`, payload: { snapshotId: snapId, format: 'html' } });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /本软件仅对用户提供的内容进行排版/);
});

test('template upgrade: conflict preview and manual adoption over API', async () => {
  // create v2 with upstream edit to scope body + new clause
  const ver = await (await app.inject({ method: 'GET', url: `/api/versions/${verId}` })).json();
  const v2blocks = ver.blocks.map((b) => b.id === 'scope' ? { ...b, body: 'UPSTREAM 新服务范围' } : b);
  v2blocks.push({ id: 'new_upstream', parentId: null, kind: 'clause', title: '合规要求', body: '遵守数据合规要求。', page: null, origin: null });
  const v2 = await app.inject({
    method: 'POST', url: `/api/templates/${tplId}/versions`,
    payload: { version: '2.0.0', blocks: v2blocks, variables: ver.variables },
  });
  const v2id = j(v2).id;

  // fresh doc on v1 with LOCAL edit to same scope body -> edit/edit conflict
  const d = await app.inject({ method: 'POST', url: '/api/docs', payload: { title: '升级用', versionId: verId } });
  const did = j(d).doc.id;
  await app.inject({ method: 'PATCH', url: `/api/docs/${did}/blocks/scope`, payload: { body: 'LOCAL 定制范围' } });

  const prev = await app.inject({ method: 'GET', url: `/api/docs/${did}/upgrade/${v2id}` });
  const p = j(prev).preview;
  assert.ok(p.hasConflicts);
  assert.equal(p.conflicts[0].type, 'edit-edit');
  assert.ok(p.changes.added.includes('new_upstream'));

  // adopt without decision -> 500 thrown as error code UNRESOLVED_CONFLICT
  let r = await app.inject({ method: 'POST', url: `/api/docs/${did}/upgrade/${v2id}`, payload: { decisions: {} } });
  assert.notEqual(r.statusCode, 200);
  // adopt with local
  r = await app.inject({ method: 'POST', url: `/api/docs/${did}/upgrade/${v2id}`, payload: { decisions: { 0: 'local' } } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(j(r).doc.baselineVersionId, v2id);
});

test('strategy comparison reports identical render with far smaller diff layer', async () => {
  const d = await app.inject({ method: 'POST', url: '/api/docs', payload: { title: '对比', versionId: verId } });
  const did = j(d).doc.id;
  await app.inject({ method: 'PATCH', url: `/api/docs/${did}/blocks/scope`, payload: { body: '小改动' } });
  const r = await app.inject({ method: 'GET', url: `/api/docs/${did}/comparison` });
  const c = j(r);
  assert.equal(c.equivalentRender, true);
  assert.ok(c.diffLayerBytes < c.fullCopyBytes);
});
