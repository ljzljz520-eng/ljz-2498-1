import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptUpgrade, applyTreeOp, applyTreeOps, buildSnapshot, clauseNumber, compareReusePlans,
  findReferenceCycles, makeTemplateVersion, resolveReferences, resolveTemplateVersion,
  renderSnapshot, threeWayMerge, validateDocument
} from '../shared/src/index.js';

const n = (id, title, body = '', children = []) => ({ id, kind: 'clause', title, body, children });

test('编号由树位置生成，插入和移动后引用仍指向稳定条款', () => {
  let nodes = [n('a', '甲方', '见 [[ref:b|乙方]]'), n('b', '乙方'), n('c', '丙方')];
  assert.equal(clauseNumber('clause', [1]), '二');
  nodes = applyTreeOps(nodes, { type: 'insert', parentId: null, index: 0, node: { kind: 'clause', title: '新首部', body: '' } });
  nodes = applyTreeOps(nodes, { type: 'move', id: 'b', newParentId: null, index: 2 });
  const resolved = resolveReferences(nodes);
  assert.equal(resolved.issues.length, 0);
  const snapshot = buildSnapshot({ document: { id: 'd', title: '合同' }, nodes, variables: {}, signoff: {} });
  const html = renderSnapshot(snapshot).html;
  assert.match(html, /href="#clause-b"[^>]*>三、乙方/);
});

test('模板继承解析父基线与子差异层', () => {
  const root = makeTemplateVersion({ templateId: 't', version: '1', baseNodes: [n('x', '旧标题'), n('y', '保留')] });
  const child = makeTemplateVersion({ templateId: 't', version: '2', parentVersionId: root.id, operations: [{ type: 'update', id: 'x', patch: { title: '新标题' } }] });
  const resolved = resolveTemplateVersion(child, [child, root]);
  assert.equal(resolved.nodes[0].title, '新标题');
  assert.equal(resolved.nodes[1].title, '保留');
});

test('拆分条款保留原稳定身份，旧引用仍指向原条款', () => {
  const nodes = [n('a', '验收', '前半部分。后半部分。'), n('b', '引用', '见 [[ref:a]]')];
  const split = applyTreeOp(nodes, { type: 'split', id: 'a', beforeBody: '前半部分。', afterBody: '后半部分。', title: '验收（续）' });
  assert.equal(split.node.id, 'a');
  assert.notEqual(split.newNode.id, 'a');
  assert.equal(split.newNode.splitFromId, 'a');
  assert.equal(resolveReferences(split.nodes).issues.length, 0);
  const html = renderSnapshot(buildSnapshot({ document: { id: 'd', title: '合同' }, nodes: split.nodes, variables: {}, signoff: {} })).html;
  assert.match(html, /href="#clause-a"[^>]*>一、验收</);
});

test('交叉引用成环和断链会形成验证错误', () => {
  const nodes = [n('a', '甲', '[[ref:b]]'), n('b', '乙', '[[ref:a]]'), n('c', '丙', '[[ref:missing]]')];
  const { issues } = resolveReferences(nodes);
  assert.ok(issues.some(i => i.code === 'REFERENCE_CYCLE'));
  assert.ok(issues.some(i => i.code === 'BROKEN_REFERENCE'));
  assert.equal(findReferenceCycles(nodes).length, 1);
});

test('横向附件节作用域不会污染后续纵向正文', () => {
  const nodes = [
    { id: 'body1', kind: 'clause', title: '正文一', body: '', children: [] },
    { id: 'att', kind: 'attachment', title: '横向表', body: '', scope: { page: { orientation: 'landscape' } }, children: [] },
    { id: 'body2', kind: 'clause', title: '正文二', body: '', children: [] }
  ];
  const sections = renderSnapshot(buildSnapshot({ document: { id: 'd', title: '合同' }, nodes, variables: {}, signoff: {} })).bodyHtml;
  assert.match(sections, /data-orientation="portrait"[\s\S]*data-orientation="landscape"[\s\S]*data-orientation="portrait"/);
});

test('长附件表生成重复表头和可断行长表', () => {
  const table = '|序号|内容|\n|---|---|\n' + Array.from({ length: 80 }, (_, i) => `|${i + 1}|很长的验收证据材料 ${i}|`).join('\n');
  const nodes = [n('a', '长附件', table)];
  const html = renderSnapshot(buildSnapshot({ document: { id: 'd', title: '合同' }, nodes, variables: {}, signoff: {} })).html;
  assert.equal((html.match(/<thead>/g) || []).length, 1);
  assert.match(html, /thead\s*\{\s*display:\s*table-header-group/);
  assert.equal((html.match(/<tbody>[\s\S]*?<\/tbody>/s)[0].match(/<tr>/g) || []).length, 80);
});

test('缺失必需字体阻止正式导出验证', () => {
  const result = validateDocument({
    nodes: [n('a', '甲', '正文')],
    variables: {},
    variableDefinitions: [],
    fontPolicy: { requiredFonts: ['Noto Sans CJK SC'] },
    availableFonts: ['Arial']
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'MISSING_FONT');
});

test('未映射必填变量阻止正式导出', () => {
  const result = validateDocument({
    nodes: [n('a', '甲', '甲方为{{party_name}}')],
    variables: {},
    variableDefinitions: [{ name: 'party_name', required: true }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'UNMAPPED_VARIABLE');
});

test('模板升级识别字段冲突，人工采纳前不能升级', () => {
  const base = [n('a', '条款', '基线正文')];
  const oldParent = [n('a', '条款', '基线正文')];
  const newParent = [n('a', '条款', '上游正文')];
  const local = [n('a', '条款', '本地正文')];
  const preview = threeWayMerge({ baseNodes: base, parentOldNodes: oldParent, parentNewNodes: newParent, localNodes: local });
  assert.equal(preview.requiresManualChoice, true);
  assert.throws(() => adoptUpgrade({ preview, choices: {}, parentNewNodes: newParent }), /未人工采纳/);
  const adopted = adoptUpgrade({ preview, choices: { a: { source: 'local' } }, parentNewNodes: newParent });
  assert.equal(adopted.nodes[0].body, '本地正文');
  const upstream = adoptUpgrade({ preview, choices: { a: { source: 'upstream' } }, parentNewNodes: newParent });
  assert.equal(upstream.nodes[0].body, '上游正文');
});

test('整文档复制与基线差异层均保留来源，未映射变量阻止正式导出', () => {
  const plan = compareReusePlans({
    sourceNodes: [n('a', '甲', '甲方 {{old_var}}')],
    sourceTemplateId: 'tpl',
    sourceVersionId: 'ver1',
    targetVariables: [{ name: 'new_var' }],
    mappings: {}
  });
  assert.equal(plan.fullCopy.provenancePreserved, true);
  assert.deepEqual(plan.variables.unmapped, ['old_var']);
  assert.equal(plan.variables.blocksFormalExport, true);
  const mapped = compareReusePlans({
    sourceNodes: [n('a', '甲', '甲方 {{old_var}}')],
    sourceTemplateId: 'tpl', sourceVersionId: 'ver1',
    targetVariables: [{ name: 'new_var' }], mappings: { old_var: 'new_var' }
  });
  assert.deepEqual(mapped.variables.unmapped, []);
});
