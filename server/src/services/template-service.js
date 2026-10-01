import {
  assert, compareReusePlans, makeTemplateVersion, newTemplateId,
  resolveTemplateVersion, threeWayMerge
} from '../../../shared/src/index.js';
import { ensureClauseIdentities } from './identity-service.js';

export class TemplateService {
  constructor(store) { this.store = store; }

  async createTemplate({ name, description = '', version = '1.0.0', baseNodes = [], variables = [], styles = {}, note = '' }) {
    assert(name, '模板名称必填');
    const id = newTemplateId();
    const versionEntity = makeTemplateVersion({ templateId: id, version, baseNodes, variables, styles, note });
    const template = { id, name, description, currentVersionId: versionEntity.id };
    await this.store.put('templateVersions', versionEntity);
    await this.store.put('templates', template);
    await ensureClauseIdentities(this.store, { templateVersionId: versionEntity.id, nodes: versionEntity.baseNodes, sourceTemplateId: id, sourceVersionId: versionEntity.id });
    return { template: await this.store.get('templates', id), version: await this.store.get('templateVersions', versionEntity.id) };
  }

  async listTemplates() {
    const templates = await this.store.list('templates');
    return Promise.all(templates.map(async template => ({ ...template, currentVersion: await this.getVersion(template.currentVersionId) })));
  }

  async getTemplate(id) {
    const template = await this.store.get('templates', id);
    assert(template, `模板不存在: ${id}`, 'NOT_FOUND');
    return template;
  }

  async getVersion(versionId) {
    const version = await this.store.get('templateVersions', versionId);
    assert(version, `模板版本不存在: ${versionId}`, 'NOT_FOUND');
    return version;
  }

  async listVersions(templateId) {
    await this.getTemplate(templateId);
    return this.store.list('templateVersions', v => v.templateId === templateId);
  }

  async hydrateAncestors(version) {
    const versions = [];
    const seen = new Set();
    let current = version;
    while (current) {
      assert(!seen.has(current.id), '模板继承链成环', 'TEMPLATE_CYCLE');
      seen.add(current.id);
      versions.push(current);
      current = current.parentVersionId ? await this.getVersion(current.parentVersionId) : null;
    }
    return versions;
  }

  async resolveVersion(versionId) {
    const version = await this.getVersion(versionId);
    return resolveTemplateVersion(version, await this.hydrateAncestors(version));
  }

  async createChildVersion({ parentVersionId, version, operations = [], variables = [], styles = {}, note = '' }) {
    const parent = await this.getVersion(parentVersionId);
    const resolvedParent = await this.resolveVersion(parentVersionId);
    const entity = makeTemplateVersion({
      templateId: parent.templateId,
      version,
      parentVersionId,
      // A child has no new hard-coded baseline; all content comes from parent plus operation layer.
      baseNodes: [],
      operations,
      variables,
      styles,
      note
    });
    await this.store.put('templateVersions', entity);
    const template = await this.getTemplate(parent.templateId);
    template.currentVersionId = entity.id;
    await this.store.put('templates', template);
    const resolved = await this.resolveVersion(entity.id);
    await ensureClauseIdentities(this.store, { templateVersionId: entity.id, nodes: resolved.nodes, sourceTemplateId: parent.templateId, sourceVersionId: parent.id });
    return { version: entity, resolved, previous: resolvedParent };
  }

  async createForkFromTemplate({ sourceVersionId, name, description = '', mappings = {}, version = '1.0.0' }) {
    const source = await this.resolveVersion(sourceVersionId);
    const plan = compareReusePlans({
      sourceNodes: source.nodes,
      sourceTemplateId: source.templateId,
      sourceVersionId: source.id,
      targetVariables: source.variables,
      mappings,
      regenerateIds: false
    });
    assert(!plan.variables.unmapped.length, `复用模板存在未映射变量: ${plan.variables.unmapped.join(', ')}`, 'UNMAPPED_VARIABLE', plan.variables);
    const created = await this.createTemplate({
      name,
      description: `${description}\n来源模板: ${source.templateId}@${source.version} (${source.id})`.trim(),
      version,
      baseNodes: source.nodes,
      variables: migrateVariableDefinitions(source.variables, mappings),
      styles: source.styles,
      note: `Forked from ${sourceVersionId}`
    });
    return { ...created, reuse: plan };
  }

  async previewVersionUpgrade({ documentBaseVersionId, currentParentVersionId, targetVersionId, localNodes, localOps = [] }) {
    const parentOld = await this.resolveVersion(currentParentVersionId);
    const parentNew = await this.resolveVersion(targetVersionId);
    const base = await this.resolveVersion(documentBaseVersionId);
    assert(parentOld.templateId === parentNew.templateId, '只能升级同一模板的版本', 'INVALID_TEMPLATE');
    return {
      ...threeWayMerge({
        baseNodes: base.nodes,
        parentOldNodes: parentOld.nodes,
        parentNewNodes: parentNew.nodes,
        localNodes,
        localOps
      }),
      fromVersion: { id: parentOld.id, version: parentOld.version },
      toVersion: { id: parentNew.id, version: parentNew.version },
      parentNewNodes: parentNew.nodes,
      variablePlan: buildVariableMigrationPlan(parentOld.variables, parentNew.variables)
    };
  }
}

function migrateVariableDefinitions(definitions = [], mappings = {}) {
  return definitions.map(v => mappings[v.name] ? { ...v, name: mappings[v.name], migratedFrom: v.name } : v);
}

export function buildVariableMigrationPlan(oldVars = [], newVars = []) {
  const oldMap = new Map(oldVars.map(v => [v.name, v]));
  const newMap = new Map(newVars.map(v => [v.name, v]));
  return {
    added: newVars.filter(v => !oldMap.has(v.name)),
    removed: oldVars.filter(v => !newMap.has(v.name)),
    changed: newVars.filter(v => oldMap.has(v.name) && JSON.stringify(oldMap.get(v.name)) !== JSON.stringify(v)),
    unmapped: [],
    blocksFormalExport: false
  };
}
