import { applyTreeOps, buildIndex, findNode } from './tree.js';
import { newClauseId, newVersionId } from './ids.js';
import { assert, stableStringify } from './utils.js';

export function resolveTemplateVersion(version, ancestorVersions = []) {
  const byId = new Map(ancestorVersions.map(v => [v.id, v]));
  const chain = [];
  let current = version;
  const seen = new Set();
  while (current) {
    assert(!seen.has(current.id), '模板继承链成环', 'TEMPLATE_CYCLE');
    seen.add(current.id);
    chain.push(current);
    current = current.parentVersionId ? byId.get(current.parentVersionId) : null;
    if (current?.parentVersionId && !byId.has(current.parentVersionId) && current.parentVersionId !== version.id) {
      // Allow repositories to hydrate a longer chain; caller should provide it. Fail closed rather than silently truncate.
      throw Object.assign(new Error(`缺少祖先模板版本: ${current.parentVersionId}`), { code: 'MISSING_ANCESTOR' });
    }
  }
  const root = chain[chain.length - 1];
  let nodes = structuredClone(root.baseNodes ?? []);
  for (let i = chain.length - 2; i >= 0; i--) {
    nodes = applyTreeOps(nodes, chain[i].operations ?? []);
  }
  return {
    ...version,
    nodes,
    chain: chain.map(v => ({ id: v.id, version: v.version, templateId: v.templateId })),
    variables: mergeVariableDeclarations(chain),
    styles: mergeStyles(chain)
  };
}

export function mergeVariableDeclarations(chainFromChildToRoot = []) {
  const map = new Map();
  for (let i = chainFromChildToRoot.length - 1; i >= 0; i--) {
    for (const variable of chainFromChildToRoot[i].variables ?? []) {
      map.set(variable.name, { ...(map.get(variable.name) ?? {}), ...structuredClone(variable) });
    }
  }
  return [...map.values()];
}

export function mergeStyles(chainFromChildToRoot = []) {
  let result = {};
  for (let i = chainFromChildToRoot.length - 1; i >= 0; i--) {
    result = { ...result, ...(chainFromChildToRoot[i].styles ?? {}) };
  }
  return result;
}

export function makeTemplateVersion({ templateId, version, parentVersionId = null, baseNodes = [], operations = [], variables = [], styles = {}, note = '' }) {
  return {
    id: newVersionId(),
    templateId,
    version,
    parentVersionId,
    baseNodes,
    operations,
    variables,
    styles,
    note,
    createdAt: new Date().toISOString()
  };
}

function localChangeKey(change) {
  return `${change.type}:${change.id ?? change.node?.id ?? ''}`;
}

export function diffTrees(oldNodes, newNodes, { includeUnchanged = false } = {}) {
  const oldIndex = buildIndex(oldNodes);
  const newIndex = buildIndex(newNodes);
  const changes = [];

  for (const [id, node] of oldIndex.byId) {
    if (!newIndex.byId.has(id)) {
      changes.push({ kind: 'deleted', id, old: node, new: null, oldPath: oldInfo.path, parentId: oldInfo.parentId });
      continue;
    }
    const next = newIndex.byId.get(id);
    const oldInfo = oldIndex.paths.get(id);
    const newInfo = newIndex.paths.get(id);
    const moved = oldInfo.parentId !== newInfo.parentId || oldInfo.path.join('.') !== newInfo.path.join('.');
    const fields = {};
    for (const key of ['kind', 'title', 'body', 'scope', 'metadata']) {
      if (stableStringify(node[key]) !== stableStringify(next[key])) fields[key] = { old: node[key], new: next[key] };
    }
    if (moved || Object.keys(fields).length) {
      changes.push({ kind: 'modified', id, old: node, new: next, moved, oldPath: oldInfo.path, newPath: newInfo.path, oldParentId: oldInfo.parentId, newParentId: newInfo.parentId, fields });
    } else if (includeUnchanged) {
      changes.push({ kind: 'unchanged', id, old: node, new: next, oldPath: oldInfo.path, newPath: newInfo.path, parentId: newInfo.parentId });
    }
  }

  for (const [id, node] of newIndex.byId) {
    if (!oldIndex.byId.has(id)) {
      const info = newIndex.paths.get(id);
      changes.push({ kind: 'added', id, old: null, new: node, newPath: info.path, parentId: info.parentId });
    }
  }
  return changes;
}

