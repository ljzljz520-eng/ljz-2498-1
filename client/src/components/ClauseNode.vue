<template>
  <article class="clause-row" :class="{ selected: node.id === selectedId, attachment: node.kind === 'attachment' }">
    <div class="clause-head">
      <span class="number-badge">{{ displayNumber }}</span>
      <button class="link-button" @click="$emit('select', node.id)">{{ node.title || '未命名条款' }}</button>
      <span class="stable-id" :title="node.id">ID {{ node.id.slice(-6) }}</span>
      <span v-if="node.scope?.page?.orientation === 'landscape'" class="scope-badge landscape">横向</span>
    </div>
    <p v-if="node.body" class="body-draft">{{ node.body.slice(0, 90) }}<span v-if="node.body.length > 90">…</span></p>
    <div v-if="node.children?.length" class="child-list">
      <ClauseNode
        v-for="(child, index) in node.children"
        :key="child.id"
        :node="child"
        :path="[...path, index]"
        :selected-id="selectedId"
        @select="$emit('select', $event)"
      />
    </div>
  </article>
</template>
<script setup>
import { computed } from 'vue';
const props = defineProps({ node: Object, path: { type: Array, default: () => [] }, selectedId: String });
defineEmits(['select']);
const displayNumber = computed(() => {
  const hit = props.node;
  return hit.kind === 'attachment' ? `附件${(props.path[0] ?? 0) + 1}` : (props.path.map(n => n + 1).join('.') || '1');
});
</script>
