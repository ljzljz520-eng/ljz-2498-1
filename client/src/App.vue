<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <h1>合同条款排版器</h1>
        <p>编号只是显示属性；交叉引用锁定稳定条款身份。软件只排版用户内容，不判断法律效力。</p>
      </div>
      <select v-model="documentId" @change="loadDocument">
        <option v-for="doc in documents" :key="doc.id" :value="doc.id">{{ doc.title }}</option>
      </select>
    </header>

    <main class="split-view">
      <section class="editor panel">
        <div class="toolbar">
          <button @click="insertClause(null, 0)">插入顶层条款</button>
          <button :disabled="!selectedId" @click="insertClause(selectedId, selectedNode?.children?.length || 0)">插入子条款</button>
          <button :disabled="!selectedId" @click="moveSelected(-1)">上移</button>
          <button :disabled="!selectedId" @click="moveSelected(1)">下移</button>
          <button class="danger" :disabled="!selectedId" @click="removeSelected">删除</button>
        </div>

        <ClauseTree :nodes="state.nodes" :selected-id="selectedId" @select="selectedId = $event" />

        <div v-if="selectedNode" class="inspector">
          <h2>编辑条款 <code>{{ selectedId }}</code></h2>
          <label>类型
            <select v-model="draft.kind" @change="patchSelected({ kind: draft.kind })">
              <option value="clause">正文条款</option>
              <option value="attachment">附件</option>
            </select>
          </label>
          <label>标题<input v-model="draft.title" @change="patchSelected({ title: draft.title })" /></label>
          <label>正文
            <textarea v-model="draft.body" rows="8" @change="patchSelected({ body: draft.body })" placeholder="使用 [[ref:稳定ID|备选文字]] 引用；{{ '{{变量名}}' }} 定义变量"></textarea>
          </label>
          <div class="grid-two">
            <label>页面方向
              <select v-model="draft.orientation" @change="patchScope">
                <option value="portrait">纵向（默认）</option>
                <option value="landscape">横向附件（仅本附件）</option>
              </select>
            </label>
            <label>节页眉<input v-model="draft.header" @change="patchScope" /></label>
          </div>
          <label>节页脚<input v-model="draft.footer" @change="patchScope" /></label>
          <div class="split-box">
            <h3>验收条款拆分</h3>
            <p class="muted">原稳定 ID 保留；新续条获得新 ID，旧引用仍指向原条款。</p>
            <div class="toolbar">
              <input v-model="splitAfter" placeholder="从此文本后的边界拆出续条（默认按两段）" />
              <button @click="splitSelected">拆分选中条款</button>
            </div>
          </div>
        </div>

        <div class="inspector">
          <h2>变量与落款</h2>
          <div v-for="definition in state.document.variables || []" :key="definition.name" class="variable-row">
            <label>{{ definition.label || definition.name }}<small v-if="definition.required !== false">必填</small>
              <input :value="state.document.variableValues?.[definition.name] || ''" @input="setVariable(definition.name, $event.target.value)" />
            </label>
          </div>
          <div class="grid-two">
            <label>甲方<input v-model="signoff.partyA" @change="saveSignoff" /></label>
            <label>乙方<input v-model="signoff.partyB" @change="saveSignoff" /></label>
          </div>
          <label>签署日期<input v-model="signoff.date" @change="saveSignoff" /></label>
          <p class="warning">落款修改只影响后续新快照；已创建审阅快照不可变。</p>
        </div>

        <div class="inspector">
          <h2>模板复用与升级</h2>
          <div class="toolbar wrap">
            <button @click="compareReuse">比较整文档复制 / 基线+差异层</button>
            <button @click="createUpstreamVersion">生成冲突模板 v1.1.0</button>
            <select v-model="targetVersionId">
              <option v-for="version in templateVersions" :key="version.id" :value="version.id">{{ version.version }}</option>
            </select>
            <button :disabled="!targetVersionId" @click="previewUpgrade">升级冲突预览</button>
          </div>
          <pre v-if="reuseReport" class="report">{{ reuseReport }}</pre>
          <div v-if="upgrade" class="upgrade-panel">
            <p v-if="!upgrade.conflicts.length" class="ok">没有冲突，可直接采纳。</p>
            <div v-for="conflict in upgrade.conflicts" :key="conflict.id" class="conflict">
              <b>{{ conflict.kind }}：{{ conflict.message }}</b>
              <template v-for="(spec, field) in conflict.allFields || {}" :key="field">
                <div v-if="spec.resolution === 'conflict'">
                  <span>{{ field }}</span>
                  <label><input type="radio" :name="conflict.id + field" value="local" v-model="choices[conflict.id].source" /> 保留本地</label>
                  <label><input type="radio" :name="conflict.id + field" value="upstream" v-model="choices[conflict.id].source" /> 采用模板</label>
                </div>
              </template>
              <label v-if="conflict.kind !== 'content'">
                人工选择
                <select v-model="choices[conflict.id].source">
                  <option value="manual">未选择（阻止采纳）</option>
                  <option value="local">保留本地</option>
                  <option value="upstream">采用模板</option>
                </select>
              </label>
            </div>
            <button @click="adoptUpgrade">人工采纳并升级</button>
          </div>
        </div>
      </section>

      <PreviewPane
        :document="state.document"
        :nodes="state.nodes"
        :issues="state.validation?.issues || []"
        :snapshot-url="snapshotUrl"
        @snapshot="createSnapshot"
        @print="printSnapshot"
      />
    </main>

    <aside class="snapshot-drawer panel">
      <h2>审阅快照 / 打印 / PDF</h2>
      <button @click="loadSnapshots">刷新快照</button>
      <div v-for="snapshot in snapshots" :key="snapshot.id" class="snapshot-card" :class="{ invalid: !snapshot.validation.ok }">
        <div><b>{{ snapshot.documentVersion }}</b> 版 · {{ new Date(snapshot.createdAt).toLocaleString() }}</div>
        <div class="muted">{{ snapshot.id }}</div>
        <div v-if="!snapshot.validation.ok" class="issue error">快照含 {{ snapshot.validation.errors.length }} 个阻止项</div>
        <div class="toolbar wrap">
          <button @click="openSnapshot(snapshot.id)">查看同一快照</button>
          <button @click="approve(snapshot.id)">批准</button>
          <button @click="reject(snapshot.id)">退回</button>
          <button @click="exportSnapshot(snapshot.id, 'print')">打印</button>
          <button @click="exportSnapshot(snapshot.id, 'pdf')">正式 PDF</button>
        </div>
      </div>
      <p v-if="globalMessage" class="global-message">{{ globalMessage }}</p>
    </aside>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from './api.js';