export function threeWayMerge({ baseNodes, parentOldNodes, parentNewNodes, localNodes, localOps = [] }) {
  const upstreamChanges = diffTrees(parentOldNodes, parentNewNodes);
  const localChanges = diffTrees(baseNodes, localNodes);
  const localKeyed = new Map(localChanges.map(change => [change.id, change]));
  const localOpKeys = new Set(localOps.map(localChangeKey));
  const conflicts = [];
  const resolutions = [];
  const automatic = [];

  for (const upstream of upstreamChanges) {
    const local = localKeyed.get(upstream.id);
    if (!local) {
      automatic.push(upstream);
      continue;
    }
    if (local.kind === 'deleted' && upstream.kind === 'deleted') {
      automatic.push({ kind: 'deleted', id: upstream.id, reason: 'both-deleted' });
      continue;
    }
    if (local.kind === 'deleted' || upstream.kind === 'deleted') {
      conflicts.push({ id: upstream.id, kind: 'delete-content', local, upstream, message: '一方删除而另一方修改，需要人工选择' });
      continue;
    }
    if (local.kind !== 'modified' || upstream.kind !== 'modified') {
      conflicts.push({ id: upstream.id, kind: 'structural', local, upstream, message: '结构变更冲突，需要人工选择' });
      continue;
    }
    const fields = {};
    for (const key of Object.keys({ ...local.fields, ...upstream.fields })) {
      if (!local.fields[key]) {
        fields[key] = { resolution: 'upstream', ...upstream.fields[key] };
      } else if (!upstream.fields[key]) {
        fields[key] = { resolution: 'local', ...local.fields[key] };
      } else if (stableStringify(local.fields[key].new) === stableStringify(upstream.fields[key].new)) {
        fields[key] = { resolution: 'same', new: upstream.fields[key].new };
      } else {
        fields[key] = { resolution: 'conflict', local: local.fields[key].new, upstream: upstream.fields[key].new };
      }
    }
    const conflictFields = Object.entries(fields).filter(([, value]) => value.resolution === 'conflict');
    if (local.moved && upstream.moved) {
      conflicts.push({ id: upstream.id, kind: 'position', local, upstream, fields, message: '本地与新模板都移动了条款，需要人工选择' });
    } else if (conflictFields.length) {
      conflicts.push({ id: upstream.id, kind: 'content', local, upstream, fields: Object.fromEntries(conflictFields.map(([k, v]) => [k, v])), allFields: fields, message: `字段冲突: ${conflictFields.map(([k]) => k).join(', ')}` });
    } else {
      automatic.push({ kind: 'modified', id: upstream.id, fields });
    }
  }

  for (const local of localChanges) {
    if (!upstreamChanges.some(change => change.id === local.id)) automatic.push(local);
  }

  for (const change of localChanges) {
    if (change.kind === 'added') resolutions.push({ source: 'local', id: change.id });
  }
  for (const change of upstreamChanges) {
    if (change.kind === 'added' && !localKeyed.has(change.id)) resolutions.push({ source: 'upstream', id: change.id });
  }

  return {
    conflicts,
    automatic,
    localChanges,
    upstreamChanges,
    localOps: [...localOpKeys],
    requiresManualChoice: conflicts.length > 0,
    stats: {
      upstream: upstreamChanges.length,
      local: localChanges.length,
      conflicts: conflicts.length
    }
  };
}

export function adoptUpgrade({ preview, choices = {}, parentNewNodes }) {
  assert(preview, '升级预览不存在', 'NOT_FOUND');
  const unresolved = preview.conflicts.filter(conflict => !choices[conflict.id] || choices[conflict.id].source === 'manual');
  assert(unresolved.length === 0, '存在未人工采纳的模板升级冲突', 'UNRESOLVED_CONFLICT', unresolved);

  const parentIndex = buildIndex(parentNewNodes);
  const selected = new Map();
  const removed = new Set();
  const placement = new Map();

  const remember = (change, side = 'new') => {
    const node = side === 'old' ? change.old : change.new;
    if (!node) return;
    selected.set(node.id, structuredClone(node));
    placement.set(node.id, { parentId: change.parentId ?? null, path: side === 'old' ? change.oldPath : change.newPath });
  };

  for (const change of preview.automatic) {
    if (change.kind === 'added' && change.new) remember(change, 'new');
    if (change.kind === 'deleted') removed.add(change.id);
    if (change.kind === 'modified' && preview.localChanges.some(local => local.id === change.id)) remember(change, 'new');
  }

  for (const conflict of preview.conflicts) {
    const choice = choices[conflict.id] ?? {};
    const source = choice.source;
    assert(['local', 'upstream', 'manual'].includes(source), '冲突选择必须为 local、upstream 或 manual', 'INVALID_CHOICE');

    if (conflict.kind === 'delete-content') {
      if (source === 'upstream') removed.add(conflict.id);
      else remember(conflict.local, 'new');
      continue;
    }

    const sourceChange = source === 'local' ? conflict.local : conflict.upstream;
    const sourceNode = sourceChange.new ?? sourceChange.old;
    if (!sourceNode) {
      removed.add(conflict.id);
      continue;
    }
    let node = structuredClone(sourceNode);
    if (conflict.kind === 'content') {
      for (const [field, spec] of Object.entries(conflict.allFields ?? {})) {
        const picked = choice.fields?.[field] ?? source;
        if (picked === 'local') node[field] = structuredClone(conflict.local.fields[field]?.new ?? node[field]);
        else if (picked === 'upstream') node[field] = structuredClone(conflict.upstream.fields[field]?.new ?? node[field]);
      }
    }
    selected.set(conflict.id, node);
    placement.set(conflict.id, {
      parentId: sourceChange.parentId ?? null,
      path: sourceChange.newPath ?? sourceChange.oldPath,
      localParentId: conflict.local.parentId,
      upstreamParentId: conflict.upstream.parentId
    });
  }

  for (const [id, node] of parentIndex.byId) {
    if (!removed.has(id) && !selected.has(id)) selected.set(id, structuredClone(node));
  }
  for (const id of removed) selected.delete(id);
  pruneDescendants(selected, parentIndex, removed);
  return { nodes: rebuildSelectedTree(selected, placement, parentIndex), choices };
}

