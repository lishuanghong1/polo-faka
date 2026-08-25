<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElDrawer } from 'element-plus';
import api from '@/api';

const props = defineProps<{ id: number | null; email?: string }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'refreshed'): void;
}>();

const open = ref(false);
const loading = ref(false);
const report = ref<any>(null);
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
    report.value = await api.admin.vaultUsage(id);
    emit('refreshed');
  } catch (e: any) {
    loadError.value = e?.response?.data?.error || e?.message || '加载用量失败，请稍后重试';
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
  const categories = report.value.modelCategories || {};
  return Object.entries(report.value.modelBreakdown)
    .map(([model, v]: [string, any]) => ({
      model,
      category: categories[model] === 'AUTO' ? 'AUTO' : 'PREMIUM',
      ...v,
    }))
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
</script>

<template>
  <ElDrawer
    v-model="open"
    :title="email ? `账号用量 · ${email}` : '账号用量'"
    size="60%"
    direction="rtl"
    @close="close"
  >
    <div v-loading="loading" class="min-h-[200px]">
      <template v-if="report">
        <!-- 概览卡片 -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div class="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <div class="text-xs text-ink-400">套餐</div>
            <div class="text-lg font-semibold mt-1">{{ report.membershipType || '-' }}</div>
            <div class="text-xs text-ink-400">{{ report.planInfo?.price || '-' }}</div>
          </div>
          <div class="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <div class="text-xs text-ink-400">总消费</div>
            <div class="text-lg font-semibold mt-1">{{ report.totalCostUsd }}</div>
            <div class="text-xs text-ink-400">
              套餐 {{ report.officialPlanUsd || report.includedCostUsd }}
              <template v-if="Number(report.officialOnDemandCents || report.onDemandCostCents || 0) > 0">
                · 按需 {{ report.officialOnDemandUsd || report.onDemandCostUsd }}
              </template>
            </div>
          </div>
          <div class="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <div class="text-xs text-ink-400">总请求</div>
            <div class="text-lg font-semibold mt-1">{{ report.totalRequests }}</div>
            <div class="text-xs text-ink-400">{{ Number(report.totalTokens || 0).toLocaleString() }} tokens</div>
          </div>
          <div class="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <div class="text-xs text-ink-400">套餐内占用</div>
            <div class="text-lg font-semibold mt-1">{{ report.isUnlimited ? '无限' : pct(report.totalPercentUsed) }}</div>
            <div class="text-xs text-ink-400">
              上限 {{ report.includedLimitUsd || '-' }}
            </div>
          </div>
        </div>

        <!-- 账单拆分 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-sm">
          <div class="rounded-xl border border-ink-100 p-3 space-y-1">
            <div class="font-medium mb-2">官方账单 / 赠送金</div>
            <div class="flex justify-between"><span class="text-ink-500">套餐+按需</span><b>{{ report.officialTotalUsd || report.totalCostUsd }}</b></div>
            <div class="flex justify-between"><span class="text-ink-500">套餐聚合</span><b>{{ report.officialPlanUsd || report.includedCostUsd }}（{{ report.includedCount }} 次）</b></div>
            <div class="flex justify-between"><span class="text-ink-500">按需</span><b>{{ report.officialOnDemandUsd || report.onDemandCostUsd }}（{{ report.onDemandCount }} 次）</b></div>
            <div v-if="Number(report.freeCreditCents || 0) > 0" class="flex justify-between">
              <span class="text-ink-500">赠送金</span>
              <b>{{ report.freeCreditUsd }}（{{ report.freeCreditCount }} 次）</b>
            </div>
          </div>
          <div class="rounded-xl border border-ink-100 p-3 space-y-1">
            <div class="font-medium mb-2">高级模型 / Auto</div>
            <div class="flex justify-between">
              <span class="text-violet-600">高级模型</span>
              <b :title="`${Number(report.premiumUsage?.tokens || 0).toLocaleString()} tokens`">
                {{ report.premiumUsage?.costUsd || '-' }} · {{ report.premiumUsage?.requests ?? 0 }} 次
              </b>
            </div>
            <div class="flex justify-between">
              <span class="text-sky-600">Auto</span>
              <b :title="`${Number(report.autoUsage?.tokens || 0).toLocaleString()} tokens`">
                {{ report.autoUsage?.costUsd || '-' }} · {{ report.autoUsage?.requests ?? 0 }} 次
              </b>
            </div>
            <div class="flex justify-between text-xs text-ink-400 pt-1 border-t border-ink-50">
              <span>套餐内占用</span>
              <span>API {{ pct(report.includedBreakdown?.api?.percentUsed) }} · Auto {{ pct(report.includedBreakdown?.auto?.percentUsed) }}</span>
            </div>
          </div>
        </div>

        <div class="text-sm text-ink-500 mb-3">
          账期：{{ fromEpoch(report.billingCycle?.startDateEpochMillis) }}
          ~
          {{ fromEpoch(report.billingCycle?.endDateEpochMillis) }}
        </div>

        <!-- 模型汇总 -->
        <div class="font-medium mb-2">模型消耗汇总</div>
        <el-table :data="modelRows" size="small" border class="mb-4">
          <el-table-column prop="model" label="模型" min-width="160" show-overflow-tooltip />
          <el-table-column label="类别" width="70" align="center">
            <template #default="{ row }">
              <span :class="row.category === 'AUTO' ? 'text-sky-600' : 'text-violet-600'">
                {{ row.category === 'AUTO' ? 'Auto' : '高级' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="requests" label="请求" width="80" align="right" />
          <el-table-column label="Tokens" width="120" align="right">
            <template #default="{ row }">{{ Number(row.tokens || 0).toLocaleString() }}</template>
          </el-table-column>
          <el-table-column label="消费" width="100" align="right">
            <template #default="{ row }">${{ (row.costCents / 100).toFixed(2) }}</template>
          </el-table-column>
        </el-table>

        <!-- 逐条明细 -->
        <div class="font-medium mb-2">用量明细（{{ report.events?.length || 0 }} 条）</div>
        <el-table :data="report.events || []" size="small" border height="320">
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ fromEpoch(row.timestamp) }}</template>
          </el-table-column>
          <el-table-column prop="model" label="模型" min-width="140" show-overflow-tooltip />
          <el-table-column label="类型" width="80">
            <template #default="{ row }">
              <span :class="row.typeName === '赠送金' ? 'text-sky-600' : row.isOnDemand ? 'text-amber-600' : 'text-emerald-600'">{{ row.typeName }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Tokens" width="100" align="right">
            <template #default="{ row }">{{ Number(row.tokens || 0).toLocaleString() }}</template>
          </el-table-column>
          <el-table-column prop="costUsd" label="费用" width="100" align="right" />
        </el-table>
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
