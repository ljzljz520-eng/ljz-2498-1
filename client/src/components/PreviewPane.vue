<template>
  <div class="preview-pane">
    <div class="preview-toolbar no-print">
      <div>
        <strong>实时预览</strong>
        <span class="muted">编号实时生成；引用锁定稳定 ID</span>
      </div>
      <div class="toolbar-actions">
        <button @click="$emit('snapshot')">创建审阅快照</button>
        <button @click="$emit('print')">打印 / 另存 PDF</button>
      </div>
    </div>
    <div v-if="issues.length" class="issue-list">
      <div v-for="(issue, i) in issues" :key="i" class="issue" :class="issue.level">
        <b>{{ issue.code }}</b> {{ issue.message }}
      </div>
    </div>
    <iframe v-if="snapshotUrl" :src="snapshotUrl" title="审阅快照预览" class="snapshot-frame" />
    <div v-else class="paper-stack">
      <section v-for="section in sections" :key="section.id" class="paper" :class="section.scope.page.orientation">
        <header>{{ renderVars(section.scope.header?.text) }}</header>
        <h2>{{ document.title }}</h2>
        <node-preview :node="section.node" :path="[]" :nodes="nodes" />
        <footer>{{ renderVars(section.scope.footer?.text) }}</footer>
      </section>
    </div>
  </div>
</template>
<script setup>
import { computed } from 'vue';
import NodePreview from './NodePreview.vue';
import { buildIndex, clauseNumber } from '../../../shared/src/index.js';

const props = defineProps({
  document: Object,
  nodes: { type: Array, default: () => [] },
  issues: { type: Array, default: () => [] },
  snapshotUrl: String
});
defineEmits(['snapshot', 'print']);
const index = computed(() => buildIndex(props.nodes));
const sections = computed(() => props.nodes.map((node, i) => ({
  id: node.id,
  node,
  scope: {
    page: { orientation: node.scope?.page?.orientation ?? 'portrait' },
    header: { text: node.scope?.header?.text ?? props.document?.scope?.header?.text ?? '' },
    footer: { text: node.scope?.footer?.text ?? props.document?.scope?.footer?.text ?? '' }
  },
  number: clauseNumber(node.kind, [i])
})));
function renderVars(text = '') {
  return text
    .replaceAll('{{document.title}}', props.document?.title ?? '')
    .replaceAll('{{page.number}}', '#');
}
</script>
