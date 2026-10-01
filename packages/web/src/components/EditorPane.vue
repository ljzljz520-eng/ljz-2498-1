<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
const p = defineProps({ doc: Object });
const emit = defineEmits(['changed', 'banner']);
const blocks = ref([]);
const selectedId = ref(null);
const editTitle = ref(''); const editBody = ref('');
const editHeader = ref(''); const editFooter = ref(''); const editOrient = ref('portrait');
const vars = ref([]);
const hash = ref('');

async function load() {
  const m = await api.get(`/api/docs/${p.doc.id}/materialized`);
  blocks.value = m.blocks; vars.value = m.variables; hash.value = m.contentHash;
  if (!selectedId.value && m.blocks.length) selectedId.value = m.blocks[0].id;
  syncEdit();
}
function syncEdit() {
  const b = blocks.value.find(x => x.id === selectedId.value);
  editTitle.value = b?.title || '';
  editBody.value = b?.body || '';
  editHeader.value = b?.page?.header || '';
  editFooter.value = b?.page?.footer || '';
  editOrient.value = b?.page?.orientation || 'portrait';
}
onMounted(load);
defineExpose({ load });

const selected = computed(() => blocks.value.find(b => b.id === selectedId.value));
const CN=['零','一','二','三','四','五','六','七','八','九','十'];
const numMap = computed(() => {
  const byId = new Map(blocks.value.map(b=>[b.id,b]));
  const kids = new Map();
  for (const b of blocks.value) { const pid = byId.has(b.parentId)?b.parentId:null; if(!kids.has(pid))kids.set(pid,[]); kids.get(pid).push(b); }
  const m = new Map(); let seq=0, annex=0;
  const walk=(pid,depth,pref)=>{ let ci=0; for(const b of kids.get(pid)||[]){ let num;
    if(b.kind==='annex'){annex++;num='附件'+String.fromCharCode(64+annex);} else if(depth===0){seq++;num='第'+CN[seq]+'条';} else {ci++;num=pref?pref+'.'+ci:''+ci;}
    m.set(b.id,num); walk(b.id,depth+1,depth===0&&b.kind!=='annex'?''+seq:num); } };
  walk(null,0,''); return m;
});
function numberingOf(b){ return numMap.value.get(b.id) || ''; }
const VAR_HINT = '{{ 变量名 }}'; const REF_HINT = '[[# 条款id ]]';

async function saveEdit() {
  const page = (editHeader.value || editFooter.value || editOrient.value === 'landscape')
    ? { orientation: editOrient.value, header: editHeader.value || null, footer: editFooter.value || null }
    : null;
  await api.patch(`/api/docs/${p.doc.id}/blocks/${selectedId.value}`, { title: editTitle.value, body: editBody.value, page });
  emit('banner', 'ok', '已保存（差异层；编号自动重算，引用仍指向稳定身份）');
  await load(); emit('changed');
}
async function addClause(kind) {
  const b = await api.post(`/api/docs/${p.doc.id}/blocks`, { kind, title: kind === 'annex' ? '新附件' : '新条款', body: '', afterId: null });
  selectedId.value = b.id; await load(); emit('changed');
}
async function move(id, dir) {
  const i = blocks.value.findIndex(b => b.id === id);
  const target = blocks.value[i + dir];
  if (!target) return;
  const after = dir > 0 ? target.id : (blocks.value[i - 2]?.id ?? null);
  await api.post(`/api/docs/${p.doc.id}/move`, { id, parentId: target.parentId, afterId: after });
  await load(); emit('changed');
}
async function del(id) {
  if (!confirm('删除该条款（差异层标记删除，基线保留）？')) return;
  await api.del(`/api/docs/${p.doc.id}/blocks/${id}`);
  selectedId.value = null; await load(); emit('changed');
}
async function splitHere() {
  const parts = editBody.value.split(/\n---\n/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return emit('banner', 'warn', '在要拆分的位置插入一行 --- 后再点击验收拆分');
  // operate on insert if new block; for baseline blocks use a dedicated endpoint emulation:
  // edit original to first part, then add new clauses after it with remaining parts
  const orig = selected.value;
  await api.patch(`/api/docs/${p.doc.id}/blocks/${orig.id}`, { body: parts[0] });
  let after = orig.id;
  for (let i = 1; i < parts.length; i++) {
    const nb = await api.post(`/api/docs/${p.doc.id}/blocks`, { title: `${orig.title}（续${i}）`, body: parts[i], parentId: orig.parentId });
    await api.post(`/api/docs/${p.doc.id}/move`, { id: nb.id, parentId: orig.parentId, afterId: after });
    after = nb.id;
  }
  emit('banner', 'ok', '拆分完成：原条款身份保留，引用不跳转到续条');
  await load(); emit('changed');
}
</script>

<template>
  <div>
    <div class="card">
      <div class="row">
        <button @click="addClause('clause')">＋ 插入条款</button>
        <button class="secondary" @click="addClause('annex')">＋ 插入横向附件</button>
        <span class="muted narrow">变量 <code>{{VAR_HINT}}</code> 引用 <code>{{REF_HINT}}</code></span>
      </div>
    </div>

    <div class="card">
      <div v-for="(b, i) in blocks" :key="b.id" :class="['block-item', { selected: b.id === selectedId, annex: b.kind==='annex' }]">
        <div class="meta">
          <span class="bnum">{{ numberingOf(b, i) }}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" @click="selectedId=b.id; syncEdit()">
            {{ b.title || '(无标题)' }}
          </span>
          <span v-if="b.page?.orientation==='landscape'" class="pill warn">横向</span>
          <button class="secondary narrow" style="padding:2px 7px" @click="move(b.id,-1)">↑</button>
          <button class="secondary narrow" style="padding:2px 7px" @click="move(b.id,1)">↓</button>
          <button class="danger narrow" style="padding:2px 7px" @click="del(b.id)">删</button>
        </div>
      </div>
    </div>

    <div class="card" v-if="selected">
      <div class="muted">正在编辑 <span class="refchip">{{ selected.id }}</span>（稳定身份，移动/重排不变）</div>
      <label class="fld">标题</label>
      <input v-model="editTitle" />
      <label class="fld">正文（段落空行分隔；表格用 <code>||</code> 表头行与 <code>|</code> 数据行；拆分行写 <code>---</code>）</label>
      <textarea v-model="editBody" rows="9"></textarea>
      <div class="row" style="margin-top:6px">
        <div>
          <label class="fld">页面方向（节作用域，仅含本块及其子树）</label>
          <select v-model="editOrient"><option value="portrait">纵向</option><option value="landscape">横向（附件）</option></select>
        </div>
        <div><label class="fld">页眉</label><input v-model="editHeader" placeholder="留空不设" /></div>
        <div><label class="fld">页脚</label><input v-model="editFooter" /></div>
      </div>
      <div class="row" style="margin-top:8px">
        <button @click="saveEdit">保存差异</button>
        <button class="secondary" @click="splitHere">验收拆分（按 --- 拆分，保留原身份）</button>
      </div>
    </div>
  </div>
</template>
