import { newClauseId } from '../../shared/src/index.js';

const parties = {
  id: newClauseId(), kind: 'clause', title: '合同主体',
  body: '甲方：{{party_a||"待填写甲方"}}\n乙方：{{party_b||"待填写乙方"}}', children: []
};
const acceptance = {
  id: newClauseId(), kind: 'clause', title: '验收',
  body: '验收分为初验、试运行和终验。详见[[ref:ATT_ACCEPTANCE|验收附件]]。',
  children: [
    { id: newClauseId(), kind: 'clause', title: '初验', body: '交付后五个工作日内完成初验。', children: [] },
    { id: newClauseId(), kind: 'clause', title: '终验', body: '试运行满三十日且问题关闭后完成终验。', children: [] }
  ]
};
const payment = { id: newClauseId(), kind: 'clause', title: '付款', body: '合同价款为{{amount}}元，按里程碑支付。', children: [] };
const attachment = {
  id: 'ATT_ACCEPTANCE',
  kind: 'attachment',
  title: '验收明细与长表',
  body: '本附件使用横向页面，仅在本节作用域内生效。\n\n|序号|验收项|证据材料|负责人|判定标准|备注|\n|---|---|---|---|---|---|\n' +
    Array.from({ length: 35 }, (_, i) => `|${i + 1}|验收项 ${i + 1}|截图、日志、签收单 ${i + 1}|项目经理|满足需求并通过复测|长附件第 ${i + 1} 行，用于验证表头重复|`).join('\n'),
  scope: {
    page: { size: 'A4', orientation: 'landscape', margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' } },
    header: { text: '横向附件：{{document.title}}——验收附件' },
    footer: { text: '附件页 第 {{page.number}} 页' }
  },
  children: []
};
const after = { id: newClauseId(), kind: 'clause', title: '横向附件后的纵向正文', body: '本节必须恢复 A4 纵向以及文档默认页眉页脚。', children: [] };

export async function seedDemoData(templates, documents) {
  const existing = await templates.listTemplates();
  if (existing.length) return;
  const created = await templates.createTemplate({
    name: '标准服务合同模板',
    description: '演示模板：包含验收拆分、交叉引用、横向长附件和变量。',
    version: '1.0.0',
    baseNodes: [parties, acceptance, payment, attachment, after],
    variables: [
      { name: 'party_a', label: '甲方', required: true },
      { name: 'party_b', label: '乙方', required: true },
      { name: 'amount', label: '合同金额', required: true }
    ],
    styles: {},
    note: 'initial demo'
  });
  const doc = await documents.createDocument({
    title: '2026 年度软件服务合同',
    templateVersionId: created.version.id,
    variableValues: { party_a: '杭州星河科技有限公司', party_b: '上海云帆制造有限公司', amount: '1,200,000' },
    scope: {
      page: { size: 'A4', orientation: 'portrait' },
      header: { text: '{{document.title}}' },
      footer: { text: '正文 第 {{page.number}} 页' }
    },
    signoff: { partyA: '杭州星河科技有限公司', partyB: '上海云帆制造有限公司', date: '2026-10-01' }
  });
  return { template: created, document: doc };
}
