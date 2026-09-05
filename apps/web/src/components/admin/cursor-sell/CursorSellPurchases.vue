<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api, { type CursorSellPurchase, type CursorSellSale } from '@/api';
import BrandButton from '@/components/BrandButton.vue';
import CursorSellSaleCard from './CursorSellSaleCard.vue';

const props = defineProps<{ skuOptions: Array<{ id: number; label: string }> }>();

const router = useRouter();
const items = ref<CursorSellPurchase[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 30;
const loading = ref(false);
const filter = ref<{ status: string; source: string; keyword: string }>({ status: '', source: '', keyword: '' });

const detail = ref<(CursorSellPurchase & { sales: CursorSellSale[]; rawResponse: unknown }) | null>(null);
const drawerOpen = ref(false);
const detailLoading = ref(false);
const retrying = ref<number | null>(null);
const showRaw = ref(false);

const statusLabel: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '待重试', cls: 'bg-amber-50 text-amber-700' },
  MAKING: { text: '开通中', cls: 'bg-sky-50 text-sky-700' },
  DONE: { text: '已成交', cls: 'bg-emerald-50 text-emerald-700' },
  FAILED: { text: '失败', cls: 'bg-rose-50 text-rose-700' },
};

async function load() {
  loading.value = true;
  try {
    const r = await api.admin.cursorSell.purchases({
      page: page.value,
      pageSize,
      status: filter.value.status || undefined,
      source: filter.value.source || undefined,
      keyword: filter.value.keyword.trim() || undefined,
    });
    items.value = r.items;
    total.value = r.total;
  } finally {
    loading.value = false;
  }
}

async function openDetail(id: number) {
  drawerOpen.value = true;
  detailLoading.value = true;
  showRaw.value = false;
  try {
    detail.value = await api.admin.cursorSell.purchase(id);
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  drawerOpen.value = false;
  detail.value = null;
}

async function retry(p: CursorSellPurchase) {
  retrying.value = p.id;
  try {
    const r = await api.admin.cursorSell.retryPurchase(p.id);
    ElMessage[r.status === 'DONE' ? 'success' : 'warning'](
      r.status === 'DONE' ? '重试成功，已成交' : `当前状态：${statusLabel[r.status]?.text || r.status}${r.failReason ? ` · ${r.failReason}` : ''}`,
    );
    await load();
    if (detail.value?.id === p.id) await openDetail(p.id);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '重试失败');
  } finally {
    retrying.value = null;
  }
}

function onSaleChanged(s: CursorSellSale) {
  if (!detail.value) return;
  const idx = detail.value.sales.findIndex((x) => x.id === s.id);
  if (idx >= 0) detail.value.sales[idx] = s;
}

function fmt(t: string | null | undefined) {
  return t ? new Date(t).toLocaleString() : '—';
}

watch(() => [filter.value.status, filter.value.source], () => {
  page.value = 1;
  load();
});

