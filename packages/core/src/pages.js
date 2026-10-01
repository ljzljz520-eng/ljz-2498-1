// Section-scoped page settings (header/footer/orientation).
// A block with explicit `page` opens a scope that CASCADES TO ITS DESCENDANT
// SUBTREE only. When the DFS walk leaves that subtree the previous scope
// resumes; a landscape annex therefore cannot leak onto later portrait text —
// the resume is emitted as an explicit new portrait @page boundary.

const DEFAULT_SCOPE = 'default';
const defaultScope = () => ({ orientation: 'portrait', header: null, footer: null, scopeId: DEFAULT_SCOPE });

export function pageScopes(blocks) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const scopeOf = new Map();
  const list = [];
  let seq = 0;
  let prevScope = defaultScope();
  for (const b of blocks) {
    const parent = b.parentId && byId.has(b.parentId) ? scopeOf.get(b.parentId) : defaultScope();
    let scope, opens = false, resume = false;
    if (b.page) {
      seq += 1;
      scope = {
        ...defaultScope(), ...parent, ...b.page,
        header: b.page.header ?? parent.header,
        footer: b.page.footer ?? parent.footer,
        scopeId: `s${seq}`,
      };
      opens = true;
    } else if (
      parent.scopeId === DEFAULT_SCOPE &&
      prevScope.orientation !== 'portrait'
    ) {
      // DFS left a non-portrait opener subtree (e.g. landscape annex) ->
      // resume portrait explicitly so the annex cannot leak forward.
      seq += 1;
      scope = { ...defaultScope(), scopeId: `r${seq}` };
      opens = true; resume = true;
    } else {
      scope = { ...parent };
    }
    scopeOf.set(b.id, scope);
    prevScope = scope;
    list.push({ id: b.id, opens, resume, scope });
  }
  return list;
}

// Boundary scopes for the renderer + a block -> scope map.
export function requiredScopes(blocks) {
  const walk = pageScopes(blocks);
  const scopes = [{ ...defaultScope(), blockId: walk[0]?.id, opens: false, resume: false }];
  const scopeByBlock = new Map();
  let prevId = DEFAULT_SCOPE;
  for (const item of walk) {
    if (item.opens && item.scope.scopeId !== prevId) {
      scopes.push({ ...item.scope, blockId: item.id, opens: true, resume: item.resume });
      prevId = item.scope.scopeId;
    }
    scopeByBlock.set(item.id, item.scope);
  }
  return { scopes, scopeByBlock };
}