import ClauseTree from './components/ClauseTree.vue';
import PreviewPane from './components/PreviewPane.vue';
import { findNode } from '../../shared/src/index.js';

const documents = ref([]);
const documentId = ref('');
const state = reactive({ document: {}, nodes: [], validation: { issues: [] } });
const selectedId = ref('');
const templateVersions = ref([]);
const targetVersionId = ref('');
const upgrade = ref(null);
const choices = reactive({});
const reuseReport = ref('');
const snapshots = ref([]);
const snapshotUrl = ref('');
const globalMessage = ref('');
const splitAfter = ref('');
const signoff = reactive({ partyA: '', partyB: '', date: '' });
const draft = reactive({ kind: 'clause', title: '', body: '', orientation: 'portrait', header: '', footer: '' });

const selectedNode = computed(() => findNode(state.nodes, selectedId.value));
watch(selectedNode, node => {
  if (!node) return;
  draft.kind = node.kind;
  draft.title = node.title;
  draft.body = node.body;
  draft.orientation = node.scope?.page?.orientation || 'portrait';
  draft.header = node.scope?.header?.text || '';
  draft.footer = node.scope?.footer?.text || '';
}, { immediate: true });

onMounted(async () => {
  documents.value = (await api.listDocuments()).items;
  documentId.value = documents.value[0]?.id;
  await loadDocument();
});

async function loadDocument() {
  if (!documentId.value) return;
  const result = await api.getDocument(documentId.value);
  state.document = result.document;
  state.nodes = result.nodes;
  state.validation = result.validation;
  Object.assign(signoff, state.document.signoff || {});
  selectedId.value = result.nodes[0]?.id;
  templateVersions.value = await loadVersions(result.document.templateId);
  await loadSnapshots();
}

async function loadVersions(templateId) {
  const response = await fetch(`/api/templates/${templateId}/versions`).then(r => r.json());
  return response.items || [];
}

async function mutate(operation) {
  const result = await api.mutate(documentId.value, operation);
  state.document = result.document;
  state.nodes = result.nodes;
  state.validation = result.validation;
  await loadSnapshots();
}

