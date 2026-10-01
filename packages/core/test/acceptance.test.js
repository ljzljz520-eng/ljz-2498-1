import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  block, doc, templateVersion, materialize, computeNumbering,
  detectCycles, resolveReferences, substitute, splitClause,
  validateForExport, makeSnapshot, snapshotStale, renderHTML,
  threeWayMerge, adoptMerge, compareStrategies, proposeVarMapping,
  requiredScopes, parseTable, seedTemplate,
} from '../src/index.js';

test('insert/move renumber clauses but stable references keep pointing at same content', () => {
  const b1 = block({ id: 'a', title: 'A', body: 'see [[#c]]' });
  const b2 = block({ id: 'b', title: 'B', body: 'x' });
  const b3 = block({ id: 'c', title: 'C', body: 'target content' });
  const v = templateVersion({ blocks: [b1, b2, b3] });

  const before = computeNumbering(materialize(v.blocks, {}));
  assert.equal(before.get('c').number, '第三条');
  assert.equal(resolveReferences(materialize(v.blocks, {}), before).resolved[0].label, '第三条');

  // insert a new clause at top + move 'c' up to second
  const nb = block({ id: 'new1', title: 'NEW', body: 'fresh' });
  const d = doc({ inserts: [nb], moves: [
    { id: 'new1', parentId: null, afterId: null },
    { id: 'c', parentId: null, afterId: 'new1' },
  ] });
  const blocks = materialize(v.blocks, d);
  const after = computeNumbering(blocks);
  assert.equal(blocks[0].id, 'new1');
  assert.equal(after.get('new1').number, '第一条');
  assert.equal(after.get('a').number, '第三条');
  assert.equal(after.get('c').number, '第二条'); // renumbered!
  // but the reference from a still resolves to c and its content
  const refs = resolveReferences(blocks, after).resolved;
  const ref = refs.find((r) => r.from === 'a');
  assert.equal(ref.target, 'c');
  assert.equal(ref.label, '第二条');          // label follows display number
  assert.equal(ref.targetTitle, 'C');          // points at the same clause content
});

test('split keeps original id; references to it never follow a fragment', () => {
  const orig = block({ id: 'p', title: '验收', body: 'one\ntwo\nthree' });
  const ref = block({ id: 'r', body: '见[[#p]]' });
  const { keeps, created } = splitClause(orig, ['one', 'two', 'three']);
  assert.equal(keeps.id, 'p');
  assert.equal(keeps.body, 'one');
  assert.equal(created.length, 2);
  const blocks = [ref, keeps, ...created];
  const meta = computeNumbering(blocks);
  const hit = resolveReferences(blocks, meta).resolved.find((x) => x.from === 'r');
  assert.equal(hit.target, 'p');
  assert.equal(blocks.find((b) => b.id === hit.target).body, 'one');
});

test('cross-reference cycle is detected', () => {
  const a = block({ id: 'a', body: '[[#b]]' });
  const b = block({ id: 'b', body: '[[#c]]' });
  const c = block({ id: 'c', body: '[[#a]]' });
  const cycles = detectCycles([a, b, c]);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['a', 'b', 'c', 'a']);
});

test('long attachment table parsed with repeating header', () => {
  const { version } = seedTemplate();
  const t = parseTable(version.blocks.find((b) => b.id === 'annex1').body);
  assert.ok(t.rows.length > 60);
  assert.equal(t.headerRows[0].cells[1], '服务项');
});

test('landscape annex scope does not pollute following portrait text', () => {
  const { version } = seedTemplate();
  const blocks = materialize(version.blocks, {});
  const { scopes, scopeByBlock } = requiredScopes(blocks);
  const annexIdx = blocks.findIndex((b) => b.id === 'annex1');
  const after = blocks[annexIdx + 1]; // 其他
  assert.equal(scopeByBlock.get('annex1').orientation, 'landscape');
  assert.equal(scopeByBlock.get(after.id).orientation, 'portrait');
  assert.notEqual(scopeByBlock.get(after.id).scopeId, scopeByBlock.get('annex1').scopeId);
  assert.equal(scopes[0].orientation, 'portrait');
  assert.equal(scopes[1].orientation, 'landscape');
  assert.equal(scopes[2].orientation, 'portrait');
  assert.equal(scopes[2].resume, true);
});

test('unmapped required variables block formal export; mapped ones pass', () => {
  const { version } = seedTemplate();
  const blocks = materialize(version.blocks, {});
  const bad = validateForExport(blocks, { variables: version.variables, values: {} });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.code === 'UNMAPPED_VAR' && e.variable === 'party_a'));
  const good = validateForExport(blocks, {
    variables: version.variables,
    values: { party_a: '甲公司', party_b: '乙公司', amount: '100000' },
  });
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  assert.throws(() => substitute('{{party_a}}', { values: {} }, { strict: true }), /unmapped/);
});

