// Export validation. Errors BLOCK formal export; warnings do not.
//  - cross-reference cycles / dangling refs  -> error
//  - unmapped required variables             -> error
//  - unresolved [[#..]] after materialization-> error
//  - missing fonts / long tables             -> warning
import { detectCycles, resolveReferences } from './numbering.js';
import { usedVariables, resolveVar, parseVariables as parseVars } from './variables.js';
import { parseTable } from './tables.js';

export function validateForExport(blocks, {
  variables = [],
  values = {},
  varMap = {},
  declaredDefaults = [],
  availableFonts = [],
  requiredFonts = [],
  longTableRows = 60,
} = {}) {
  const errors = [];
  const warnings = [];

  // 1. cross-reference cycles
  const cycles = detectCycles(blocks);
  for (const c of cycles) errors.push({ code: 'REF_CYCLE', message: `交叉引用成环: ${c.join(' → ')}`, cycle: c });

  // 2. dangling references
  const { dangling } = resolveReferences(blocks);
  for (const d of dangling) errors.push({ code: 'REF_DANGLING', message: `引用目标不存在: ${d.target}（来自 ${d.from}）`, target: d.target, from: d.from });

  // 3. unmapped required variables (an inline {{x|literal}} fallback satisfies)
  const inlineFallback = new Set();
  for (const b of blocks) {
    for (const v of [...parseVars(b.title), ...parseVars(b.body)]) {
      if (v.fallback !== null) inlineFallback.add(v.name);
    }
  }
  const used = new Set(usedVariables(blocks));
  const declared = [...variables];
  for (const name of used) {
    if (!declared.some((v) => v.name === name)) declared.push({ name, required: true, label: name });
  }
  for (const v of declared) {
    const r = resolveVar(v.name, { values, varMap, declared: variables });
    if (v.required !== false && r.missing && !inlineFallback.has(v.name)) {
      errors.push({ code: 'UNMAPPED_VAR', message: `未映射变量，禁止正式导出: ${v.label || v.name}`, variable: v.name });
    }
  }

  // 4. visible unresolved markers in strict substitution are caught above;
  //    also guard empty bodies carrying only whitespace title-less clauses.
  for (const b of blocks) {
    if ((!b.body || !b.body.trim()) && b.kind !== 'annex') {
      warnings.push({ code: 'EMPTY_BODY', message: `条款正文为空: ${b.id}`, blockId: b.id });
    }
  }

  // 5. long attachment tables
  for (const b of blocks) {
    const t = parseTable(b.body);
    if (t && t.rows.length > longTableRows) {
      warnings.push({ code: 'LONG_TABLE', message: `长附件表（${t.rows.length} 行）将分页重复表头: ${b.id}`, blockId: b.id, rows: t.rows.length });
    }
  }

  // 6. missing fonts
  for (const f of requiredFonts) {
    if (!availableFonts.includes(f.family)) {
      warnings.push({ code: 'MISSING_FONT', message: `缺失字体: ${f.family}（${f.why || '正文'}），已回退 ${f.fallback || 'DejaVu'}`, family: f.family });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