function insertClause(parentId, index) {
  const node = { kind: 'clause', title: '新条款', body: '请输入条款正文。', children: [] };
  mutate({ type: 'insert', parentId, index, node });
}
async function patchSelected(patch) {
  if (!selectedId.value) return;
  await mutate({ type: 'update', id: selectedId.value, patch });
}
function patchScope() {
  const scope = draft.orientation === 'landscape' ? {
    page: { size: 'A4', orientation: 'landscape' },
    header: { text: draft.header }, footer: { text: draft.footer }
  } : { page: { size: 'A4', orientation: 'portrait' }, header: { text: draft.header || undefined }, footer: { text: draft.footer || undefined } };
  patchSelected({ scope });
}
function siblingInfo(nodeId) {
  const find = (list, parentId = null) => {
    const index = list.findIndex(n => n.id === nodeId);
    if (index >= 0) return { list, index, parentId };
    for (const n of list) {
      const hit = n.children && find(n.children, n.id);
      if (hit) return hit;
    }
  };
  return find(state.nodes) || {};
}
function moveSelected(delta) {
  const info = siblingInfo(selectedId.value);
  const index = Math.max(0, Math.min(info.index + delta, info.list.length - 1));
  api.move(documentId.value, selectedId.value, info.parentId, index).then(reload);
}
function removeSelected() { mutate({ type: 'delete', id: selectedId.value }); }
async function splitSelected() {
  const node = selectedNode.value;
  const boundary = splitAfter.value ? node.body.indexOf(splitAfter.value) + splitAfter.value.length : Math.ceil(node.body.length / 2);
  const beforeBody = node.body.slice(0, boundary).trim();
  const afterBody = node.body.slice(boundary).trim();
  const result = await api.split(documentId.value, selectedId.value, { beforeBody, afterBody, title: `${node.title || '条款'}（续）` });
  state.document = result.document; state.nodes = result.nodes; state.validation = result.validation;
  splitAfter.value = '';
}
async function setVariable(name, value) {
  const result = await api.setVariables(documentId.value, { [name]: value });
  state.document = result.document; state.nodes = result.nodes; state.validation = result.validation;
}
async function saveSignoff() {
  const result = await api.setSignoff(documentId.value, { ...signoff });
  state.document = result.document; state.validation = result.validation;
}
async function compareReuse() {
  const result = await api.compareReuse(documentId.value, { mappings: {} });
  reuseReport.value = JSON.stringify({ recommendation: result.recommendation, fullCopy: result.comparison.fullCopy.summary, baselineDiff: result.comparison.baselineDiff.summary, variables: result.variables }, null, 2);
}
async function createUpstreamVersion() {
  const targetId = findNode(state.nodes, state.nodes.find(n => n.title === '验收')?.id)?.id || state.nodes[1]?.id;
  const operations = [
    { type: 'update', id: targetId, patch: { title: '验收与交付确认（模板 1.1 修改）', body: '模板新版本修改了验收流程，制造本地与模板冲突。' } },
    { type: 'insert', parentId: null, index: state.nodes.length, node: { kind: 'clause', title: '新增合规条款', body: '这是模板上游新增条款。', children: [] } }
  ];
  const result = await fetch(`/api/templates/${state.document.currentVersionId}/child-versions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: '1.1.0', operations, note: 'simulated upstream change' })
  }).then(r => r.json());
  if (result.error) return globalMessage.value = result.error.message;
  targetVersionId.value = result.version.id;
  templateVersions.value = await loadVersions(state.document.templateId);
  globalMessage.value = '已生成上游 1.1.0';
}
async function previewUpgrade() {
  upgrade.value = await api.previewUpgrade(documentId.value, targetVersionId.value);
  for (const conflict of upgrade.value.conflicts) {
    if (!choices[conflict.id]) choices[conflict.id] = { source: 'manual', fields: {} };
  }
}
async function adoptUpgrade() {
  try {
    const result = await api.adoptUpgrade(documentId.value, targetVersionId.value, choices);
    state.document = result.document; state.nodes = result.nodes; state.validation = result.validation;
    upgrade.value = null;
    globalMessage.value = '升级已采纳';
  } catch (error) {
    globalMessage.value = error.message || '仍有冲突未人工采纳';
  }
}
async function createSnapshot() {
  await api.createSnapshot(documentId.value, 'manual-review');
  await loadSnapshots();
}
async function loadSnapshots() {
  if (!documentId.value) return;
  snapshots.value = (await api.listSnapshots(documentId.value)).items;
}
function openSnapshot(id) { snapshotUrl.value = `/api/snapshots/${id}/render?t=${Date.now()}`; }
async function printSnapshot(snapshotArg = null) {
  const latest = snapshotArg ?? snapshots.value[0];
  if (!latest) return globalMessage.value = '请先创建审阅快照';
  if (!latest.validation?.ok && !confirm('该快照仍有断链、成环、未映射变量或缺失字体。继续只用于审阅打印；正式另存 PDF 必须先修正。是否继续？')) return;
  await api.exportSnapshot(latest.id, 'print');
  openSnapshot(latest.id);
  setTimeout(() => document.querySelector('.snapshot-frame')?.contentWindow?.print(), 800);
}
async function approve(id) { await api.review(id, 'approved', '人工批准'); globalMessage.value = '已记录批准'; }
async function reject(id) { await api.review(id, 'rejected', '人工退回'); globalMessage.value = '已记录退回'; }
async function exportSnapshot(id, format) {
  try {
    const job = await api.exportSnapshot(id, format);
    if (format === 'print') await printSnapshot({ id, validation: snapshots.value.find(s => s.id === id)?.validation ?? { ok: true } });
    globalMessage.value = job.error?.message || `${format} 导出任务：${job.status}`;
  } catch (error) { globalMessage.value = error.message; }
  await loadSnapshots();
}
async function reload(result) {
  const fresh = result || await api.getDocument(documentId.value);
  state.document = fresh.document; state.nodes = fresh.nodes; state.validation = fresh.validation;
}
</script>