onMounted(load);
defineExpose({ load });
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <select v-model="filter.status" class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm bg-white">
        <option value="">全部状态</option>
        <option value="PENDING">待重试</option>
        <option value="MAKING">开通中</option>
        <option value="DONE">已成交</option>
        <option value="FAILED">失败</option>
      </select>
      <select v-model="filter.source" class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm bg-white">
        <option value="">全部来源</option>
        <option value="ORDER">订单自动发货</option>
        <option value="MANUAL">后台手动采购</option>
      </select>
      <input
        v-model="filter.keyword"
        placeholder="搜订单号 / 商品 / 邮箱 / 幂等键"
        class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-64"
        @keydown.enter="page = 1; load()"
      />
      <BrandButton variant="secondary" size="sm" :disabled="loading" @click="page = 1; load()">查询</BrandButton>
      <span class="text-xs text-ink-400 ml-auto">共 {{ total }} 单</span>
    </div>

    <div class="rounded-xl border border-ink-100 bg-white overflow-hidden overflow-x-auto">
      <table class="w-full text-sm min-w-[980px]">
        <thead class="bg-ink-50 text-ink-600">
          <tr>
            <th class="px-4 py-2 text-left">#</th>
            <th class="px-4 py-2 text-left">来源 / 订单</th>
            <th class="px-4 py-2 text-left">渠道商品</th>
            <th class="px-4 py-2 text-right">数量</th>
            <th class="px-4 py-2 text-right">成本</th>
            <th class="px-4 py-2 text-left">状态</th>
            <th class="px-4 py-2 text-left">最近尝试</th>
            <th class="px-4 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="p in items" :key="p.id" class="hover:bg-ink-50/60">
            <td class="px-4 py-2 text-ink-400 font-mono text-xs">{{ p.id }}</td>
            <td class="px-4 py-2">
              <div class="text-xs" :class="p.source === 'ORDER' ? 'text-ink-700' : 'text-violet-700'">
                {{ p.source === 'ORDER' ? '订单发货' : '手动采购' }}
              </div>
              <button
                v-if="p.orderNo"
                class="font-mono text-xs text-brand-700 hover:underline"
                @click="router.push(`/order/${p.orderNo}`)"
              >{{ p.orderNo }}</button>
            </td>
            <td class="px-4 py-2">
              <div class="text-ink-900">{{ p.productTitle }}</div>
              <div class="text-[11px] text-ink-400 font-mono">{{ p.productCode }}<span v-if="p.kind"> · {{ p.kind }}</span></div>
            </td>
            <td class="px-4 py-2 text-right text-ink-800">{{ p.qty }}<span v-if="p.saleCount" class="text-ink-400 text-xs"> / 成交 {{ p.saleCount }}</span></td>
            <td class="px-4 py-2 text-right text-ink-800">{{ p.cost == null ? '—' : `¥${p.cost.toFixed(2)}` }}</td>
            <td class="px-4 py-2">
              <span class="inline-block px-2 py-0.5 text-[11px] rounded-md" :class="(statusLabel[p.status] || {}).cls">
                {{ (statusLabel[p.status] || { text: p.status }).text }}
              </span>
              <div v-if="p.failReason" class="text-[11px] text-rose-600 mt-0.5 max-w-[260px] truncate" :title="p.failReason">{{ p.failReason }}</div>
            </td>
            <td class="px-4 py-2 text-xs text-ink-500">
              {{ fmt(p.lastAttemptAt || p.createdAt) }}
              <div class="text-[11px] text-ink-400">尝试 {{ p.attempts }} 次</div>
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <button class="text-xs text-brand-600 hover:underline mr-3" @click="openDetail(p.id)">详情</button>
              <button
                v-if="p.status === 'PENDING' || p.status === 'FAILED'"
                class="text-xs text-amber-700 hover:underline disabled:opacity-50"
                :disabled="retrying === p.id"
                @click="retry(p)"
              >{{ retrying === p.id ? '重试中…' : '重试' }}</button>
            </td>
          </tr>
          <tr v-if="!items.length && !loading">
            <td colspan="8" class="px-4 py-10 text-center text-ink-400">暂无采购记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="total > pageSize" class="flex items-center justify-end gap-2 text-xs text-ink-500">
      <button class="px-2 py-1 border border-ink-200 rounded disabled:opacity-40" :disabled="page <= 1" @click="page--; load()">上一页</button>
      <span>{{ page }} / {{ Math.ceil(total / pageSize) }}</span>
      <button class="px-2 py-1 border border-ink-200 rounded disabled:opacity-40" :disabled="page >= Math.ceil(total / pageSize)" @click="page++; load()">下一页</button>
    </div>

    <p class="text-[11px] text-ink-400 leading-relaxed">
      「待重试」表示上游暂时无货 / 不可用或网络异常，系统每 5 分钟用同一幂等键自动重试，不会重复扣费；「失败」需人工处理（充值后重试、换商品或退款）。
    </p>

    <!-- 详情抽屉 -->
    <el-drawer :model-value="drawerOpen" :with-header="false" size="min(720px, 100%)" destroy-on-close @close="closeDetail">
      <div v-if="detail" class="space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-base font-semibold text-ink-900">采购单 #{{ detail.id }}</div>
            <div class="text-xs text-ink-500 mt-1">
              {{ detail.productTitle }} · <span class="font-mono">{{ detail.productCode }}</span> × {{ detail.qty }}
              <span v-if="detail.cost != null"> · 成本 ¥{{ detail.cost.toFixed(2) }}</span>
            </div>
          </div>
          <span class="inline-block px-2 py-0.5 text-[11px] rounded-md" :class="(statusLabel[detail.status] || {}).cls">
            {{ (statusLabel[detail.status] || { text: detail.status }).text }}
          </span>
        </div>

        <dl class="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs text-ink-600 bg-ink-50 rounded-lg p-3">
          <div>来源：{{ detail.source === 'ORDER' ? '订单自动发货' : '后台手动采购' }}</div>
          <div>订单：<button v-if="detail.orderNo" class="font-mono text-brand-700 hover:underline" @click="router.push(`/order/${detail.orderNo}`)">{{ detail.orderNo }}</button><span v-else>—</span></div>
          <div class="col-span-2">幂等键：<code class="font-mono">{{ detail.idempotencyKey }}</code></div>
          <div>创建：{{ fmt(detail.createdAt) }}</div>
          <div>最近尝试：{{ fmt(detail.lastAttemptAt) }}（{{ detail.attempts }} 次）</div>
          <div v-if="detail.failReason" class="col-span-2 text-rose-700">{{ detail.errorCode }} · {{ detail.failReason }}</div>
        </dl>

        <div v-if="detail.status === 'PENDING' || detail.status === 'FAILED'" class="flex gap-2">
          <BrandButton variant="primary" size="sm" :loading="retrying === detail.id" @click="retry(detail)">同键重试</BrandButton>
        </div>

        <div>
          <div class="text-sm font-medium text-ink-900 mb-2">成交明细（{{ detail.sales.length }}）</div>
          <div v-if="detail.sales.length" class="space-y-3">
            <CursorSellSaleCard
              v-for="s in detail.sales"
              :key="s.id"
              :sale="s"
              :sku-options="props.skuOptions"
              @changed="onSaleChanged"
            />
          </div>
          <div v-else class="text-xs text-ink-400">暂无成交</div>
        </div>

        <div v-if="detail.rawResponse">
          <button class="text-xs text-ink-500 hover:text-ink-800" @click="showRaw = !showRaw">
            {{ showRaw ? '收起' : '查看' }}上游原始响应
          </button>
          <pre v-if="showRaw" class="mt-2 text-[11px] bg-ink-900 text-ink-100 rounded-lg p-3 overflow-auto max-h-80 font-mono">{{ JSON.stringify(detail.rawResponse, null, 2) }}</pre>
        </div>
      </div>
      <div v-else-if="detailLoading" class="text-sm text-ink-400 p-6">加载中…</div>
    </el-drawer>
  </div>
</template>
