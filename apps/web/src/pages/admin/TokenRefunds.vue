<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import { formatDateTime, copyText } from '@/utils/format';
import { membershipLabel } from '@/utils/cursor-membership';

const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const filterStatus = ref('');
const keyword = ref('');
const page = ref(1);
const pageSize = 50;
const actionKey = ref('');
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  loading.value = true;
  try {
    const r: any = await api.admin.tokenRefundList({
      status: filterStatus.value || undefined,
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize,
    });
    list.value = r.items;
    total.value = r.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch([filterStatus, page], load);
function search() { page.value = 1; load(); }

const statusMeta: Record<string, { text: string; cls: string }> = {
  NEED_PAY: { text: '待支付', cls: 'bg-amber-100 text-amber-700' },
  PROCESSING: { text: '处理中', cls: 'bg-sky-100 text-sky-700' },
  DONE: { text: '已退款', cls: 'bg-emerald-100 text-emerald-700' },
  FAILED: { text: '失败', cls: 'bg-rose-100 text-rose-700' },
};
const payMeta: Record<string, { text: string; cls: string }> = {
  NONE: { text: '无需', cls: 'text-ink-400' },
  UNPAID: { text: '待支付', cls: 'text-amber-600' },
  PAID: { text: '已支付', cls: 'text-emerald-600' },
};

async function copyMask(row: any) {
  const ok = await copyText(row.tokenMask);
  if (ok) ElMessage.success('已复制');
}

async function del(row: any) {
  await ElMessageBox.confirm('删除这条退款记录？（仅删记录，不影响已办理的退款）', '删除', { type: 'warning' });
  try {
    await api.admin.tokenRefundRemove(row.id);
    ElMessage.success('已删除');
    load();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '删除失败');
  }
}

async function recheck(row: any) {
  actionKey.value = `check:${row.id}`;
  try {
    const r = await api.admin.tokenRefundRecheck(row.id);
    if (r.ok) ElMessage.success(r.message);
    else ElMessage.warning(r.message);
    await load();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '复查订阅失败');
    await load();
  } finally {
    actionKey.value = '';
  }
}

async function retry(row: any) {
  await ElMessageBox.confirm('重新执行这条退款任务？系统仍会以订阅变为 Free 作为成功条件。', '重试退款', {
    type: 'warning',
  });
  actionKey.value = `retry:${row.id}`;
  try {
    const r = await api.admin.tokenRefundRetry(row.id);
    ElMessage.success(r.message);
    await load();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '重试失败');
    await load();
  } finally {
    actionKey.value = '';
  }
}
</script>

<template>
  <AdminPageHeader title="Token 退款记录" subtitle="前台「账号退款 · Token 退款」提交的记录，退款在后台自动办理，这里查看结果">
    <template #actions>
      <select v-model="filterStatus" class="admin-select" @change="search">
        <option value="">全部状态</option>
        <option value="PROCESSING">处理中</option>
        <option value="DONE">已退款</option>
        <option value="FAILED">失败</option>
      </select>
      <input v-model="keyword" placeholder="搜索邮箱 / token" class="admin-input w-52" @keyup.enter="search" />
      <button class="px-3 h-9 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="search">查询</button>
      <button class="px-3 h-9 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="load">刷新</button>
    </template>
  </AdminPageHeader>

  <DataTable :loading="loading" :is-empty="!list.length" empty="暂无 Token 退款记录" min-width="1240px">
    <thead>
      <tr>
        <th style="width:60px">ID</th>
        <th>账号邮箱</th>
        <th>Token</th>
        <th>订阅</th>
        <th>状态</th>
        <th>手续费</th>
        <th>退款金额</th>
        <th>会员变化</th>
        <th>提交时间</th>
        <th class="!text-right" style="width:220px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.id">
        <td class="text-ink-400 font-mono text-xs">#{{ row.id }}</td>
        <td class="text-sm text-ink-800">{{ row.email || '—' }}</td>
        <td class="text-xs font-mono text-ink-500">
          <button class="hover:text-brand-600" :title="'点击复制：' + row.tokenMask" @click="copyMask(row)">{{ row.tokenMask }}</button>
        </td>
        <td>
          <span class="px-2 py-0.5 rounded text-xs font-medium" :class="membershipLabel(row.membershipType).cls">{{ membershipLabel(row.membershipType).text }}</span>
        </td>
        <td>
          <span class="px-2 py-0.5 rounded text-xs font-medium" :class="(statusMeta[row.status] || {}).cls">
            {{ (statusMeta[row.status] || { text: row.status }).text }}
          </span>
          <div v-if="row.refundError" class="text-[10px] text-rose-500 mt-0.5 max-w-[220px] truncate" :title="row.refundError">{{ row.refundError }}</div>
        </td>
        <td class="text-xs">
          <template v-if="row.feeAmount">
            <span class="text-ink-600">¥{{ Number(row.feeAmount).toFixed(0) }}</span>
            <span class="ml-1" :class="(payMeta[row.payStatus] || {}).cls">{{ (payMeta[row.payStatus] || { text: row.payStatus }).text }}</span>
          </template>
          <span v-else class="text-ink-300">—</span>
        </td>
        <td class="text-xs text-ink-600">{{ row.refundAmount ? '$' + Number(row.refundAmount).toFixed(2) : '—' }}</td>
        <td class="text-xs text-ink-500">
          <span v-if="row.prevMembership || row.finalMembership">
            {{ membershipLabel(row.prevMembership).text }} → {{ membershipLabel(row.finalMembership).text }}
          </span>
          <span v-else>—</span>
        </td>
        <td class="text-xs text-ink-500">{{ formatDateTime(row.createdAt) }}</td>
        <td class="text-right whitespace-nowrap text-sm">
          <button
            v-if="row.canRecheck"
            class="text-brand-600 hover:text-brand-700 disabled:opacity-50"
            :disabled="!!actionKey"
            @click="recheck(row)"
          >
            {{ actionKey === `check:${row.id}` ? '复查中…' : '复查订阅' }}
          </button>
          <button
            v-if="row.canRetry"
            class="ml-3 text-amber-600 hover:text-amber-700 disabled:opacity-50"
            :disabled="!!actionKey"
            @click="retry(row)"
          >
            {{ actionKey === `retry:${row.id}` ? '重试中…' : '重试退款' }}
          </button>
          <button
            v-if="row.status !== 'NEED_PAY' && row.status !== 'PROCESSING'"
            class="ml-3 text-ink-500 hover:text-rose-600 disabled:opacity-50"
            :disabled="!!actionKey"
            @click="del(row)"
          >
            删除
          </button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <div v-if="total > pageSize" class="mt-4 flex items-center justify-center gap-2 text-sm">
    <button class="px-3 py-1 rounded border border-ink-200 disabled:opacity-40" :disabled="page <= 1" @click="page--">上一页</button>
    <span class="text-ink-500">{{ page }} / {{ totalPages }}</span>
    <button class="px-3 py-1 rounded border border-ink-200 disabled:opacity-40" :disabled="page >= totalPages" @click="page++">下一页</button>
  </div>
</template>
