<template>
  <article :id="`preview-${node.id}`" class="preview-node" :class="node.kind">
    <h3><span>{{ number }}</span> {{ node.title }}</h3>
    <div v-for="(para, i) in paragraphs" :key="i" v-html="para"></div>
    <div v-for="(child, i) in node.children || []" :key="child.id">
      <NodePreview :node="child" :path="[...path, i]" :nodes="nodes" />
    </div>
  </article>
</template>
<script setup>
import { computed } from 'vue';
import { buildIndex, referenceLabel } from '../../../shared/src/index.js';
const props = defineProps({ node: Object, path: { type: Array, default: () => [] }, nodes: Array });
const number = computed(() => {
  const topIndex = Math.max(0, props.nodes.findIndex(n => n.id === props.node.id || containsId(n, props.node.id)));
  const ordinal = props.path.length ? props.path.map(n => n + 1) : [topIndex + 1];
  if (props.node.kind === 'attachment') return `附件${ordinal[0]}${ordinal.length > 1 ? '-' + ordinal.slice(1).join('.') : ''}`;
  return ordinal.length === 1 ? chineseTop(ordinal[0]) : ordinal.join('.');
});
function containsId(node, id) { return (node.children || []).some(child => child.id === id || containsId(child, id)); }
function chineseTop(n) { return ['零','一','二','三','四','五','六','七','八','九','十'][n] ?? String(n); }
const paragraphs = computed(() => {
  const idx = buildIndex(props.nodes);
  return String(props.node.body || '').split(/\n{2,}/).map(p => p
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\[\[ref:([A-Za-z0-9_-]+)(?:\|([^\]]+))?\]\]/g, (raw, id, fallback) => {
      const target = idx.byId.get(id);
      const info = idx.paths.get(id);
      const label = target ? referenceLabel(target, info.path) : (fallback ? `[${fallback}]` : `[缺失:${id}]`);
      return `<a class="ref-link" href="#preview-${id}">${label}</a>`;
    })
    .replace(/\n/g, '<br>'));
});
</script>
