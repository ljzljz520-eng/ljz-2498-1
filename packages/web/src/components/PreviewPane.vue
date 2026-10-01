<script setup>
import { ref, watch, onMounted } from 'vue';
import { api } from '../api.js';
const props = defineProps({ doc: Object, tick: Number });
const html = ref('');
const numbering = ref([]);
const refs = ref({ resolved: [], dangling: [] });
const cycles = ref([]);
async function load() {
  try {
    const p = await api.get(`/api/docs/${props.doc.id}/preview`);
    html.value = p.html; numbering.value = p.numbering; refs.value = p.references; cycles.value = p.cycles;
  } catch (e) { html.value = `<pre style="padding:16px;color:#c00">${e.message}</pre>`; }
}
onMounted(load);
watch(() => props.tick, load);
</script>

<template>
  <div>
    <div style="background:#fff;padding:8px 12px;border-radius:8px 8px 0 0;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <strong style="color:#222">实时预览（非严格，未映射变量以【】提示）</strong>
      <span class="pill err" v-if="cycles.length" style="color:#c0392b">引用成环 {{ cycles.length }}</span>
      <span class="pill err" v-if="refs.dangling.length" style="color:#c0392b">悬空引用 {{ refs.dangling.length }}</span>
      <span class="pill ok" v-else style="color:#1e7e4d">引用解析正常 {{ refs.resolved.length }}</span>
      <span style="color:#666;font-size:12px">编号随树顺序自动计算；移动/插入后引用标签自动更新</span>
    </div>
    <iframe :srcdoc="html" title="preview" style="border:0;width:100%;height:72vh;background:#fff"></iframe>
  </div>
</template>
