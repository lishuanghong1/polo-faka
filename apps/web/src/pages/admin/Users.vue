<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import StatusTag from '@/components/admin/StatusTag.vue';

const list = ref<any[]>([]);
const total = ref(0);
const keyword = ref('');
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const a = await api.admin.users({ keyword: keyword.value, page: 1, pageSize: 50 });
    list.value = a.items;
    total.value = a.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function adjust(u: any) {
  const { value } = await ElMessageBox.prompt(
    `调整 ${u.username} 余额（正数为充值，负数为扣除）`,
    '调整余额',
    {
      inputPattern: /^-?\d+(\.\d+)?$/,
      inputErrorMessage: '请输入有效金额',
      inputPlaceholder: '例如 10 或 -5.5',
    },
  );
  await api.admin.userAdjust(u.id, { amount: Number(value), note: '管理员调整' });
  ElMessage.success('已调整');
  load();
}
</script>

<template>
  <AdminPageHeader title="用户" :subtitle="`${total} 个注册用户`" />

  <div class="card p-3 mb-4 flex items-center gap-2 text-sm">
    <input
      v-model="keyword"
      placeholder="搜索账号 / 邮箱 / 昵称"
      class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-64"
      @keydown.enter="load"
    />
    <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm" @click="load">查询</button>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length">
    <thead>
      <tr>
        <th style="width: 60px">ID</th>
        <th>账号</th>
        <th>邮箱</th>
        <th class="!text-right">余额</th>
        <th>角色</th>
        <th>状态</th>
        <th>最后登录</th>
        <th class="!text-right" style="width: 100px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="u in list" :key="u.id">
        <td class="text-ink-400 font-mono text-xs">#{{ u.id }}</td>
        <td>
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-full bg-ink-100 text-ink-700 flex items-center justify-center text-xs font-semibold">
              {{ u.username[0]?.toUpperCase() }}
            </div>
            <div>
              <div class="font-medium text-ink-900">{{ u.username }}</div>
              <div v-if="u.nickname" class="text-xs text-ink-500">{{ u.nickname }}</div>
            </div>
          </div>
        </td>
        <td class="text-ink-600">{{ u.email || '—' }}</td>
        <td class="text-right font-medium text-ink-900">¥{{ u.balance }}</td>
        <td><StatusTag :status="u.role" /></td>
        <td><StatusTag :status="u.status" /></td>
        <td class="text-ink-500 text-xs">{{ u.lastLogin ? new Date(u.lastLogin).toLocaleString() : '从未登录' }}</td>
        <td class="text-right">
          <button class="text-ink-500 hover:text-brand-700 text-sm" @click="adjust(u)">调整余额</button>
        </td>
      </tr>
    </tbody>
  </DataTable>
</template>
