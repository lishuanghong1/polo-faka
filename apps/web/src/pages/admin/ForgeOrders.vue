<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import StatusTag from '@/components/admin/StatusTag.vue';
import ForgeOrderDetailDrawer from '@/components/admin/ForgeOrderDetailDrawer.vue';
import BrandButton from '@/components/BrandButton.vue';
import { formatRelative, formatMoneyRaw } from '@/utils/format';

const route = useRoute();
const items = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const status = ref('');
const paymentMethod = ref('');
const typeKey = ref('');
const keyword = ref('');
const loading = ref(false);

const currentOrderNo = ref<string | null>(
  typeof route.query.orderNo === 'string' ? route.query.orderNo : null,
);

const statusOptions = [
  { value: '',          label: '全部' },
  { value: 'PENDING',   label: '待支付' },
  { value: 'PAID',      label: '已付款' },
  { value: 'DELIVERED', label: '已发货' },
  { value: 'FAILED',    label: '失败' },
  { value: 'EXPIRED',   label: '已过期' },
  { value: 'CANCELLED', label: '已取消' },
];

const paymentOptions = [
  { value: '',        label: '全部支付' },
  { value: 'ALIPAY',  label: '支付宝' },
  { value: 'BALANCE', label: '余额' },
  { value: 'REDEEM',  label: '兑换码' },
];

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

const summary = computed(() => {
  // 本页快照统计（不是全量；全量统计由 Dashboard 提供）
  const list = items.value;
  const paid = list.filter((o) => o.status === 'PAID' || o.status === 'DELIVERED');
  const revenue = paid.reduce((acc, o) => acc + Number(o.totalAmount || 0), 0);
  const cost = paid.reduce((acc, o) => acc + Number(o.upstreamAmount || 0), 0);
  return {
    paidCount: paid.length,
    revenue: revenue.toFixed(2),
    cost: cost.toFixed(2),
    profit: (revenue - cost).toFixed(2),
  };
});

async function load() {
  loading.value = true;
  try {
    const r = await api.forge.admin.listOrders({
      page: page.value,
      pageSize: pageSize.value,
      status: status.value || undefined,
      paymentMethod: paymentMethod.value || undefined,
      typeKey: typeKey.value || undefined,
      keyword: keyword.value || undefined,
    });
    items.value = r.items;
    total.value = r.total;
  } finally {
    loading.value = false;
  }
}

function applyFilter() {
  page.value = 1;
  load();
}

function clearFilter() {
  keyword.value = '';
  typeKey.value = '';
  status.value = '';
  paymentMethod.value = '';
  page.value = 1;
  load();
}

function setStatus(s: string) {
  status.value = s;
  page.value = 1;
  load();
}

function setPayment(p: string) {
  paymentMethod.value = p;
  page.value = 1;
  load();
}

function nextPage() { if (page.value < totalPages.value) { page.value++; load(); } }
function prevPage() { if (page.value > 1) { page.value--; load(); } }

function openDetail(orderNo: string) {
  currentOrderNo.value = orderNo;
}

function payMethodChip(m: string) {
  switch ((m || '').toUpperCase()) {
    case 'ALIPAY':  return { text: '支付宝',   cls: 'bg-sky-50 text-sky-700 border-sky-200' };
    case 'BALANCE': return { text: '余额',     cls: 'bg-brand-50 text-brand-700 border-brand-200' };
    case 'REDEEM':  return { text: '兑换码',   cls: 'bg-violet-50 text-violet-700 border-violet-200' };
    default:        return { text: m || '-',  cls: 'bg-ink-100 text-ink-600 border-ink-200' };
  }
}

onMounted(load);
</script>

