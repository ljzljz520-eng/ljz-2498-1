import { buildIndex } from './tree.js';
import { clauseNumber, referenceLabel } from './numbering.js';
import { parseReferences, parseVariables, resolveReferences, unresolvedVariableNames } from './references.js';
import { escapeHtml, cssString, stableStringify } from './utils.js';

const DEFAULT_SCOPE = {
  page: { size: 'A4', orientation: 'portrait', margin: { top: '24mm', right: '20mm', bottom: '22mm', left: '20mm' } },
  header: { text: '' },
  footer: { text: '{{document.title}}  第 {{page.number}} 页' },
  font: { family: '"Noto Sans CJK SC", "Source Han Sans SC", "SimSun", sans-serif' }
};

export function mergeScope(documentScope = {}, nodeScope) {
  return mergeDeep(mergeDeep({}, DEFAULT_SCOPE), mergeDeep({}, documentScope), nodeScope ? structuredClone(nodeScope) : {});
}

function mergeDeep(target, ...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) target[key] = mergeDeep(target[key] ?? {}, value);
      else target[key] = value;
    }
  }
  return target;
}

export function normalizeScopes(nodes, documentScope = {}) {
  // Scope is intentionally reset at each top-level section. A landscape attachment therefore
  // cannot leak into the next top-level body section, which falls back to document defaults.
  return nodes.map((section, sectionIndex) => {
    const explicit = section.scope ?? {};
    const scope = mergeScope(documentScope, explicit);
    const pageId = `scope_${sectionIndex}_${hashString(stableStringify(scope)).slice(0, 8)}`;
    return { section, scope, pageId };
  });
}

function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function validateDocument({ nodes, variables = {}, variableDefinitions = [], fontPolicy = {}, availableFonts = null }) {
  const { issues } = resolveReferences(nodes);
  for (const item of unresolvedVariableNames(nodes, variables, variableDefinitions)) {
    issues.push({ level: 'error', code: 'UNMAPPED_VARIABLE', name: item.name, required: item.required, usages: item.usages, message: `变量未映射或缺少值: ${item.name}` });
  }
  const requiredFonts = fontPolicy.requiredFonts ?? [];
  if (requiredFonts.length) {
    if (!availableFonts || !availableFonts.length) {
      issues.push({ level: 'error', code: 'FONT_DETECTION_UNAVAILABLE', fonts: requiredFonts, message: '无法验证正式导出字体，请安装字体或提供可用字体清单' });
    } else {
      const available = new Set(availableFonts);
      const missing = requiredFonts.filter(font => !available.has(font));
      if (missing.length) issues.push({ level: 'error', code: 'MISSING_FONT', fonts: missing, message: `缺失字体: ${missing.join(', ')}` });
    }
  }
  return {
    ok: !issues.some(issue => issue.level === 'error'),
    issues,
    errors: issues.filter(issue => issue.level === 'error'),
    warnings: issues.filter(issue => issue.level === 'warning')
  };
}

export function buildSnapshot({ document, nodes, variables, variableDefinitions = [], fontPolicy = {}, availableFonts = null, signoff = {}, reason = 'manual' }) {
  const validation = validateDocument({ nodes, variables, variableDefinitions, fontPolicy, availableFonts });
  const index = buildIndex(nodes);
  const numbering = {};
  for (const [id, info] of index.paths) {
    numbering[id] = {
      number: clauseNumber(index.byId.get(id).kind, info.path),
      path: info.path,
      parentId: info.parentId,
      title: index.byId.get(id).title
    };
  }
  return {
    id: undefined,
    documentId: document.id,
    documentVersion: document.version ?? 1,
    reason,
    createdAt: new Date().toISOString(),
    title: document.title,
    signoff: structuredClone(signoff ?? document.signoff ?? {}),
    variables: structuredClone(variables ?? {}),
    variableDefinitions: structuredClone(variableDefinitions),
    fontPolicy: structuredClone(fontPolicy),
    documentScope: structuredClone(document.scope ?? {}),
    nodes: structuredClone(nodes),
    numbering,
    references: resolveReferences(nodes).issues,
    validation
  };
}

