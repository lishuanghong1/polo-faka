<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';

const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const filterStatus = ref('');
const keyword = ref('');
const page = ref(1);
const pageSize = ref(50);
const refreshingId = ref<number | null>(null);

async function load() {
  loading.value = true;
  try {
    const r = await api.admin.recycleList({
      status: filterStatus.value || undefined,
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    list.value = r.items;
    total.value = r.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch([filterStatus, page], load);

const stats = computed(() => {
  const pending = list.value.filter((i) => i.status === 'PENDING').length;
  const success = list.value.filter((i) => i.status === 'SUCCESS').length;
  const unknown = list.value.filter((i) => i.status === 'UNKNOWN').length;
  return { pending, success, unknown };
});

function statusColor(s: string) {
  if (s === 'SUCCESS') return 'bg-emerald-100 text-emerald-700';
  if (s === 'PENDING') return 'bg-amber-100 text-amber-700';
  return 'bg-ink-100 text-ink-600';
}
function statusLabel(s: string) {
  if (s === 'SUCCESS') return '成功';
  if (s === 'PENDING') return '回收中';
  return '未知';
}

async function refresh(row: any) {
  refreshingId.value = row.id;
  try {
    await api.admin.recycleRefresh(row.id);
    ElMessage.success('已重新核验');
    await load();
  } catch {
    // 全局拦截器处理
  } finally {
    refreshingId.value = null;
  }
}

async function del(row: any) {
  await ElMessageBox.confirm(`删除 ${row.email} 的回收记录？`, '删除', { type: 'warning' });
  await api.admin.recycleRemove(row.id);
  ElMessage.success('已删除');
  load();
}
</script>

<template>
  <AdminPageHeader title="回收" subtitle="用户提交的回收（退款）申请，按账号订阅判断：free=成功 / pro=回收中">
    <template #actions>
      <select v-model="filterStatus" class="px-3 py-1.5 rounded-lg border border-ink-200 text-sm bg-white">
        <option value="">全部状态</option>
        <option value="PENDING">回收中</option>
        <option value="SUCCESS">成功</option>
        <option value="UNKNOWN">未知</option>
      </select>
      <input
        v-model="keyword"
        placeholder="按邮箱搜索"
        class="px-3 py-1.5 rounded-lg border border-ink-200 text-sm w-44"
        @keyup.enter="page = 1; load()"
      />
      <button class="px-3 py-1.5 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="page = 1; load()">
        刷新
      </button>
    </template>
  </AdminPageHeader>

  <div class="card p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-y-3 sm:divide-x sm:divide-ink-100">
    <div class="px-3 sm:px-4">
      <div class="text-xs text-ink-500">总数（当前页）</div>
      <div class="mt-1 text-lg font-medium text-ink-900">{{ list.length }} / {{ total }}</div>
    </div>
    <div class="px-3 sm:px-4">
      <div class="text-xs text-ink-500">回收中</div>
      <div class="mt-1 text-lg font-medium text-amber-700">{{ stats.pending }}</div>
    </div>
    <div class="px-3 sm:px-4">
      <div class="text-xs text-ink-500">成功</div>
      <div class="mt-1 text-lg font-medium text-emerald-700">{{ stats.success }}</div>
    </div>
    <div class="px-3 sm:px-4">
      <div class="text-xs text-ink-500">未知</div>
      <div class="mt-1 text-lg font-medium text-ink-600">{{ stats.unknown }}</div>
    </div>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" empty="还没有回收申请" min-width="900px">
    <thead>
      <tr>
        <th style="width: 60px">ID</th>
        <th>账号邮箱</th>
        <th>关联订单</th>
        <th>账单号</th>
        <th>订阅</th>
        <th>状态</th>
        <th>最近核验</th>
        <th>提交时间</th>
        <th class="!text-right" style="width: 160px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.id">
        <td class="text-ink-400 font-mono text-xs">#{{ row.id }}</td>
        <td class="text-sm text-ink-800">{{ row.email }}</td>
        <td class="font-mono text-xs">
          <router-link
            v-if="row.orderNo"
            :to="`/admin/orders?orderNo=${row.orderNo}`"
            class="text-brand-600 hover:underline"
          >{{ row.orderNo }}</router-link>
          <span v-else class="text-ink-400">—</span>
        </td>
        <td class="font-mono text-xs text-ink-600">{{ row.invoiceNumber }}</td>
        <td class="text-xs text-ink-600">{{ row.plan || '—' }}</td>
        <td>
          <span class="px-2 py-0.5 rounded text-xs font-medium" :class="statusColor(row.status)">
            {{ statusLabel(row.status) }}
          </span>
        </td>
        <td class="text-ink-500 text-xs">{{ row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString() : '—' }}</td>
        <td class="text-ink-500 text-xs">{{ new Date(row.createdAt).toLocaleString() }}</td>
        <td class="text-right whitespace-nowrap">
          <button
            class="text-sky-600 hover:text-sky-700 mr-3 text-sm disabled:opacity-40"
            :disabled="refreshingId === row.id"
            @click="refresh(row)"
          >
            {{ refreshingId === row.id ? '核验中…' : '重新核验' }}
          </button>
          <button class="text-ink-500 hover:text-rose-600 text-sm" @click="del(row)">删除</button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <div v-if="total > pageSize" class="mt-4 flex justify-end gap-2">
    <button class="px-3 py-1.5 rounded border border-ink-200 text-sm" :disabled="page <= 1" @click="page--">上一页</button>
    <span class="self-center text-sm text-ink-600">第 {{ page }} 页 / 共 {{ Math.ceil(total / pageSize) }} 页</span>
    <button class="px-3 py-1.5 rounded border border-ink-200 text-sm" :disabled="page * pageSize >= total" @click="page++">下一页</button>
  </div>
</template>
