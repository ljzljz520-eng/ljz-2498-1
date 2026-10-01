<script setup>
import { ref, onMounted } from 'vue';
import { api } from './api.js';
import EditorPane from './components/EditorPane.vue';
import VariablesPane from './components/VariablesPane.vue';
import UpgradePane from './components/UpgradePane.vue';
import ReviewPane from './components/ReviewPane.vue';
import PreviewPane from './components/PreviewPane.vue';

const tab = ref('edit'); // edit | variables | upgrade | review
const templates = ref([]);
const docs = ref([]);
const currentDoc = ref(null);
const version = ref(null);
const previewTick = ref(0);
const banner = ref(null);

async function loadTemplates() {
  templates.value = await api.get('/api/templates');
  docs.value = await api.get('/api/docs');
}
onMounted(loadTemplates);

async function createDoc(t) {
  const versionId = t.currentVersionId;
  const title = prompt('文档标题', `${t.name} - 合同文档`);
  if (title === null) return;
  const { doc } = await api.post('/api/docs', { title, versionId });
  await selectDoc(doc.id);
  await loadTemplates();
}
async function selectDoc(id) {
  const res = await api.get(`/api/docs/${id}`);
  currentDoc.value = res.doc;
  version.value = res.version;
  tab.value = 'edit';
  bump();
}
function bump() { previewTick.value++; }

function showBanner(type, msg) { banner.value = { type, msg }; setTimeout(() => (banner.value = null), 6000); }
</script>

<template>
  <div class="app">
    <div class="topbar">
      <h1>合同条款排版器</h1>
      <select style="max-width:220px" @change="(e) => e.target.value && createDoc(templates.find(t => t.id === e.target.value))">
        <option value="">＋ 从模板新建（复用基线+差异层）…</option>
        <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
      </select>
      <select style="max-width:240px" :value="currentDoc?.id" @change="(e) => e.target.value && selectDoc(e.target.value)">
        <option value="">打开文档…</option>
        <option v-for="d in docs" :key="d.id" :value="d.id">{{ d.title }}</option>
      </select>
      <div class="spacer"></div>
      <nav class="tabs" v-if="currentDoc">
        <button :class="{active: tab==='edit'}" @click="tab='edit'">条款/附件</button>
        <button :class="{active: tab==='variables'}" @click="tab='variables'">变量映射</button>
        <button :class="{active: tab==='upgrade'}" @click="tab='upgrade'">模板升级</button>
        <button :class="{active: tab==='review'}" @click="tab='review'">审阅/导出</button>
      </nav>
    </div>

    <div v-if="banner" :class="['stripe', banner.type]" style="margin:8px 16px 0">{{ banner.msg }}</div>

    <div class="main" v-if="currentDoc">
      <div class="pane editor">
        <EditorPane v-if="tab==='edit'" :doc="currentDoc" @changed="bump" @banner="showBanner"/>
        <VariablesPane v-else-if="tab==='variables'" :doc="currentDoc" :version="version" @changed="bump" @banner="showBanner"/>
        <UpgradePane v-else-if="tab==='upgrade'" :doc="currentDoc" :template="templates.find(t=>t.id===doc.templateId)" @changed="(p)=>{ currentDoc=p.doc; version=p.version||version; bump(); }" @banner="showBanner"/>
        <ReviewPane v-else :doc="currentDoc" @changed="bump" @banner="showBanner"/>
      </div>
      <div class="pane preview">
        <PreviewPane :doc="currentDoc" :tick="previewTick"/>
      </div>
    </div>
    <div v-else class="pane" style="color:#9fb0c8;padding-top:80px;text-align:center;width:100%">
      <p>请从顶部「从模板新建」开始。</p>
      <p class="muted">编号仅为显示属性；交叉引用指向稳定条款身份。<br>软件只排版用户内容，不判断条款法律效力。</p>
    </div>
    <div class="legal">本软件仅对用户提供的内容进行排版，不判断条款的法律效力。打印与 PDF 共用同一审阅快照。</div>
  </div>
</template>
