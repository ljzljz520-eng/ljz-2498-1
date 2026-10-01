// Single HTML renderer used by BOTH the on-screen preview and PDF/print
// output. Print and PDF therefore share the exact same review snapshot and
// pagination styles. Header/footer live in named @page margins; landscape
// annex scopes are emitted as explicit page scopes so they cannot leak into
// following portrait text.
import { computeNumbering, resolveReferences } from './numbering.js';
import { substitute } from './variables.js';
import { requiredScopes } from './pages.js';
import { parseTable } from './tables.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderBody(body, ctx, strict) {
  const t = parseTable(body);
  if (t) {
    const head = t.headerRows[0]?.cells || [];
    const bodyRows = t.rows.filter((r) => !r.header);
    const h = head.length ? `<thead><tr>${head.map((c) => `<th>${esc(substitute(c, ctx, { strict }))}</th>`).join('')}</tr></thead>` : '';
    return `<div class="tablewrap"><table class="annex-table">${h}<tbody>${bodyRows
      .map((r) => `<tr>${r.cells.map((c) => `<td>${esc(substitute(c, ctx, { strict }))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const paras = body.split(/\r?\n\r?\n|\r?\n/).filter((x) => x.trim());
  return paras.map((p) => `<p>${esc(substitute(p, ctx, { strict })).replace(/^[-•]\s?/, '')}</p>`).join('');
}

export function renderHTML(payload, {
  strict = false,
  fonts = [],
  declared = [],
} = {}) {
  const blocks = payload.blocks;
  const meta = computeNumbering(blocks);
  const { resolved } = resolveReferences(blocks, meta);
  const refByFrom = new Map();
  for (const r of resolved) {
    if (!refByFrom.has(r.from)) refByFrom.set(r.from, []);
    refByFrom.get(r.from).push(r);
  }
  const { scopes, scopeByBlock } = requiredScopes(blocks);

  const ctx = { values: payload.values || {}, varMap: {}, declared };

  const pageCss = scopes.map((s, i) => `
@page ${s.scopeId} {
  size: A4 ${s.orientation || 'portrait'};
  margin: 26mm 20mm 24mm 20mm;
}
.hf-${s.scopeId} { position: running(hf${i}); }
@page ${s.scopeId} {
  @top-center { content: element(hfHeader${i}); }
  @bottom-center { content: element(hfFooter${i}); }
}`).join('\n');

  const runningEls = scopes.map((s, i) => `
<div class="hf hf-header" style="position:running(hfHeader${i})">${esc(s.header || '')}</div>
<div class="hf hf-footer" style="position:running(hfFooter${i})">${esc(s.footer || '')} <span class="pn"></span></div>`).join('');

  const bodyHtml = blocks.map((b) => {
    const m = meta.get(b.id);
    const s = scopeByBlock.get(b.id);
    const refs = refByFrom.get(b.id) || [];
    let body = b.body || '';
    if (strict) {
      // strict substitution plus strict reference resolution
      body = renderBodyWithRefs(body, refs, ctx, true);
    } else {
      body = renderBodyWithRefs(body, refs, ctx, false);
    }
    const num = m ? `<span class="bnum">${esc(m.number)}</span>` : '';
    const landscapeCls = s?.orientation === 'landscape' ? ' landscape' : '';
    return `<section class="block${b.kind === 'annex' ? ' annex' : ''}${landscapeCls}" data-id="${esc(b.id)}" style="page:${s?.scopeId || 'default'}">
      <h2 class="bhead">${num}<span class="btitle">${esc(substitute(b.title || '', ctx, { strict }))}</span></h2>
      <div class="bbody">${body}</div>
    </section>`;
  }).join('\n');

  const sig = payload.signatureBlock ? `<section class="signature"><h2>落款</h2><pre>${esc(substitute(payload.signatureBlock, ctx, { strict }))}</pre></section>` : '';

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>${esc(payload.title || '合同')}</title>
<style>
${pageCss}
:root { --serif: ${fonts[0] ? fonts.map((f) => `'${f}'`).join(',') + ',' : ''} 'Noto Serif CJK SC','Source Han Serif SC',serif; }
* { box-sizing: border-box; }
body { font-family: var(--serif); font-size: 11.5pt; line-height: 1.7; color:#111; margin:0; }
.doc { padding: 0; }
h1.doctitle { text-align:center; font-size: 20pt; margin: 24pt 0 18pt; }
.block { margin-bottom: 12pt; page-break-inside: auto; }
.block h2 { font-size: 12.5pt; margin: 10pt 0 4pt; }
.bnum { margin-right: 6pt; white-space: nowrap; }
.bbody p { margin: 0 0 6pt; text-indent: 2em; text-align: justify; }
.annex h2 { margin-top: 14pt; }
.landscape .bbody, .landscape h2 { }
.tablewrap { width:100%; overflow: visible; }
table.annex-table { width:100%; border-collapse: collapse; font-size: 9.5pt; }
table.annex-table th, table.annex-table td { border:1px solid #555; padding:3pt 5pt; vertical-align: top; }
table.annex-table thead { display: table-header-group; } /* repeat header each page */
tr { page-break-inside: avoid; }
.hf { font-size: 8.5pt; color:#555; }
.pn::after { content: counter(page); }
.signature { margin-top: 28pt; page-break-inside: avoid; }
.signature pre { font-family: inherit; white-space: pre-wrap; }
.crossref { color:#0b4f9a; }
@media screen { .doc { max-width: 800px; margin: 0 auto; padding: 24px; background:#fff; } body { background:#e9edf2;} }
</style></head>
<body>${runningEls}
<main class="doc">
<h1 class="doctitle">${esc(substitute(payload.title || '合同', ctx, { strict }))}</h1>
${bodyHtml}
${sig}
<p class="disclaimer">本软件仅对用户提供的内容进行排版，不判断条款的法律效力。</p>
</main></body></html>`;
}

function renderBodyWithRefs(body, refs, ctx, strict) {
  let html = renderBody(body, ctx, strict);
  for (const r of refs) {
    const safeLabel = esc(substitute(r.custom || r.label, ctx, { strict }));
    html = html.split(esc(r.raw)).join(`<a class="crossref" href="#${esc(r.target)}" data-target="${esc(r.target)}">${safeLabel}</a>`);
  }
  return html;
}
