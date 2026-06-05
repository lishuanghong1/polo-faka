<script setup lang="ts">
import { onMounted, ref } from 'vue';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';

const loading = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const filter = ref({ userId: '', type: '' });

const typeOptions = [
  { value: '', label: '全部类型' },
  { value: 'ORDER_REWARD', label: '消费返积分' },
  { value: 'INVITE_REWARD', label: '邀请返积分' },
  { value: 'ORDER_DEDUCT', label: '积分支付' },
  { value: 'ORDER_REFUND', label: '积分退款' },
  { value: 'ADMIN_ADJUST', label: '管理员调整' },
];

const typeLabel: Record<string, string> = {
  ORDER_REWARD: '消费返积分',
  INVITE_REWARD: '邀请返积分',
  ORDER_DEDUCT: '积分支付',
  ORDER_REFUND: '积分退款',
  ADMIN_ADJUST: '管理员调整',
};

async function load() {
  loading.value = true;
  try {
    const r = await api.admin.pointLogs({
      page: 1,
      pageSize: 100,
      userId: filter.value.userId || undefined,
      type: filter.value.type || undefined,
    });
    list.value = r.items || [];
    total.value = r.total || 0;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminPageHeader title="积分流水" :subtitle="`${total} 条记录`" />

  <div class="card p-3 mb-4 flex items-center gap-2 text-sm flex-wrap">
    <input
      v-model="filter.userId"
      placeholder="用户 ID"
      class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-full sm:w-32"
      @keydown.enter="load"
    />
    <select
      v-model="filter.type"
      class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-full sm:w-40"
    >
      <option v-for="o in typeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm" @click="load">查询</button>
  </div>

  <div class="overflow-x-auto">
    <DataTable :loading="loading" :is-empty="!list.length">
      <thead>
        <tr>
          <th>ID</th>
          <th>用户</th>
          <th>类型</th>
          <th class="!text-right">变动</th>
          <th class="!text-right">余额</th>
          <th>关联订单</th>
          <th>备注</th>
          <th>时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in list" :key="l.id">
          <td class="font-mono text-xs text-ink-400">#{{ l.id }}</td>
          <td>
            <div class="font-medium text-ink-900">#{{ l.userId }} {{ l.user?.nickname || l.user?.username }}</div>
            <div class="text-xs text-ink-400">{{ l.user?.username }}</div>
          </td>
          <td>{{ typeLabel[l.type] || l.type }}</td>
          <td class="text-right font-mono" :class="l.amount >= 0 ? 'text-amber-700' : 'text-rose-600'">
            {{ l.amount >= 0 ? '+' : '' }}{{ l.amount }}
          </td>
          <td class="text-right font-mono">{{ l.balance }}</td>
          <td class="font-mono text-xs text-ink-500">{{ l.refOrder || '—' }}</td>
          <td class="text-xs text-ink-500 max-w-[240px] truncate">{{ l.note || '—' }}</td>
          <td class="text-xs text-ink-500">{{ new Date(l.createdAt).toLocaleString() }}</td>
        </tr>
      </tbody>
    </DataTable>
  </div>
</template>