test('missing font is a warning, not a blocker', () => {
  const { version } = seedTemplate();
  const blocks = materialize(version.blocks, {});
  const r = validateForExport(blocks, {
    variables: version.variables,
    values: { party_a: 'a', party_b: 'b', amount: '1' },
    availableFonts: ['DejaVu Serif'],
    requiredFonts: [{ family: 'Noto Serif CJK SC', why: '中文正文', fallback: 'DejaVu Serif' }],
  });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.code === 'MISSING_FONT'));
});

test('snapshot: changing 落款 during export makes snapshot stale and blocks export', () => {
  const { version } = seedTemplate();
  const d = doc({ title: '测试合同', templateId: version.templateId, baselineVersionId: version.id,
    values: { party_a: '甲', party_b: '乙', amount: '1' } });
  const blocks = materialize(version.blocks, d);
  const snap = makeSnapshot({ docId: d.id, version, blocks, doc: d, signatureBlock: '甲方：甲 乙方：乙' });
  assert.equal(snapshotStale(snap, blocks, d), false);

  // someone edits the signature/落款 block while export is in progress
  const edited = blocks.map((b) => b.id === 'signature' ? { ...b, body: b.body + '\n（已变更）' } : b);
  assert.equal(snapshotStale(snap, edited, d), true);
});

test('print and pdf render identical HTML from the same snapshot', () => {
  const { version } = seedTemplate();
  const d = doc({ title: '测试合同', values: { party_a: '甲', party_b: '乙', amount: '1' } });
  const blocks = materialize(version.blocks, d);
  const snap = makeSnapshot({ docId: d.id, version, blocks, doc: d, signatureBlock: '落款' });
  const htmlPrint = renderHTML(snap.payload, { strict: true, declared: version.variables });
  const htmlPdf = renderHTML(snap.payload, { strict: true, declared: version.variables });
  assert.equal(htmlPrint, htmlPdf);
  assert.match(htmlPrint, /本软件仅对用户提供的内容进行排版，不判断条款的法律效力/);
  assert.doesNotMatch(htmlPrint, /未映射变量/);
});

test('template reuse keeps provenance and migrates fields; unmapped remain explicit', () => {
  const src = [{ name: 'party_a', required: true }, { name: 'code', required: true }];
  const target = [{ name: 'party_a' }, { name: 'other' }];
  const p = proposeVarMapping(src, target);
  assert.deepEqual(p.varMap, { party_a: { mode: 'field', field: 'party_a' } });
  assert.equal(p.unmapped[0].name, 'code');
});

test('template upgrade three-way merge: edit/edit conflict previewed and adopted manually', () => {
  const base = templateVersion({ version: '1', blocks: [block({ id: 'x', title: 'T', body: 'BASE BODY' })] });
  const head = templateVersion({ id: 'v2', parentVersionId: base.id, version: '2',
    blocks: [block({ id: 'x', title: 'T', body: 'UPSTREAM BODY' }), block({ id: 'y', title: 'NEW', body: 'NEW BODY' })] });
  const d = { edits: { x: { body: 'LOCAL BODY' } }, moves: [], deletes: [], inserts: [], values: {} };
  const preview = threeWayMerge(base, head, d);
  assert.ok(preview.hasConflicts);
  assert.equal(preview.conflicts[0].type, 'edit-edit');
  assert.ok(preview.changes.added.includes('y'));

  // cannot adopt without deciding
  assert.throws(() => adoptMerge(base, head, d, preview, {}), (e) => e.code === 'UNRESOLVED_CONFLICT');
  const nd = adoptMerge(base, head, d, preview, { 0: 'local' });
  assert.equal(nd.edits.x.body, 'LOCAL BODY');
  const nd2 = adoptMerge(base, head, d, preview, { 0: 'head' });
  assert.equal(nd2.edits.x, undefined);
});

test('full copy vs baseline+diff layer render identically while differing in storage', () => {
  const { version } = seedTemplate();
  const diff = { edits: { scope: { body: '定制后的服务范围' } }, moves: [{ id: 'annex1', parentId: null, afterId: 'signature' }], deletes: [], inserts: [] };
  const r = compareStrategies(version.blocks, diff);
  assert.equal(r.equivalentRender, true);
  assert.ok(r.diffLayerBytes < r.fullCopyBytes);
});
