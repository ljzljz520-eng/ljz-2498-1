<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
const p = defineProps({ doc: Object, version: Object });
const emit = defineEmits(['changed', 'banner']);
const report = ref(null);
const values = ref({});
const varMap = ref({});
const comparison = ref(null);

async function load() {
  report.value = await api.get(`/api/docs/${p.doc.id}/validate`);
  const full = await api.get(`/api/docs/${p.doc.id}`);
  values.value = full.doc.values || {}; varMap.value = full.doc.varMap || {};
  comparison.value = await api.get(`/api/docs/${p.doc.id}/comparison`);
}
onMounted(load);

function must(name){ return '{{'+name+'}}'; }
async function save() {
  await api.put(`/api/docs/${p.doc.id}/values`, { values: values.value });
  await api.put(`/api/docs/${p.doc.id}/varmap`, { varMap: varMap.value });
  emit('banner', 'ok', '变量值/映射已保存'); await load(); emit('changed');
}
</script>

<template>
  <div>
    <div class="card">
      <h3 style="margin:0 0 8px">模板变量与字段迁移</h3>
      <p class="muted">复用模板时保留来源；目标变量可映射到其它字段或填字面值。<b>未映射的必填变量会在正式导出时被显式阻止</b>。</p>
      <div v-for="v in version?.variables || []" :key="v.name" class="block-item">
        <div class="meta"><span>{{ v.label }}</span><span class="refchip">{{ must(v.name) }}</span>
          <span class="pill" :class="v.required ? 'err' : 'ok'">{{ v.required ? '必填' : '可选' }}</span></div>
        <label class="fld">取值（字面值）</label>
        <input v-model="values[v.name]" :placeholder="v.default ? '默认：'+v.default : '未填则导出被阻止'" />
      </div>
      <button @click="save">保存变量</button>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">导出前校验</h3>
      <div v-if="!report" class="muted">加载中…</div>
      <div :class="['stripe', report?.ok ? 'ok' : 'err']">
        {{ report?.ok ? '校验通过，可以进入审阅' : '存在阻断项，禁止正式导出' }}
      </div>
      <div v-for="(e,i) in report?.errors || []" :key="'e'+i" class="stripe err">✗ {{ e.message }}</div>
      <div v-for="(w,i) in report?.warnings || []" :key="'w'+i" class="stripe warn">⚠ {{ w.message }}</div>
    </div>

    <div class="card" v-if="comparison">
      <h3 style="margin:0 0 6px">整文档复制 vs 基线+差异层</h3>
      <table class="table-mini">
        <tr><th>策略</th><th>存储字节（约）</th><th>渲染块数</th></tr>
        <tr><td>整文档复制</td><td>{{ comparison.fullCopyBytes }}</td><td>{{ comparison.renderedBlockCount }}</td></tr>
        <tr><td>基线+差异层（ops {{ comparison.layerOps }}）</td><td>{{ comparison.diffLayerBytes }} <span class="ok2">（另含不可变基线 {{ comparison.baselineBytes }}，多文档共享）</span></td><td>{{ comparison.renderedBlockCount }}</td></tr>
      </table>
      <p class="muted" :class="comparison.equivalentRender ? 'ok2' : 'err'">
        两种策略渲染内容{{ comparison.equivalentRender ? '完全一致' : '不一致！' }}；差异层支持模板升级三路合并。
      </p>
    </div>
  </div>
</template>