<template>
  <AdminPageHeader title="Cursorforge 订单" :subtitle="`共 ${total} 条·当前页 ${items.length}`" />

  <!-- ────── 本页快照 ────── -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
    <div class="card p-3">
      <div class="text-[11px] text-ink-500 uppercase tracking-wider">本页已成交</div>
      <div class="text-xl font-semibold text-ink-900 mt-1">{{ summary.paidCount }}</div>
    </div>
    <div class="card p-3">
      <div class="text-[11px] text-ink-500 uppercase tracking-wider">本页营收</div>
      <div class="text-xl font-semibold text-ink-900 mt-1">¥{{ summary.revenue }}</div>
    </div>
    <div class="card p-3">
      <div class="text-[11px] text-ink-500 uppercase tracking-wider">本页成本</div>
      <div class="text-xl font-semibold text-ink-700 mt-1">¥{{ summary.cost }}</div>
    </div>
    <div class="card p-3">
      <div class="text-[11px] text-ink-500 uppercase tracking-wider">本页毛利</div>
      <div
        class="text-xl font-semibold mt-1"
        :class="Number(summary.profit) >= 0 ? 'text-emerald-700' : 'text-rose-600'"
      >
        ¥{{ summary.profit }}
      </div>
    </div>
  </div>

  <!-- ────── 筛选区 ────── -->
  <div class="card p-4 mb-4 space-y-3">
    <!-- 搜索 -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative">
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400"
        >
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="keyword"
          placeholder="本站订单号 / 上游单号 / 支付单号"
          class="pl-9 pr-3 py-2 border border-ink-200 rounded-lg text-sm w-72 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition"
          @keydown.enter="applyFilter"
        />
      </div>
      <input
        v-model="typeKey"
        placeholder="商品 type_key"
        class="px-3 py-2 border border-ink-200 rounded-lg text-sm w-48 font-mono text-xs focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition"
        @keydown.enter="applyFilter"
      />
      <BrandButton variant="primary" size="sm" @click="applyFilter">
        筛选
      </BrandButton>
      <BrandButton variant="ghost" size="sm" @click="clearFilter">
        重置
      </BrandButton>
    </div>

    <!-- 状态过滤芯片 -->
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-[11px] text-ink-400 mr-1">状态</span>
      <button
        v-for="s in statusOptions"
        :key="`s-${s.value}`"
        class="px-2.5 py-1 text-xs rounded-md border transition"
        :class="status === s.value
          ? 'bg-brand-50 text-brand-700 border-brand-300 font-medium'
          : 'bg-white text-ink-600 border-ink-200 hover:border-brand-300 hover:text-brand-700'"
        @click="setStatus(s.value)"
      >
        {{ s.label }}
      </button>
    </div>

    <!-- 支付方式过滤芯片 -->
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-[11px] text-ink-400 mr-1">支付</span>
      <button
        v-for="p in paymentOptions"
        :key="`p-${p.value}`"
        class="px-2.5 py-1 text-xs rounded-md border transition"
        :class="paymentMethod === p.value
          ? 'bg-brand-50 text-brand-700 border-brand-300 font-medium'
          : 'bg-white text-ink-600 border-ink-200 hover:border-brand-300 hover:text-brand-700'"
        @click="setPayment(p.value)"
      >
        {{ p.label }}
      </button>
    </div>
  </div>

  <!-- ────── 列表 ────── -->
  <DataTable :loading="loading" :is-empty="!items.length" empty="暂无三方订单">
    <thead>
      <tr>
        <th>订单号</th>
        <th>商品 / 联系方式</th>
        <th>支付</th>
        <th class="!text-right">数量 · 售价</th>
        <th class="!text-right">三方成本</th>
        <th>状态</th>
        <th class="!text-right">时间</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="it in items"
        :key="it.orderNo"
        class="cursor-pointer"
        @click="openDetail(it.orderNo)"
      >
        <!-- 订单号 -->
        <td>
          <div class="font-mono text-xs text-brand-700">{{ it.orderNo }}</div>
          <div v-if="it.upstreamOrderNo" class="text-[11px] text-ink-400 mt-0.5 font-mono truncate max-w-[180px]" :title="it.upstreamOrderNo">
            上游 {{ it.upstreamOrderNo }}
          </div>
        </td>

        <!-- 商品 + 联系方式 -->
        <td class="max-w-[260px]">
          <div class="text-ink-900 truncate" :title="it.typeName">{{ it.typeName }}</div>
          <div class="text-[11px] text-ink-400 font-mono truncate flex items-center gap-1.5" :title="it.typeKey">
            <span>{{ it.typeKey }}</span>
            <template v-if="it.contact">
              <span class="w-1 h-1 rounded-full bg-ink-300" />
              <span class="text-ink-500 truncate" :title="it.contact">{{ it.contact }}</span>
            </template>
          </div>
        </td>

        <!-- 支付方式 -->
        <td>
          <span
            class="inline-flex h-5 px-1.5 items-center text-[11px] rounded border whitespace-nowrap"
            :class="payMethodChip(it.paymentMethod).cls"
          >
            {{ payMethodChip(it.paymentMethod).text }}
          </span>
        </td>

        <!-- 数量 · 售价 -->
        <td class="!text-right">
          <div class="text-ink-500 text-[11px]">×{{ it.quantity }}</div>
          <div class="font-medium text-price">¥{{ formatMoneyRaw(it.totalAmount) }}</div>
        </td>

        <!-- 三方成本 -->
        <td class="!text-right text-ink-500 text-xs">
          {{
            it.upstreamAmount !== null && it.upstreamAmount !== undefined
              ? '¥' + formatMoneyRaw(it.upstreamAmount)
              : '—'
          }}
        </td>

        <!-- 状态 -->
        <td>
          <StatusTag :status="it.status" />
          <div
            v-if="it.failReason"
            class="text-[10px] text-rose-600 mt-1 max-w-[180px] truncate"
            :title="it.failReason"
          >{{ it.failReason }}</div>
        </td>

        <!-- 时间 -->
        <td class="!text-right text-ink-400 text-xs whitespace-nowrap" :title="new Date(it.createdAt).toLocaleString()">
          {{ formatRelative(it.createdAt) }}
        </td>
      </tr>
    </tbody>
  </DataTable>

  <!-- ────── 分页 ────── -->
  <div v-if="total > pageSize" class="mt-4 flex items-center justify-between gap-3 flex-wrap">
    <div class="text-xs text-ink-500">
      共 <span class="font-medium text-ink-700">{{ total }}</span> 条
      · 第 <span class="font-medium text-ink-700">{{ page }}</span> / {{ totalPages }} 页
    </div>
    <div class="flex items-center gap-2">
      <button
        class="h-8 px-3 rounded-lg border border-ink-200 text-sm text-ink-700 hover:bg-ink-50 hover:border-brand-300 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1"
        :disabled="page <= 1"
        @click="prevPage"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        上一页
      </button>
      <button
        class="h-8 px-3 rounded-lg border border-ink-200 text-sm text-ink-700 hover:bg-ink-50 hover:border-brand-300 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1"
        :disabled="page >= totalPages"
        @click="nextPage"
      >
        下一页
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  </div>

  <!-- ────── Drawer ────── -->
  <ForgeOrderDetailDrawer
    :order-no="currentOrderNo"
    @close="currentOrderNo = null"
    @changed="load()"
  />
</template>
