// Numbering is a DISPLAY attribute: recomputed from tree order every time.
// A clause identity (id) never changes, so [[#id]] references always point
// at the same content even when its displayed number changes after moves or
// insertions.

const CN_NUM = ['零','一','二','三','四','五','六','七','八','九','十'];
export function cnNum(n) {
  if (n <= 10) return n === 10 ? '十' : CN_NUM[n];
  if (n < 20) return '十' + CN_NUM[n - 10];
  const tens = Math.floor(n / 10), ones = n % 10;
  return CN_NUM[tens] + '十' + (ones ? CN_NUM[ones] : '');
}

// blocks: materialized DFS order. Returns Map id ->
// { number, anchor, kind, title, depth, topClauseSeq }
export function computeNumbering(blocks) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const kids = new Map();
  for (const b of blocks) {
    const pid = byId.has(b.parentId) ? b.parentId : null;
    if (!kids.has(pid)) kids.set(pid, []);
    kids.get(pid).push(b);
  }
  const meta = new Map();
  let clauseSeq = 0;
  let annexSeq = 0;
  const letter = (n) => String.fromCharCode(64 + n);

  const walk = (pid, depth, parentNumber = '') => {
    const group = kids.get(pid) || [];
    let childIdx = 0;
    for (const b of group) {
      let number, topSeq = null;
      if (b.kind === 'annex') {
        annexSeq += 1;
        number = `附件${letter(annexSeq)}`;
      } else if (depth === 0) {
        clauseSeq += 1;
        topSeq = clauseSeq;
        number = `第${cnNum(clauseSeq)}条`;
      } else {
        childIdx += 1;
        number = parentNumber ? `${parentNumber}.${childIdx}` : `${childIdx}`;
      }
      meta.set(b.id, { number, kind: b.kind, title: b.title, depth, topSeq });
      walk(b.id, depth + 1, depth === 0 && topSeq != null ? `${topSeq}` : number);
    }
  };
  walk(null, 0);
  return meta;
}

const REF_RE = /\[\[#([\w-]+)(?:\|([^\]]*))?\]\]/g;
export function parseReferences(blocks) {
  const refs = [];
  for (const b of blocks) {
    REF_RE.lastIndex = 0;
    let m;
    while ((m = REF_RE.exec(b.body || ''))) {
      refs.push({ from: b.id, target: m[1], custom: m[2] || null, raw: m[0] });
    }
  }
  return refs;
}

// Resolve references against numbering meta.
export function resolveReferences(blocks, meta = computeNumbering(blocks)) {
  const resolved = [], dangling = [];
  for (const r of parseReferences(blocks)) {
    const t = meta.get(r.target);
    if (!t) dangling.push(r);
    else resolved.push({ ...r, label: r.custom || t.number, targetTitle: t.title });
  }
  return { resolved, dangling };
}

// Detect cross-reference cycles on the directed graph from -> target.
// Returns cycles, each a list of block ids.
export function detectCycles(blocks) {
  const refs = parseReferences(blocks);
  const valid = new Set(blocks.map((b) => b.id));
  const graph = new Map();
  for (const r of refs) {
    if (!valid.has(r.target)) continue;
    if (!graph.has(r.from)) graph.set(r.from, []);
    graph.get(r.from).push(r.target);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...valid].map((id) => [id, WHITE]));
  const stack = [];
  const cycles = [];
  const dfs = (u) => {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of graph.get(u) || []) {
      if (color.get(v) === GRAY) {
        const i = stack.indexOf(v);
        cycles.push(stack.slice(i).concat(v));
      } else if (color.get(v) === WHITE) dfs(v);
    }
    stack.pop();
    color.set(u, BLACK);
  };
  for (const id of valid) if (color.get(id) === WHITE) dfs(id);
  return cycles;
}
