<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';

const labelMap: Record<string, string> = {
  LOGIN_OK: '登录成功',
  LOGIN_FAIL: '登录失败',
  REGISTER: '注册',
  POOL_TOKEN_REVEAL: '查看号池 Token',
  POOL_ACCOUNT_CREATE: '新建号池账号',
  POOL_ACCOUNT_UPDATE: '编辑号池账号',
  POOL_ACCOUNT_DELETE: '删除号池账号',
  ORDER_MARK_PAID: '订单标记已支付',
  ORDER_REDELIVER: '订单补发',
  ORDER_MANUAL_DELIVER: '手动发货',
  ORDER_REFUND: '订单退款',
  ORDER_CANCEL: '订单取消',
  CARD_KEY_DELETE: '删除卡密',
  CARD_KEY_BULK_REMOVE: '批量删除卡密',
  CARD_KEY_PURGE: '清理卡密',
  CARD_KEY_BULK_IMPORT: '导入卡密',
  USER_UPDATE: '修改用户',
  BALANCE_ADJUST: '调整余额',
  SETTINGS_UPDATE: '修改站点设置',
  PRODUCT_DELETE: '删除商品',
};

// 高亮危险级别
const dangerActions = new Set([
  'POOL_TOKEN_REVEAL',
  'POOL_ACCOUNT_DELETE',
  'ORDER_REFUND',
  'BALANCE_ADJUST',
  'CARD_KEY_BULK_REMOVE',
  'CARD_KEY_PURGE',
  'LOGIN_FAIL',
  'PRODUCT_DELETE',
]);

const list = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const actions = ref<string[]>([]);
const filter = ref<{ action?: string; actor?: string; target?: string; since?: string }>({});

async function load() {
  loading.value = true;
  try {
    const r = await api.admin.auditList({ ...filter.value, page: page.value, pageSize: 50 });
    list.value = r.items;
    total.value = r.total;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  actions.value = await api.admin.auditActions();
  load();
});

function fmtTime(t: string) {
  const d = new Date(t);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return d.toLocaleString();
}

function actionLabel(a: string) {
  return labelMap[a] || a;
}

function fmtDetail(d: any) {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / 50)));

function quickSince(days: number) {
  filter.value.since = new Date(Date.now() - days * 86400_000).toISOString();
  page.value = 1;
  load();
}

function reset() {
  filter.value = {};
  page.value = 1;
  load();
}
</script>

<template>
  <AdminPageHeader title="审计日志" :subtitle="`共 ${total} 条记录`">
    <template #actions>
      <button class="px-3 py-1.5 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="quickSince(1)">近 1 天</button>
      <button class="px-3 py-1.5 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="quickSince(7)">近 7 天</button>
      <button class="px-3 py-1.5 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="reset">重置</button>
    </template>
  </AdminPageHeader>

  <div class="card p-3 mb-4 flex items-center gap-2 text-sm flex-wrap">
    <select v-model="filter.action" class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm bg-white w-full sm:w-auto">
      <option :value="undefined">所有动作</option>
      <option v-for="a in actions" :key="a" :value="a">{{ actionLabel(a) }} ({{ a }})</option>
    </select>
    <input
      v-model="filter.actor"
      placeholder="操作者用户名"
      class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm flex-1 min-w-32 sm:flex-none sm:w-40"
      @keydown.enter="load"
    />
    <input
      v-model="filter.target"
      placeholder="目标资源（如 order:Pxxx）"
      class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm flex-1 min-w-40 sm:flex-none sm:w-60"
      @keydown.enter="load"
    />
    <input
      v-model="filter.since"
      type="datetime-local"
      class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm flex-1 sm:flex-none"
    />
    <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm shrink-0" @click="load">查询</button>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" min-width="1120px">
    <thead>
      <tr>
        <th style="width: 130px">时间</th>
        <th style="width: 110px">操作</th>
        <th style="width: 110px">操作者</th>
        <th style="width: 160px">目标</th>
        <th>详情</th>
        <th style="width: 130px">IP</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.id">
        <td class="text-xs text-ink-500 whitespace-nowrap" :title="new Date(row.createdAt).toLocaleString()">
          {{ fmtTime(row.createdAt) }}
        </td>
        <td>
          <span
            class="text-[11px] px-2 py-0.5 rounded border whitespace-nowrap"
            :class="dangerActions.has(row.action)
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-ink-50 text-ink-700 border-ink-200'"
          >
            {{ actionLabel(row.action) }}
          </span>
        </td>
        <td class="text-sm text-ink-800">{{ row.actor || '—' }}</td>
        <td class="text-xs font-mono text-ink-600">{{ row.target || '—' }}</td>
        <td class="text-xs text-ink-500 font-mono break-all max-w-md">{{ fmtDetail(row.detail) }}</td>
        <td class="text-xs font-mono text-ink-500">{{ row.ip || '—' }}</td>
      </tr>
    </tbody>
  </DataTable>

  <div v-if="totalPages > 1" class="mt-3 flex items-center justify-center gap-2 text-sm">
    <button class="px-3 py-1 rounded border border-ink-200 disabled:opacity-30" :disabled="page <= 1" @click="page--; load()">上一页</button>
    <span class="text-ink-500">{{ page }} / {{ totalPages }}</span>
    <button class="px-3 py-1 rounded border border-ink-200 disabled:opacity-30" :disabled="page >= totalPages" @click="page++; load()">下一页</button>
  </div>
</template>
