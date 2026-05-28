<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';

interface BlockedItem {
  ip: string;
  reason: string;
  createdAt: number;
  ttl: number;
}

const list = ref<BlockedItem[]>([]);
const loading = ref(false);

const form = ref({
  ip: '',
  hours: 24,
  reason: '',
});

async function load() {
  loading.value = true;
  try {
    list.value = (await api.admin.abuseList()) || [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function doBlock() {
  const ip = form.value.ip.trim();
  if (!ip) {
    ElMessage.warning('请输入 IP');
    return;
  }
  const hours = Number(form.value.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    ElMessage.warning('封禁时长必须 > 0');
    return;
  }
  try {
    await api.admin.abuseBlock(ip, Math.floor(hours * 3600), form.value.reason || 'manual');
    ElMessage.success(`已封禁 ${ip}（${hours}h）`);
    form.value = { ip: '', hours: 24, reason: '' };
    await load();
  } catch (e: any) {
    ElMessage.error(e?.message || '封禁失败');
  }
}

async function doUnblock(item: BlockedItem) {
  try {
    await ElMessageBox.confirm(`确认解封 ${item.ip} ?`, '解封确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api.admin.abuseUnblock(item.ip);
    ElMessage.success(`已解封 ${item.ip}`);
    await load();
  } catch (e: any) {
    ElMessage.error(e?.message || '解封失败');
  }
}

const stats = computed(() => {
  const auto = list.value.filter((i) => i.reason.startsWith('auto:')).length;
  const manual = list.value.length - auto;
  return { total: list.value.length, auto, manual };
});

function fmtTtl(s: number) {
  if (s <= 0) return '已过期';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function fmtCreatedAt(ts: number) {
  if (!ts) return '—';
  const d = new Date(ts);
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return d.toLocaleString();
}

function reasonTag(reason: string) {
  if (reason.startsWith('auto:alipay_notify_malformed'))
    return { label: '自动 · 入参非法', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (reason.startsWith('auto:alipay_notify_signfail'))
    return { label: '自动 · 验签失败', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (reason.startsWith('auto:'))
    return { label: '自动', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: '手动', cls: 'bg-ink-50 text-ink-700 border-ink-200' };
}
</script>

<template>
  <AdminPageHeader title="IP 黑名单" :subtitle="`共 ${stats.total} 个封禁中 · 自动 ${stats.auto} / 手动 ${stats.manual}`">
    <template #actions>
      <button class="px-3 py-1.5 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="load">
        刷新
      </button>
    </template>
  </AdminPageHeader>

  <div class="card p-4 mb-4">
    <div class="text-sm text-ink-700 font-medium mb-2">手动封禁</div>
    <div class="flex items-center gap-2 flex-wrap">
      <input
        v-model="form.ip"
        placeholder="IP 地址（如 59.64.129.233）"
        class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-64 font-mono"
      />
      <div class="flex items-center gap-1 text-sm">
        <span class="text-ink-500">时长</span>
        <input
          v-model.number="form.hours"
          type="number"
          min="1"
          class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-20"
        />
        <span class="text-ink-500">小时</span>
      </div>
      <input
        v-model="form.reason"
        placeholder="备注（可选）"
        class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm flex-1 min-w-40"
      />
      <button
        class="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm"
        @click="doBlock"
      >
        立即封禁
      </button>
    </div>
    <div class="text-xs text-ink-500 mt-2">
      系统会自动封禁可疑 IP：支付宝 notify 入参非法 5 次/5 分钟、验签失败 3 次/10 分钟 → 自动拉黑 24 小时
    </div>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" empty="当前没有被封禁的 IP">
    <thead>
      <tr>
        <th style="width: 160px">IP</th>
        <th style="width: 130px">类型</th>
        <th>原因</th>
        <th style="width: 140px">封禁时间</th>
        <th style="width: 120px">剩余时长</th>
        <th style="width: 100px">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.ip">
        <td class="font-mono text-sm">{{ row.ip }}</td>
        <td>
          <span class="text-[11px] px-2 py-0.5 rounded border" :class="reasonTag(row.reason).cls">
            {{ reasonTag(row.reason).label }}
          </span>
        </td>
        <td class="text-xs font-mono text-ink-500 break-all max-w-md">{{ row.reason }}</td>
        <td class="text-xs text-ink-500" :title="row.createdAt ? new Date(row.createdAt).toLocaleString() : ''">
          {{ fmtCreatedAt(row.createdAt) }}
        </td>
        <td class="text-xs text-ink-600">{{ fmtTtl(row.ttl) }}</td>
        <td>
          <button
            class="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-ink-50 text-ink-700"
            @click="doUnblock(row)"
          >
            解封
          </button>
        </td>
      </tr>
    </tbody>
  </DataTable>
</template>
