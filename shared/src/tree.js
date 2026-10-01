import { newClauseId } from './ids.js';
import { assert } from './utils.js';

export function walk(nodes, onNode, parentId = null, path = []) {
  for (let index = 0; index < nodes.length; index++) {
    const currentPath = [...path, index];
    onNode(nodes[index], parentId, currentPath);
    if (nodes[index].children?.length) walk(nodes[index].children, onNode, nodes[index].id, currentPath);
  }
}

export function buildIndex(nodes) {
  const byId = new Map();
  const paths = new Map();
  walk(nodes, (node, parentId, path) => {
    byId.set(node.id, node);
    paths.set(node.id, { parentId, path });
  });
  return { byId, paths };
}

export function findNode(nodes, id) {
  return buildIndex(nodes).byId.get(id) ?? null;
}

function cloneTree(nodes) {
  return nodes.map(node => ({ ...node, children: node.children ? cloneTree(node.children) : [] }));
}

function removeById(nodes, id) {
  const index = nodes.findIndex(n => n.id === id);
  if (index >= 0) {
    const [removed] = nodes.splice(index, 1);
    return removed;
  }
  for (const node of nodes) {
    if (node.children?.length) {
      const removed = removeById(node.children, id);
      if (removed) return removed;
    }
  }
  return null;
}

function locateParent(nodes, parentId) {
  if (!parentId) return { nodes, node: null };
  const node = findNode(nodes, parentId);
  assert(node, `父条款不存在: ${parentId}`, 'NOT_FOUND');
  return { nodes: (node.children ??= []), node };
}

function assertNoDescendantMove(rootNodes, id, newParentId) {
  if (!newParentId) return;
  const node = findNode(rootNodes, id);
  let current = findNode(rootNodes, newParentId);
  while (current) {
    assert(current.id !== id, '不能将条款移动到自身或其子级内', 'INVALID_MOVE');
    const { paths } = buildIndex(rootNodes);
    const info = paths.get(current.id);
    current = info?.parentId ? findNode(rootNodes, info.parentId) : null;
  }
  assert(node, `条款不存在: ${id}`, 'NOT_FOUND');
}

export function applyTreeOp(inputNodes, op) {
  const nodes = cloneTree(inputNodes);
  const type = op?.type;

  if (type === 'insert') {
    const { nodes: siblings } = locateParent(nodes, op.parentId ?? null);
    const index = Math.max(0, Math.min(op.index ?? siblings.length, siblings.length));
    const node = {
      id: op.node?.id || newClauseId(),
      kind: op.node?.kind || 'clause',
      title: op.node?.title ?? '',
      body: op.node?.body ?? '',
      scope: op.node?.scope ? { ...op.node.scope } : undefined,
      children: op.node?.children ? cloneTree(op.node.children) : [],
      sourceId: op.node?.sourceId,
      sourceVersionId: op.node?.sourceVersionId,
      metadata: op.node?.metadata ? structuredClone(op.node.metadata) : undefined
    };
    siblings.splice(index, 0, node);
    return { nodes, node };
  }

  if (type === 'update') {
    const node = findNode(nodes, op.id);
    assert(node, `条款不存在: ${op.id}`, 'NOT_FOUND');
    const patch = op.patch ?? {};
    for (const key of ['title', 'body', 'kind']) if (key in patch) node[key] = patch[key];
    if (patch.scope !== undefined) node.scope = patch.scope ? structuredClone(patch.scope) : undefined;
    if (patch.metadata) node.metadata = { ...(node.metadata ?? {}), ...structuredClone(patch.metadata) };
    return { nodes, node };
  }

  if (type === 'move') {
    assertNoDescendantMove(nodes, op.id, op.newParentId ?? null);
    const moving = removeById(nodes, op.id);
    assert(moving, `条款不存在: ${op.id}`, 'NOT_FOUND');
    const { nodes: siblings } = locateParent(nodes, op.newParentId ?? null);
    const index = Math.max(0, Math.min(op.index ?? siblings.length, siblings.length));
    siblings.splice(index, 0, moving);
    return { nodes, node: moving };
  }

  if (type === 'delete') {
    const removed = removeById(nodes, op.id);
    assert(removed, `条款不存在: ${op.id}`, 'NOT_FOUND');
    return { nodes, removed };
  }

  if (type === 'split') {
    const node = findNode(nodes, op.id);
    assert(node, `条款不存在: ${op.id}`, 'NOT_FOUND');
    const before = op.beforeBody ?? node.body;
    const after = op.afterBody ?? '';
    node.body = before;
    const { paths } = buildIndex(nodes);
    const info = paths.get(node.id);
    const siblings = info.parentId ? findNode(nodes, info.parentId).children : nodes;
    const index = info.path[info.path.length - 1] + 1;
    const newNode = {
      id: op.newId || newClauseId(),
      kind: node.kind,
      title: op.title || `${node.title || '条款'}（续）`,
      body: after,
      scope: node.scope ? structuredClone(node.scope) : undefined,
      children: [],
      splitFromId: node.id,
      sourceId: node.sourceId || node.id,
      sourceVersionId: node.sourceVersionId
    };
    siblings.splice(index, 0, newNode);
    return { nodes, node, newNode };
  }

  throw new Error(`未知树操作: ${type}`);
}

export function applyTreeOps(nodes, ops = []) {
  const operationList = Array.isArray(ops) ? ops : [ops];
  let result = { nodes: cloneTree(nodes) };
  for (const op of operationList) {
    result = { ...result, ...applyTreeOp(result.nodes, op) };
  }
  return result.nodes;
}

export function defaultClause(overrides = {}) {
  return {
    id: overrides.id || newClauseId(),
    kind: overrides.kind || 'clause',
    title: overrides.title ?? '',
    body: overrides.body ?? '',
    children: overrides.children ?? [],
    ...(overrides.scope ? { scope: overrides.scope } : {}),
    ...(overrides.sourceId ? { sourceId: overrides.sourceId } : {}),
    ...(overrides.sourceVersionId ? { sourceVersionId: overrides.sourceVersionId } : {}),
    ...(overrides.metadata ? { metadata: overrides.metadata } : {})
  };
}
