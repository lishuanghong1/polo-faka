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
  try { list.value = await api.categories(); }
  finally { loading.value = false; }
}
onMounted(load);

function newOne() { editing.value = { name: '', slug: '', sort: 0, visible: true }; }
async function save() {
  if (editing.value.id) await api.admin.catsUpdate(editing.value.id, editing.value);
  else await api.admin.catsCreate(editing.value);
  ElMessage.success('保存成功');
  editing.value = null;
  load();
}
async function del(c: any) {
  await ElMessageBox.confirm(`确认删除分类「${c.name}」？`, '提示', { type: 'warning' });
  await api.admin.catsRemove(c.id);
  load();
}
</script>

<template>
  <AdminPageHeader title="分类" subtitle="管理商品分类">
    <template #actions>
      <button class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="newOne">
        + 新建分类
      </button>
    </template>
  </AdminPageHeader>

  <DataTable :loading="loading" :is-empty="!list.length">
    <thead>
      <tr>
        <th style="width: 60px">ID</th>
        <th>名称</th>
        <th>Slug</th>
        <th class="!text-right">排序</th>
        <th>显示</th>
        <th class="!text-right" style="width: 120px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="c in list" :key="c.id">
        <td class="text-ink-400 font-mono text-xs">#{{ c.id }}</td>
        <td class="font-medium text-ink-900">{{ c.name }}</td>
        <td class="font-mono text-xs text-ink-500">{{ c.slug }}</td>
        <td class="text-right text-ink-600">{{ c.sort }}</td>
        <td>
          <span v-if="c.visible" class="text-brand-700">✓</span>
          <span v-else class="text-ink-400">—</span>
        </td>
        <td class="text-right whitespace-nowrap">
          <button class="text-ink-500 hover:text-brand-700 mr-3 text-sm" @click="editing = { ...c }">编辑</button>
          <button class="text-ink-500 hover:text-rose-600 text-sm" @click="del(c)">删除</button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <el-dialog
    :model-value="!!editing"
    width="420px"
    :title="editing?.id ? '编辑分类' : '新建分类'"
    @update:model-value="(v: boolean) => !v && (editing = null)"
    @close="editing = null"
  >
    <div v-if="editing" class="space-y-3 text-sm">
      <div>
        <label class="block text-xs text-ink-500 mb-1">名称</label>
        <input v-model="editing.name" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">Slug（英文标识）</label>
        <input v-model="editing.slug" class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">排序（大的在前）</label>
        <input v-model.number="editing.sort" type="number" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
      <label class="flex items-center gap-2 text-ink-700">
        <input type="checkbox" v-model="editing.visible" class="rounded" />
        前台可见
      </label>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="editing = null">取消</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="save">保存</button>
    </template>
  </el-dialog>
</template>