function pruneDescendants(selected, parentIndex, removedIds) {
  for (const id of [...selected.keys()]) {
    let current = id;
    while (current) {
      const info = parentIndex.paths.get(current);
      if (!info) break;
      current = info.parentId;
      if (current && removedIds.has(current)) {
        selected.delete(id);
        break;
      }
    }
  }
}

function rebuildSelectedTree(selected, placement, parentIndex) {
  const childrenMap = new Map([[null, []]]);
  const order = new Map();
  for (const [id, node] of selected) {
    const cloned = { ...node, children: [] };
    let parentId = placement.get(id)?.parentId ?? parentIndex.paths.get(id)?.parentId ?? null;
    while (parentId && !selected.has(parentId)) parentId = parentIndex.paths.get(parentId)?.parentId ?? null;
    const path = placement.get(id)?.path ?? parentIndex.paths.get(id)?.path ?? [];
    order.set(id, path);
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId).push(cloned);
  }
  const sortSiblings = (parentId) => {
    const siblings = childrenMap.get(parentId) ?? [];
    siblings.sort((a, b) => ((order.get(a.id) ?? []).at(-1) ?? 0) - ((order.get(b.id) ?? []).at(-1) ?? 0));
    siblings.forEach(node => { node.children = sortSiblings(node.id); });
    return siblings;
  };
  return sortSiblings(null);
}

export function compareReusePlans({ sourceNodes, sourceTemplateId, sourceVersionId, targetVariables = [], mappings = {}, copyAll = false, regenerateIds = true }) {
  const cloned = structuredClone(sourceNodes);
  const idMap = new Map();
  if (regenerateIds) {
    const { byId } = buildIndex(cloned);
    for (const oldId of byId.keys()) idMap.set(oldId, newClauseId());
  }
  const rewriteIds = nodes => nodes.map(node => ({
    ...node,
    id: idMap.get(node.id) ?? node.id,
    sourceId: node.id,
    sourceTemplateId,
    sourceVersionId,
    body: String(node.body ?? '').replace(/\[\[ref:([A-Za-z0-9_-]+)/g, (_, id) => `[[ref:${idMap.get(id) ?? id}`),
    children: rewriteIds(node.children ?? [])
  }));

  const fullCopyNodes = copyAll || regenerateIds ? rewriteIds(cloned) : cloned;
  const variableMap = new Map();
  const walkMappings = nodes => nodes.forEach(node => {
    const body = `${node.title}\n${node.body}`;
    for (const match of body.matchAll(/\{\{\s*([A-Za-z_$][\w$.]*)/g)) {
      const sourceName = match[1];
      if (mappings[sourceName]) variableMap.set(sourceName, mappings[sourceName]);
    }
    walkMappings(node.children ?? []);
  });
  walkMappings(fullCopyNodes);

  const sourceVars = [...new Set([...extractVariableNames(sourceNodes)])];
  const migrated = [];
  const unmapped = [];
  for (const name of sourceVars) {
    const target = mappings[name];
    if (target) migrated.push({ source: name, target });
    else unmapped.push(name);
  }
  const targetNames = new Set(targetVariables.map(v => v.name ?? v));
  const invalidTargets = [...new Set(migrated.map(m => m.target))].filter(name => !targetNames.has(name));

  return {
    fullCopy: {
      mode: 'full-copy',
      nodes: fullCopyNodes,
      idMap: [...idMap.entries()].map(([oldId, newId]) => ({ oldId, newId })),
      provenancePreserved: true
    },
    baselineDiff: {
      mode: 'baseline-diff',
      sourceTemplateId,
      sourceVersionId,
      // No document nodes are copied; concrete edits are represented by a local operation layer.
      localOperations: [],
      provenance: { sourceTemplateId, sourceVersionId, reusedAt: new Date().toISOString() }
    },
    variables: { migrated, unmapped, invalidTargets, blocksFormalExport: unmapped.length > 0 || invalidTargets.length > 0 },
    recommendation: 'prefer-baseline-diff'
  };
}

function extractVariableNames(nodes) {
  const names = [];
  const walk = list => list.forEach(node => {
    for (const match of `${node.title}\n${node.body}`.matchAll(/\{\{\s*([A-Za-z_$][\w$.]*)/g)) names.push(match[1]);
    (node.children ?? []).forEach(walk);
  });
  walk(nodes);
  return names;
}
