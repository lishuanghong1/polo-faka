<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';

const list = ref<any[]>([]);
const editing = ref<any | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try { list.value = await api.admin.annsList(); }
  finally { loading.value = false; }
}
onMounted(load);

function newOne() {
  editing.value = { title: '', content: '', popup: false, popupMode: 'NONE', active: true, sort: 0 };
}
async function save() {
  if (editing.value.id) await api.admin.annsUpdate(editing.value.id, editing.value);
  else await api.admin.annsCreate(editing.value);
  ElMessage.success('已保存');
  editing.value = null;
  load();
}
async function del(a: any) {
  await ElMessageBox.confirm(`删除「${a.title}」？`, '提示', { type: 'warning' });
  await api.admin.annsRemove(a.id);
  load();
}

const modeLabel: Record<string, string> = {
  NONE: '不弹窗',
  ONCE: '弹一次',
  ALWAYS: '每次弹',
};
</script>

<template>
  <AdminPageHeader title="公告" subtitle="管理首页通知与弹窗">
    <template #actions>
      <button class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="newOne">
        + 新建公告
      </button>
    </template>
  </AdminPageHeader>

  <DataTable :loading="loading" :is-empty="!list.length" min-width="920px">
    <thead>
      <tr>
        <th style="width: 60px">ID</th>
        <th>标题</th>
        <th>弹窗</th>
        <th>模式</th>
        <th>激活</th>
        <th class="!text-right">排序</th>
        <th class="!text-right" style="width: 120px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="a in list" :key="a.id">
        <td class="text-ink-400 font-mono text-xs">#{{ a.id }}</td>
        <td>
          <div class="font-medium text-ink-900">{{ a.title }}</div>
          <div v-if="a.content" class="text-xs text-ink-500 mt-0.5 truncate max-w-md">
            {{ a.content.slice(0, 80) }}
          </div>
        </td>
        <td>
          <span v-if="a.popup" class="text-brand-700">✓</span>
          <span v-else class="text-ink-400">—</span>
        </td>
        <td class="text-ink-600">{{ modeLabel[a.popupMode] || a.popupMode }}</td>
        <td>
          <span v-if="a.active" class="text-brand-700">✓</span>
          <span v-else class="text-ink-400">—</span>
        </td>
        <td class="text-right text-ink-600">{{ a.sort }}</td>
        <td class="text-right whitespace-nowrap">
          <button class="text-ink-500 hover:text-brand-700 mr-3 text-sm" @click="editing = { ...a }">编辑</button>
          <button class="text-ink-500 hover:text-rose-600 text-sm" @click="del(a)">删除</button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <el-dialog
    :model-value="!!editing"
    width="640px"
    :title="editing?.id ? '编辑公告' : '新建公告'"
    @update:model-value="(v: boolean) => !v && (editing = null)"
    @close="editing = null"
  >
    <div v-if="editing" class="space-y-3 text-sm">
      <div>
        <label class="block text-xs text-ink-500 mb-1">标题</label>
        <input v-model="editing.title" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">内容（支持 Markdown）</label>
        <textarea v-model="editing.content" rows="8" class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs"></textarea>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="flex items-center gap-2 text-ink-700">
          <input type="checkbox" v-model="editing.popup" /> 弹窗显示
        </label>
        <select v-model="editing.popupMode" class="px-3 py-2 border border-ink-200 rounded-lg bg-white">
          <option value="NONE">不弹窗</option>
          <option value="ONCE">仅弹一次</option>
          <option value="ALWAYS">每次都弹</option>
        </select>
        <label class="flex items-center gap-2 text-ink-700">
          <input type="checkbox" v-model="editing.active" /> 激活
        </label>
        <input v-model.number="editing.sort" type="number" placeholder="排序" class="px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="editing = null">取消</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="save">保存</button>
    </template>
  </el-dialog>
</template>
