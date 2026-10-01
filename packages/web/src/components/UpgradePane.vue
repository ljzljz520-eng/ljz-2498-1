<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
const p = defineProps({ doc: Object, template: Object });
const emit = defineEmits(['changed', 'banner']);
const versions = ref([]);
const target = ref('');
const preview = ref(null);
const decisions = ref({});
const varValues = ref({});

onMounted(async () => {
  versions.value = await api.get(`/api/templates/${p.doc.templateId}/versions`);
  target.value = versions.value.find(v => v.id !== p.doc.baselineVersionId)?.id || '';
});

async function loadPreview() {
  if (!target.value) return;
  const r = await api.get(`/api/docs/${p.doc.id}/upgrade/${target.value}`);
  preview.value = r.preview; decisions.value = {};
}
async function adopt() {
  try {
    const res = await api.post(`/api/docs/${p.doc.id}/upgrade/${target.value}`,
      { decisions: { ...decisions.value, variables: varValues.value } });
    const full = await api.get(`/api/docs/${p.doc.id}`);
    emit('changed', { doc: full.doc, version: full.version });
    emit('banner', 'ok', `已升级到 ${target.value}（人工采纳完成）${res.unresolvedVariables?.length ? '，仍有未映射变量' : ''}`);
    preview.value = null;
  } catch (e) {
    emit('banner', 'err', `采纳失败：${e.message}（需对每个冲突做人工选择）`);
  }
}
const curVersion = () => versions.value.find(v => v.id === p.doc.baselineVersionId)?.version;
</script>

<template>
  <div>
    <div class="card">
      <h3 style="margin:0 0 6px">模板升级（基线 {{ curVersion() }}）</h3>
      <div class="row">
        <select v-model="target">
          <option v-for="v in versions.filter(x=>x.id!==doc.baselineVersionId)" :key="v.id" :value="v.id">升级到 {{ v.version }}</option>
        </select>
        <button @click="loadPreview">预览三路合并冲突</button>
      </div>
      <p class="muted">升级只改变基线指针并重放差异层；上游与本地对同一字段的修改构成冲突，必须人工选择，不静默覆盖。</p>
    </div>

    <template v-if="preview">
      <div class="card">
        <h3 style="margin:0 0 6px">自动合并</h3>
        <div class="muted">上游新增块：{{ preview.changes.added.length }}；上游删除块：{{ preview.changes.removed.length }}；自动采用上游修改：{{ preview.autoHead.length }}</div>
      </div>

      <div class="card" v-for="(c,i) in preview.conflicts" :key="i">
        <div class="stripe err">冲突 #{{ i }}：{{ c.type }}
          <span v-if="c.blockId" class="refchip">{{ c.blockId }}</span>
          <span v-if="c.fields">字段 {{ c.fields.join(', ') }}</span>
        </div>
        <template v-if="c.type==='edit-edit'">
          <label class="fld"><input type="radio" :name="'c'+i" value="local" v-model="decisions[i]"/> 保留本地：{{ c.local | json }}</label>
          <label class="fld"><input type="radio" :name="'c'+i" value="head" v-model="decisions[i]"/> 采用上游：{{ c.head | json }}</label>
        </template>
        <template v-else-if="c.type==='delete-edit'">
          <label class="fld"><input type="radio" :name="'c'+i" value="local" v-model="decisions[i]"/> 本地仍需要，保留</label>
          <label class="fld"><input type="radio" :name="'c'+i" value="head" v-model="decisions[i]"/> 跟随上游删除</label>
        </template>
        <template v-else>
          <label class="fld"><input type="radio" :name="'c'+i" value="local" v-model="decisions[i]"/> 保留本地排序</label>
          <label class="fld"><input type="radio" :name="'c'+i" value="head" v-model="decisions[i]"/> 采用上游排序</label>
        </template>
      </div>

      <div class="card" v-if="preview.variables.unmapped.length">
        <h3 style="margin:0 0 6px">新增/未映射变量</h3>
        <div v-for="u in preview.variables.unmapped" :key="u.name" class="block-item">
          <div class="meta">{{ u.label }} <span class="refchip">{{ u.name }}</span><span class="pill err" v-if="u.required">必填</span></div>
          <input v-model="varValues[u.name]" placeholder="提供值后再完成升级" />
        </div>
      </div>

      <button @click="adopt" :disabled="preview.conflicts.some((c,i)=>!decisions[i])">
        {{ preview.conflicts.some((c,i)=>!decisions[i]) ? '请先解决全部冲突' : '人工采纳并完成升级' }}
      </button>
    </template>
  </div>
</template>
<script>
export default { filters: { json: (x) => JSON.stringify(x) } };
</script>
