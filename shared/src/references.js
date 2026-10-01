import { buildIndex } from './tree.js';
import { referenceLabel, clauseNumber } from './numbering.js';

export const REFERENCE_PATTERN = /\[\[ref:([A-Za-z0-9_-]+)(?:\|([^\]]+))?\]\]/g;
export const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_$][\w$.]*)\s*(?:\|\|\s*"((?:\\.|[^"\\])*)")?\s*\}\}/g;

export function parseReferences(text = '') {
  return [...String(text).matchAll(REFERENCE_PATTERN)].map(match => ({
    clauseId: match[1],
    fallback: match[2] ?? null,
    index: match.index,
    raw: match[0]
  }));
}

export function parseVariables(text = '') {
  return [...String(text).matchAll(VARIABLE_PATTERN)].map(match => ({
    name: match[1],
    fallback: match[2] !== undefined ? JSON.parse(`"${match[2]}"`) : undefined,
    index: match.index,
    raw: match[0],
    hasFallback: match[2] !== undefined
  }));
}

export function collectReferences(nodes) {
  const refs = [];
  const visit = (node, path) => {
    for (const ref of parseReferences(`${node.title}\n${node.body}`)) {
      refs.push({ fromId: node.id, path, ...ref });
    }
    (node.children ?? []).forEach((child, index) => visit(child, [...path, index]));
  };
  nodes.forEach((node, index) => visit(node, [index]));
  return refs;
}

export function collectVariables(nodes) {
  const map = new Map();
  const visit = node => {
    for (const variable of parseVariables(`${node.title}\n${node.body}`)) {
      if (!map.has(variable.name)) map.set(variable.name, { ...variable, usages: [] });
      map.get(variable.name).usages.push({ nodeId: node.id });
    }
    (node.children ?? []).forEach(visit);
  };
  nodes.forEach(visit);
  return [...map.values()];
}

export function findReferenceCycles(nodes) {
  const { byId } = buildIndex(nodes);
  const cycles = [];
  const state = new Map();

  function edgesFor(node) {
    return collectReferences([node]).map(ref => ref.clauseId).filter(id => byId.has(id));
  }

  function visit(id, stack = []) {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'active') {
      const start = stack.indexOf(id);
      const cycle = start >= 0 ? [...stack.slice(start), id] : [...stack, id];
      const key = [...cycle].sort().join('>');
      if (!cycles.some(c => [...c].sort().join('>') === key)) cycles.push(cycle);
      return;
    }
    state.set(id, 'active');
    for (const next of edgesFor(byId.get(id))) visit(next, [...stack, id]);
    state.set(id, 'done');
  }

  for (const id of byId.keys()) visit(id);
  return cycles;
}

export function resolveReferences(nodes, { failOnBroken = false } = {}) {
  const { byId, paths } = buildIndex(nodes);
  const issues = [];
  const replacements = new Map();

  for (const ref of collectReferences(nodes)) {
    const target = byId.get(ref.clauseId);
    if (!target) {
      issues.push({ level: 'error', code: 'BROKEN_REFERENCE', fromId: ref.fromId, targetId: ref.clauseId, message: `引用的稳定条款不存在: ${ref.clauseId}` });
      replacements.set(ref.raw, ref.fallback ? `[${ref.fallback}]` : `[缺失引用:${ref.clauseId}]`);
      continue;
    }
    replacements.set(ref.raw, referenceLabel(target, paths.get(ref.clauseId).path));
  }

  for (const cycle of findReferenceCycles(nodes)) {
    issues.push({
      level: 'error',
      code: 'REFERENCE_CYCLE',
      clauseIds: cycle,
      labels: cycle.map(id => byId.get(id) ? referenceLabel(byId.get(id), paths.get(id).path) : id),
      message: `交叉引用成环: ${cycle.map(id => clauseNumber(byId.get(id)?.kind ?? 'clause', paths.get(id)?.path ?? [])).join(' → ')} →`
    });
  }

  if (failOnBroken && issues.some(i => i.code === 'BROKEN_REFERENCE')) {
    throw Object.assign(new Error('存在断链交叉引用'), { code: 'VALIDATION_ERROR', details: issues });
  }
  return { issues, replacements };
}

export function renderInlineText(text, replacements, variables, context = {}) {
  let output = String(text ?? '');
  output = output.replace(REFERENCE_PATTERN, raw => replacements.get(raw) ?? raw);
  output = output.replace(VARIABLE_PATTERN, (raw, name, _fallbackQuoted) => {
    const parsed = parseVariables(raw)[0];
    const value = variables?.[name] ?? context.variables?.[name] ?? parsed.fallback;
    return value === undefined || value === null || value === '' ? raw : String(value);
  });
  return output;
}

export function unresolvedVariableNames(nodes, values = {}, declared = []) {
  const declaredMap = new Map(declared.map(v => [v.name, v]));
  const missing = [];
  for (const variable of collectVariables(nodes)) {
    const hasValue = values[variable.name] !== undefined && values[variable.name] !== null && values[variable.name] !== '';
    if (hasValue) continue;
    const declaration = declaredMap.get(variable.name);
    const required = declaration?.required !== false;
    if (required || !variable.hasFallback) missing.push({ name: variable.name, required, usages: variable.usages });
  }
  return missing;
}
