<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElDrawer } from 'element-plus';
import api from '@/api';
import { membershipLabel } from '@/utils/cursor-membership';

const props = defineProps<{ id: number | null; email?: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const open = ref(false);
const loading = ref(false);
const report = ref<any>(null);
const snapshots = ref<any[]>([]);
const loadError = ref('');

watch(
  () => props.id,
  async (id) => {
    if (id) {
      open.value = true;
      await load(id);
    } else {
      open.value = false;
      report.value = null;
      snapshots.value = [];
      loadError.value = '';
    }
  },
  { immediate: true },
);

async function load(id: number) {
  loading.value = true;
  report.value = null;
  loadError.value = '';
  try {
    const [rep, snaps] = await Promise.all([
      api.admin.cursorQuotaReport(id),
      api.admin.cursorQuotaSnapshots(id).catch(() => []),
    ]);
    report.value = rep;
    snapshots.value = snaps as any[];
  } catch (e: any) {
    loadError.value =
      e?.response?.data?.error || e?.message || '加载报告失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

function retry() {
  if (props.id) load(props.id);
}

function close() {
  open.value = false;
  emit('close');
}

const modelRows = computed(() => {
  if (!report.value?.modelBreakdown) return [];
  return Object.entries(report.value.modelBreakdown)
    .map(([model, v]: [string, any]) => ({ model, ...v }))
    .sort((a, b) => b.costCents - a.costCents);
});

function fromEpoch(ms: string | number | null | undefined) {
  if (!ms) return '-';
  const n = Number(ms);
  if (!Number.isFinite(n) || n === 0) return '-';
  return new Date(n).toLocaleString('zh-CN');
}

function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return '-';
  return `${Number(v).toFixed(1)}%`;
}

const mem = computed(() => membershipLabel(report.value?.membershipType));
</script>

<template>
  <ElDrawer
    v-model="open"
    :title="email ? `额度报告 · ${email}` : '额度报告'"
    size="60%"
    direction="rtl"
    @close="close"
  >
    <div v-loading="loading" class="min-h-[200px]">
      <template v-if="report">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div class="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <div class="text-xs text-ink-400">套餐</div>
            <div class="text-lg font-semibold mt-1">{{ mem.text }}</div>
            <div class="text-xs text-ink-400">{{ report.planInfo?.price || '-' }}</div>
          </div>
          <div class="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <div class="text-xs text-ink-400">账期总消费</div>
            <div class="text-lg font-semibold mt-1">{{ report.totalCostUsd }}</div>
            <div class="text-xs text-ink-400">上限 {{ report.includedLimitUsd }}</div>
          </div>
          <div class="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <div class="text-xs text-ink-400">总请求</div>
            <div class="text-lg font-semibold mt-1">{{ report.totalRequests }}</div>
            <div class="text-xs text-ink-400">{{ Number(report.totalTokens || 0).toLocaleString() }} tokens</div>
          </div>
          <div class="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <div class="text-xs text-ink-400">已用额度</div>
            <div class="text-lg font-semibold mt-1">{{ pct(report.totalPercentUsed) }}</div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-sm">
          <div class="rounded-xl border border-ink-100 p-3 space-y-1">
            <div class="font-medium mb-2">套餐内 / 超额</div>
            <div class="flex justify-between"><span class="text-ink-500">套餐内</span><b>{{ report.includedCostUsd }}（{{ report.includedCount }} 次）</b></div>
            <div class="flex justify-between"><span class="text-ink-500">超额</span><b>{{ report.onDemandCostUsd }}（{{ report.onDemandCount }} 次）</b></div>
          </div>
          <div class="rounded-xl border border-ink-100 p-3 space-y-1">
            <div class="font-medium mb-2">API / Auto</div>
            <div class="flex justify-between"><span class="text-ink-500">API</span><b>{{ report.includedBreakdown?.api?.costUsd }} · {{ pct(report.includedBreakdown?.api?.percentUsed) }}</b></div>
            <div class="flex justify-between"><span class="text-ink-500">Auto</span><b>{{ report.includedBreakdown?.auto?.costUsd }} · {{ pct(report.includedBreakdown?.auto?.percentUsed) }}</b></div>
          </div>
        </div>

        <div class="text-sm text-ink-500 mb-2">
          账期：{{ fromEpoch(report.billingCycle?.startDateEpochMillis) }}
          ~
          {{ fromEpoch(report.billingCycle?.endDateEpochMillis) }}
        </div>

        <div class="font-medium mb-2">模型消耗汇总</div>
        <el-table :data="modelRows" size="small" border class="mb-4">
          <el-table-column prop="model" label="模型" min-width="160" />
          <el-table-column prop="requests" label="请求" width="80" align="right" />
          <el-table-column label="Tokens" width="120" align="right">
            <template #default="{ row }">{{ Number(row.tokens || 0).toLocaleString() }}</template>
          </el-table-column>
          <el-table-column label="消费" width="100" align="right">
            <template #default="{ row }">${{ (row.costCents / 100).toFixed(2) }}</template>
          </el-table-column>
        </el-table>

        <div class="font-medium mb-2">
          用量明细（{{ report.events?.length || 0 }} 条）
        </div>
        <el-table :data="report.events || []" size="small" border height="300">
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ fromEpoch(row.timestamp) }}</template>
          </el-table-column>
          <el-table-column prop="model" label="模型" min-width="140" show-overflow-tooltip />
          <el-table-column label="类型" width="80">
            <template #default="{ row }">
              <span :class="row.isOnDemand ? 'text-amber-600' : 'text-emerald-600'">{{ row.typeName }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Tokens" width="100" align="right">
            <template #default="{ row }">{{ Number(row.tokens || 0).toLocaleString() }}</template>
          </el-table-column>
          <el-table-column prop="costUsd" label="费用" width="100" align="right" />
        </el-table>

        <div v-if="snapshots.length" class="mt-4">
          <div class="font-medium mb-2">本系统额度趋势（最近快照）</div>
          <el-table :data="snapshots.slice(-20)" size="small" border>
            <el-table-column label="时间" min-width="150">
              <template #default="{ row }">{{ new Date(row.checkedAt).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column label="总消费" width="100" align="right">
              <template #default="{ row }">${{ (row.totalCostCents / 100).toFixed(2) }}</template>
            </el-table-column>
            <el-table-column label="已用%" width="90" align="right">
              <template #default="{ row }">{{ pct(row.percent) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </template>
      <div v-else-if="!loading && loadError" class="text-center py-16">
        <div class="text-rose-500 mb-3">{{ loadError }}</div>
        <button
          class="px-4 py-1.5 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700"
          @click="retry"
        >
          重试
        </button>
      </div>
      <div v-else-if="!loading" class="text-center text-ink-400 py-16">暂无数据</div>
    </div>
  </ElDrawer>
</template>
