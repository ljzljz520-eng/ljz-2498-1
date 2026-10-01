<template>
  <div class="clause-tree">
    <div v-for="node in nodes" :key="node.id">
      <ClauseNode :node="node" :path="[]" :selected-id="selectedId" :flat="flat" @select="$emit('select', $event)" />
    </div>
  </div>
</template>
<script setup>
import ClauseNode from './ClauseNode.vue';
defineProps({ nodes: { type: Array, default: () => [] }, selectedId: String, flat: { type: Array, default: () => [] } });
defineEmits(['select']);
</script>