export function renderSnapshot(snapshot, options = {}) {
  const sections = normalizeScopes(snapshot.nodes, snapshot.documentScope);
  const { byId, paths } = buildIndex(snapshot.nodes);
  const referenceReplacements = new Map();
  for (const [id, target] of byId) referenceReplacements.set(id, target);
  const context = { document: { title: snapshot.title, ...snapshot.documentScope?.document }, page: { number: 'counter(page)' }, snapshot, signoff: snapshot.signoff };

  const css = renderCss(sections, context, options);
  const body = sections.map(({ section, scope, pageId }) => renderSection(section, [], scope, pageId, byId, paths, context)).join('\n');
  const signoff = renderSignoff(snapshot.signoff);
  const legalNote = '<div class="legal-note">本软件仅负责用户内容的排版与一致性管理，不判断任何条款的法律效力。</div>';
  return {
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>${css}</style></head><body><main class="document">\n${body}\n${signoff}${legalNote}\n</main></body></html>`,
    css,
    bodyHtml: `${body}${signoff}${legalNote}`
  };
}

function renderCss(sections, context = {}) {
  const pageRules = sections.map(({ scope, pageId }) => {
    const size = `${scope.page?.size ?? 'A4'} ${scope.page?.orientation ?? 'portrait'}`;
    const margin = marginCss(scope.page?.margin);
    return `@page ${pageId} { size: ${size};${margin} }`;
  }).join('\n');
  const uniqueScopes = new Map(sections.map(s => [s.pageId, s.scope]));
  const runningRules = [...uniqueScopes.entries()].map(([pageId, scope]) => {
    const headerVar = `--${pageId}-header`;
    const footerVar = `--${pageId}-footer`;
    return `
.page-section[data-page="${pageId}"] { page: ${pageId}; ${headerVar}: ${cssString(scope.header?.text ?? '')}; ${footerVar}: ${cssString(scope.footer?.text ?? '')}; font-family: ${scope.font?.family ?? 'sans-serif'}; }
@page ${pageId} { @top-center { content: ${cssContentValue(scope.header?.text ?? '', context)}; } @bottom-center { content: ${cssContentValue(scope.footer?.text ?? '', context)}; } }`;
  }).join('\n');
  return `
${pageRules}
* { box-sizing: border-box; }
body { margin: 0; color: #1f2933; font: 12pt/1.7 "Noto Sans CJK SC", "Source Han Sans SC", "SimSun", sans-serif; }
.document { background: white; }
.page-section { break-before: page; padding: 8mm 0; min-height: 250mm; }
.page-section:first-child { break-before: avoid; }
.screen-header, .screen-footer { border-bottom: 1px solid #d9dee5; color: #647080; font-size: 9pt; padding: 2mm 0 4mm; margin-bottom: 5mm; }
.screen-footer { border-top: 1px solid #d9dee5; border-bottom: 0; margin-top: 5mm; padding: 4mm 0 2mm; }
.clause { margin: 0 0 3.5mm; }
.clause-title { font-weight: 700; margin: 2mm 0; }
.clause-body p { margin: 0 0 2mm; }
.children { margin-left: 7mm; }
.ref-link { color: #175cd3; text-decoration: none; font-weight: 600; }
.ref-error { color: #b42318; background: #fee4e2; padding: 0 2px; }
.table-wrap { width: 100%; overflow-x: visible; }
.contract-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 3mm 0; font-size: 9pt; }
.contract-table th, .contract-table td { border: 1px solid #667085; padding: 2mm; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }
.contract-table thead { display: table-header-group; }
.contract-table tfoot { display: table-footer-group; }
tr { break-inside: avoid; }
.signoff { margin-top: 10mm; white-space: pre-line; }
.legal-note { margin-top: 8mm; color: #667085; font-size: 8pt; border-top: 1px solid #e4e7ec; padding-top: 2mm; }
@media print {
  body { font-size: 10.5pt; }
  .page-section { break-before: page; padding: 0; min-height: 0; }
  .screen-header, .screen-footer { display: none; }
  .no-print { display: none !important; }
}
${runningRules}
`;
}

function marginCss(margin = {}) {
  return `margin: ${margin.top ?? '22mm'} ${margin.right ?? '18mm'} ${margin.bottom ?? '20mm'} ${margin.left ?? '18mm'};`;
}

function cssContentValue(template, context = {}) {
  // @page content accepts CSS strings plus counters. Keep them as separate tokens instead of
  // stringifying counter(page), so each section footer can number pages in print/PDF output.
  const parts = [];
  let buffer = '';
  const flush = () => {
    if (buffer) {
      parts.push(cssString(resolveTextSegment(buffer, { ...context, page: { number: '' } }).trim()));
      buffer = '';
    }
  };
  const regex = /\{\{\s*([A-Za-z_$][\w$.]*)\s*(?:\|\|\s*"((?:\\.|[^"\\])*)")?\s*\}\}/g;
  let match;
  let last = 0;
  while ((match = regex.exec(template)) !== null) {
    buffer += template.slice(last, match.index);
    last = match.index + match[0].length;
    const name = match[1];
    if (name === 'page.number') {
      flush();
      parts.push('counter(page)');
    } else {
      const parsed = parseVariables(match[0])[0];
      buffer += String(lookupVariable(name, context) ?? parsed.fallback ?? '');
    }
  }
  buffer += template.slice(last);
  flush();
  return parts.join(' ');
}

function renderSection(section, path, scope, pageId, byId, paths, context) {
  const inner = renderNode(section, path, byId, paths, context);
  return `<section class="page-section ${scope.page?.orientation === 'landscape' ? 'is-landscape' : 'is-portrait'}" data-page="${pageId}" data-orientation="${scope.page?.orientation ?? 'portrait'}">
${scope.header?.text ? `<div class="screen-header">${renderInlineHtml(scope.header.text, context, byId, paths)}</div>` : ''}
${inner}
${scope.footer?.text ? `<div class="screen-footer">${renderInlineHtml(scope.footer.text, context, byId, paths)}</div>` : ''}
</section>`;
}

function renderNode(node, path, byId, paths, context) {
  const number = clauseNumber(node.kind, path);
  const children = (node.children ?? []).map((child, index) => renderNode(child, [...path, index], byId, paths, context)).join('');
  const kindClass = node.kind === 'attachment' ? 'attachment' : 'clause';
  const title = node.title ? `<div class="clause-title"><span class="clause-number">${escapeHtml(number)}</span> ${node.kind === 'attachment' ? '《' + escapeHtml(node.title) + '》' : escapeHtml(node.title)}</div>` : `<div class="clause-title"><span class="clause-number">${escapeHtml(number)}</span></div>`;
  return `<article id="clause-${escapeHtml(node.id)}" class="clause ${kindClass}" data-stable-id="${escapeHtml(node.id)}" data-number="${escapeHtml(number)}">
${title}
<div class="clause-body">${renderBodyHtml(node.body, context, byId, paths)}</div>
${children ? `<div class="children">${children}</div>` : ''}
</article>`;
}

export function renderBodyHtml(body, context, byId, paths) {
  const trimmed = String(body ?? '').trim();
  if (!trimmed) return '';
  return trimmed.split(/\n{2,}/).map(block => {
    if (looksLikeTable(block)) return renderTable(block, context, byId, paths);
    const lines = block.split(/\n/).map(line => renderInlineHtml(line, context, byId, paths)).join('<br>\n');
    return `<p>${lines}</p>`;
  }).join('\n');
}

function looksLikeTable(text) {
  const lines = text.split(/\n/).filter(Boolean);
  return lines.length >= 2 && lines.every(line => /\|\s*.*\|/.test(line)) && /^[\s|:\-]+$/.test(lines[1] ?? '');
}

function splitTableLine(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function renderTable(text, context, byId, paths) {
  const lines = text.split(/\n/).filter(Boolean);
  const headers = splitTableLine(lines[0]);
  const rows = lines.slice(2).map(splitTableLine);
  const head = `<thead><tr>${headers.map(h => `<th>${renderInlineHtml(h, context, byId, paths)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${rows.map(cells => `<tr>${headers.map((_, i) => `<td>${renderInlineHtml(cells[i] ?? '', context, byId, paths)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<div class="table-wrap"><table class="contract-table">${head}${body}</table></div>`;
}

function renderInlineHtml(text, context = {}, byId = new Map(), paths = new Map()) {
  let output = '';
  let last = 0;
  const refRegex = /\[\[ref:([A-Za-z0-9_-]+)(?:\|([^\]]+))?\]\]/g;
  let match;
  while ((match = refRegex.exec(String(text))) !== null) {
    output += escapeHtml(resolveTextSegment(text.slice(last, match.index), context));
    const target = byId.get(match[1]);
    if (target) {
      const label = referenceLabel(target, paths.get(match[1]).path);
      output += `<a class="ref-link" href="#clause-${escapeHtml(match[1])}" data-ref="${escapeHtml(match[1])}">${escapeHtml(label)}</a>`;
    } else {
      output += `<span class="ref-error" title="断链">${escapeHtml(match[2] ? `[${match[2]}]` : `[缺失引用:${match[1]}]`)}</span>`;
    }
    last = match.index + match[0].length;
  }
  output += escapeHtml(resolveTextSegment(text.slice(last), context));
  output = output.replace(/\n/g, '<br>');
  return output;
}

function resolveTextSegment(segment, context) {
  return segment.replace(/\{\{\s*([A-Za-z_$][\w$.]*)\s*(?:\|\|\s*"((?:\\.|[^"\\])*)")?\s*\}\}/g, (raw, name, fallbackQuoted) => {
    const parsed = parseVariables(raw)[0];
    const value = lookupVariable(name, context) ?? parsed?.fallback;
    return value === undefined || value === null ? raw : String(value);
  });
}

function lookupVariable(name, context) {
  if (name === 'page.number') return context.page?.number;
  if (name === 'document.title') return context.document?.title;
  if (name.startsWith('signoff.')) return context.signoff?.[name.slice('signoff.'.length)];
  return context.variables?.[name] ?? context.snapshot?.variables?.[name];
}

export function renderSignoff(signoff = {}) {
  const lines = [signoff.partyA && `甲方（盖章）：${signoff.partyA}`, signoff.partyB && `乙方（盖章）：${signoff.partyB}`, signoff.date && `签署日期：${signoff.date}`].filter(Boolean);
  return lines.length ? `<div class="signoff">${lines.map(escapeHtml).join('<br>')}</div>` : '';
}
