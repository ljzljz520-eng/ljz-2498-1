<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
const p = defineProps({ doc: Object });
const emit = defineEmits(['changed', 'banner']);
const report = ref(null);
const snapshots = ref([]);
const records = ref([]);
const reviewer = ref('法务-张');
const comment = ref('');
const exporting = ref(false);

async function load() {
  report.value = await api.get(`/api/docs/${p.doc.id}/validate`);
  snapshots.value = await api.get(`/api/docs/${p.doc.id}/snapshots`);
  records.value = await api.get(`/api/docs/${p.doc.id}/records`);
}
onMounted(load);

async function submit(action) {
  if (!report.value.ok) return emit('banner', 'err', '存在阻断项，无法生成正式审阅快照；请先在「变量映射」页处理');
  await api.post(`/api/docs/${p.doc.id}/snapshots`, { reviewer: reviewer.value, action, comment: comment.value });
  emit('banner', 'ok', `已生成不可变审阅快照（${action}）`);
  comment.value = ''; await load();
}
async function doExport(format) {
  const snap = snapshots.value[0];
  if (!snap) return emit('banner', 'err', '没有审阅快照');
  exporting.value = true;
  try {
    const r = await fetch(`/api/docs/${p.doc.id}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId: snap.id, format, actor: reviewer.value }),
    });
    if (!r.ok) {
      const e = await r.json();
      if (r.status === 409) emit('banner', 'err', '导出已阻止：' + e.error + '——请重新审阅');
      else if (r.status === 422) emit('banner', 'err', '导出被阻断：' + e.error);
      else emit('banner', 'err', e.error);
    } else if (format === 'pdf') {
      const blob = await r.blob();
      if (blob.type.includes('json')) { const j = await blob.json(); emit('banner', 'warn', `PDF 引擎不可用（${j.reason}）；已返回与打印一致的 HTML 快照`); window.open(`/api/snapshots/${snap.id}/print`, '_blank'); }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'contract.pdf'; a.click(); emit('banner', 'ok', 'PDF 由审阅快照渲染，与打印完全一致'); }
    } else {
      window.open(`/api/snapshots/${snap.id}/print`, '_blank');
    }
    await load();
  } finally { exporting.value = false; }
}
function openPrint(sid) { window.open(`/api/snapshots/${sid}/print`, '_blank'); }
</script>

<template>
  <div>
    <div class="card">
      <h3 style="margin:0 0 6px">导出前校验</h3>
      <div :class="['stripe', report?.ok ? 'ok' : 'err']">{{ report?.ok ? '通过' : '未通过（禁止正式导出）' }}</div>
      <div v-for="(e,i) in report?.errors||[]" :key="i" class="stripe err">✗ {{ e.message }}</div>
      <div v-for="(w,i) in report?.warnings||[]" :key="i" class="stripe warn">⚠ {{ w.message }}</div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">生成审阅快照</h3>
      <div class="row">
        <input v-model="reviewer" placeholder="审阅人" />
        <input v-model="comment" placeholder="审阅意见" />
      </div>
      <div class="row">
        <button @click="submit('submit')">提交审阅</button>
        <button class="secondary" @click="submit('approve')">审阅通过</button>
        <button class="danger" @click="submit('reject')">退回</button>
      </div>
      <p class="muted">快照固化当时全部条款（编号、引用、变量值、落款）。此后任何修改（包括导出期间改落款）都会使快照失效并阻止导出。</p>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">审阅快照（打印 / PDF 共用同一份）</h3>
      <div v-for="s in snapshots" :key="s.id" class="block-item">
        <div class="meta">
          <span class="refchip">{{ s.id }}</span>
          <span>{{ s.reviewer }}</span>
          <span>{{ new Date(s.at).toLocaleString() }}</span>
          <span>hash {{ s.contentHash }}</span>
          <button class="secondary narrow" @click="openPrint(s.id)">打印视图</button>
        </div>
      </div>
      <div class="row" style="margin-top:8px">
        <button :disabled="exporting || !snapshots.length" @click="doExport('pdf')">导出 PDF（快照）</button>
        <button class="secondary" :disabled="!snapshots.length" @click="doExport('html')">打印 HTML（同快照）</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">审阅记录</h3>
      <table class="table-mini">
        <tr><th>时间</th><th>动作</th><th>审阅人</th><th>意见/元数据</th></tr>
        <tr v-for="r in [...records].reverse()" :key="r.id">
          <td>{{ new Date(r.createdAt).toLocaleString() }}</td>
          <td>{{ r.action }}</td><td>{{ r.actor }}</td>
          <td>{{ r.comment }} <span class="err" v-if="r.meta?.blocked">（已阻止）</span></td>
        </tr>
      </table>
    </div>
  </div>
</template>
