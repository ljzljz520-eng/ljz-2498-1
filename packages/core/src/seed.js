// Demo seed: service contract template with variables, cross references,
// a landscape annex (long table) and a cyclic variant used by acceptance tests.
import { block, template, templateVersion } from './model.js';

export function seedTemplate() {
  const t = template({ name: '服务合同基线模板' });
  const v1 = templateVersion({
    templateId: t.id,
    version: '1.0.0',
    variables: [
      { name: 'party_a', label: '甲方名称', required: true },
      { name: 'party_b', label: '乙方名称', required: true },
      { name: 'amount', label: '合同金额', required: true },
      { name: 'sign_date', label: '签署日期', required: false, default: '以落款日期为准' },
    ],
    blocks: [
      block({ title: '定义', body: '本合同中“服务”指乙方按附件一所列清单向甲方提供的实施服务，详见[[#scope]]。' }),
      block({ id: 'scope', title: '服务范围', body: '乙方应按{{party_b}}确认的范围提供服务。验收标准见[[#acceptance]]。' }),
      block({ id: 'acceptance', title: '验收', body: '甲方应在收到验收申请后10个工作日内完成验收，验收合格后签署验收确认书。' }),
      block({ title: '价款', body: '合同总金额为人民币{{amount}}元。付款安排与验收联动，见[[#acceptance]]。' }),
      block({ title: '违约责任', body: '任一方违约的，应承担继续履行与赔偿责任。' }),
      block({ title: '争议解决', body: '因本合同产生的争议，提交甲方所在地有管辖权的人民法院诉讼解决。' }),
      block({
        id: 'annex1', kind: 'annex', title: '服务清单（横向）',
        page: { orientation: 'landscape', header: '服务合同 · 附件一 服务清单', footer: '第 ' },
        body: tableBody(),
      }),
      block({ title: '其他', body: '本合同一式两份，甲乙双方各执一份，自双方盖章之日起生效。' }),
      block({ id: 'signature', title: '签署', body: '甲方：{{party_a}}\n乙方：{{party_b}}\n日期：{{sign_date}}' }),
    ],
  });
  t.currentVersionId = v1.id;
  return { template: t, version: v1 };
}

function tableBody() {
  const head = '|| 序号 | 服务项 | 规格 | 单价(元) | 备注';
  const rows = [];
  for (let i = 1; i <= 80; i++) rows.push(`| ${i} | 服务项目${i} | 规格${i} | ${1000 + i * 10} | 长期供货`);
  return [head, ...rows].join('\n');
}
