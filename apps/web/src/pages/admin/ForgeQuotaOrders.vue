<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import StatusTag from '@/components/admin/StatusTag.vue';
import ForgeQuotaOrderDetailDrawer from '@/components/admin/ForgeQuotaOrderDetailDrawer.vue';
import BrandButton from '@/components/BrandButton.vue';
import { formatRelative, formatMoneyRaw, formatDateTime, copyText } from '@/utils/format';

const route = useRoute();
const items = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const status = ref('');
const paymentMethod = ref('');
const packageKey = ref('');
const keyword = ref('');
const loading = ref(false);

const currentOrderNo = ref<string | null>(
  typeof route.query.orderNo === 'string' ? route.query.orderNo : null,
);

const statusOptions = [
  { value: '',          label: '全部' },
  { value: 'PENDING',   label: '待支付' },
  { value: 'PAID',      label: '已付款' },
  { value: 'DELIVERED', label: '已发码' },
  { value: 'FAILED',    label: '失败' },
  { value: 'EXPIRED',   label: '已过期' },
  { value: 'REFUNDED',  label: '已退款' },
];

const paymentOptions = [
  { value: '',        label: '全部支付' },
  { value: 'ALIPAY',  label: '支付宝' },
  { value: 'BALANCE', label: '余额' },
  { value: 'POINTS',  label: '积分' },
  { value: 'REDEEM',  label: '兑换码' },
];

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

const summary = computed(() => {
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
    const r: any = await api.forge.quota.admin.listOrders({
      page: page.value,
      pageSize: pageSize.value,
      status: status.value || undefined,
      paymentMethod: paymentMethod.value || undefined,
      packageKey: packageKey.value || undefined,
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
  packageKey.value = '';
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
    case 'POINTS':  return { text: '积分',     cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'REDEEM':  return { text: '兑换码',   cls: 'bg-violet-50 text-violet-700 border-violet-200' };
    default:        return { text: m || '-',  cls: 'bg-ink-100 text-ink-600 border-ink-200' };
  }
}

// ── 售后查码工具 ─────────────────────────────────────
const codeQuery = ref('');
const codeQuerying = ref(false);
const codeResult = ref<any>(null);
const codeError = ref('');

const codeStatusMeta: Record<string, { text: string; cls: string }> = {
  unused: { text: '未核销', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  used: { text: '已核销', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  voided: { text: '已作废', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
};

async function queryCode() {
  const c = codeQuery.value.trim();
  if (!c) return ElMessage.warning('请输入兑换码');
  codeQuerying.value = true;
  codeError.value = '';
  codeResult.value = null;
  try {
    codeResult.value = await api.forge.quota.admin.queryCode(c);
  } catch (e: any) {
    codeError.value = e?.response?.data?.error?.message || '查询失败（码不存在或不是本站出库的码）';
  } finally {
    codeQuerying.value = false;
  }
}

async function voidQueriedCode() {
  if (!codeResult.value || codeResult.value.status !== 'unused') return;
  const code = codeResult.value.code;
  let reason = '';
  try {
    const { value } = await ElMessageBox.prompt(
      `将作废兑换码 ${code}，作废后不可再被兑换，出库款自动退回代理余额。此操作不可撤销。`,
      '确认作废',
      {
        inputPlaceholder: '作废原因（建议填退款单号）',
        confirmButtonText: '确认作废',
        confirmButtonClass: 'el-button--danger',
      },
    );
    reason = (value || '').trim();
  } catch {
    return;
  }
  try {
    const r = await api.forge.quota.admin.voidCodes([code], reason || undefined);
    if (r.voidedCount > 0) {
      ElMessage.success(r.message || '已作废并退款');
    } else {
      ElMessage.warning(r.skipped?.[0]?.reason || r.message || '未能作废');
    }
    await queryCode();
    await load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '作废失败');
  }
}

async function copy(text: string, label = '已复制') {
  if (!text) return;
  const ok = await copyText(text);
  if (ok) ElMessage.success(label);
  else ElMessage.error('复制失败');
}

function gotoOrderOfCode() {
  if (!codeResult.value?.order_no) return;
  // 上游单号 → 找本站订单：直接填进关键词搜索
  keyword.value = codeResult.value.order_no;
  page.value = 1;
  load();
}

onMounted(load);
</script>

<template>
  <AdminPageHeader title="额度包订单" :subtitle="`共 ${total} 条·当前页 ${items.length}`" />

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

  <!-- ────── 售后查码工具 ────── -->
  <div class="card p-4 mb-4">
    <div class="flex items-center gap-2 flex-wrap">
      <div class="text-xs text-ink-500 shrink-0 flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        查码
      </div>
      <input
        v-model="codeQuery"
        placeholder="输入兑换码查核销状态（买家说码无效时先查这里）"
        class="flex-1 min-w-52 px-3 py-2 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition"
        @keydown.enter="queryCode"
      />
      <BrandButton variant="secondary" size="sm" :loading="codeQuerying" @click="queryCode">
        查询
      </BrandButton>
    </div>
    <div v-if="codeError" class="mt-2 text-xs text-rose-600">{{ codeError }}</div>
    <div v-else-if="codeResult" class="mt-3 p-3 rounded-lg bg-ink-50/60 text-sm space-y-1.5">
      <div class="flex items-center gap-2 flex-wrap">
        <code class="font-mono text-ink-900">{{ codeResult.code }}</code>
        <span
          class="inline-flex px-2 py-0.5 rounded-md text-[11px] border whitespace-nowrap"
          :class="(codeStatusMeta[codeResult.status] || codeStatusMeta.unused).cls"
        >{{ codeResult.status_text || (codeStatusMeta[codeResult.status] || codeStatusMeta.unused).text }}</span>
        <button class="text-xs text-brand-700 hover:underline" @click="copy(codeResult.code, '兑换码已复制')">复制</button>
        <BrandButton
          v-if="codeResult.status === 'unused'"
          variant="danger"
          size="sm"
          class="ml-auto"
          @click="voidQueriedCode"
        >作废退款</BrandButton>
      </div>
      <div class="text-xs text-ink-600 flex flex-wrap gap-x-4 gap-y-1">
        <span>额度包 <span class="font-mono">{{ codeResult.package_key }}</span></span>
        <span>面值 ${{ codeResult.quota_usd }}</span>
        <span>线路 <span class="font-mono">{{ codeResult.line_key }}</span></span>
        <span>
          上游单号
          <button class="font-mono text-brand-700 hover:underline" @click="gotoOrderOfCode">{{ codeResult.order_no }}</button>
        </span>
        <span v-if="codeResult.used_at">核销于 {{ formatDateTime(codeResult.used_at) }}</span>
        <span v-if="codeResult.voided_at" class="text-rose-600">作废于 {{ formatDateTime(codeResult.voided_at) }}{{ codeResult.void_reason ? `（${codeResult.void_reason}）` : '' }}</span>
        <span>出库于 {{ formatDateTime(codeResult.created_at) }}</span>
      </div>
    </div>
  </div>

  <!-- ────── 筛选区 ────── -->
  <div class="card p-4 mb-4 space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative flex-1 min-w-40 sm:flex-none sm:w-72">
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400"
        >
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="keyword"
          placeholder="本站订单号 / 上游单号 / 批次号 / 联系方式"
          class="w-full pl-9 pr-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition"
          @keydown.enter="applyFilter"
        />
      </div>
      <input
        v-model="packageKey"
        placeholder="额度包 package_key"
        class="px-3 py-2 border border-ink-200 rounded-lg text-sm flex-1 min-w-40 sm:flex-none sm:w-48 font-mono text-xs focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition"
        @keydown.enter="applyFilter"
      />
      <BrandButton variant="primary" size="sm" @click="applyFilter">
        筛选
      </BrandButton>
      <BrandButton variant="ghost" size="sm" @click="clearFilter">
        重置
      </BrandButton>
    </div>

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
  <DataTable :loading="loading" :is-empty="!items.length" empty="暂无额度包订单" min-width="1240px">
    <thead>
      <tr>
        <th>订单号</th>
        <th>额度包 / 联系方式</th>
        <th>支付</th>
        <th class="!text-right">数量 · 售价</th>
        <th class="!text-right">三方成本</th>
        <th class="!text-center">核销</th>
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
        <td>
          <div class="font-mono text-xs text-brand-700">{{ it.orderNo }}</div>
          <div v-if="it.upstreamOrderNo" class="text-[11px] text-ink-400 mt-0.5 font-mono truncate max-w-[180px]" :title="it.upstreamOrderNo">
            上游 {{ it.upstreamOrderNo }}
          </div>
        </td>

        <td class="max-w-[260px]">
          <div class="text-ink-900 truncate" :title="it.packageName">{{ it.packageName }}</div>
          <div class="text-[11px] text-ink-400 font-mono truncate flex items-center gap-1.5" :title="it.packageKey">
            <span>{{ it.packageKey }}</span>
            <span class="w-1 h-1 rounded-full bg-ink-300" />
            <span class="text-emerald-600">${{ it.quotaUsd }}</span>
            <template v-if="it.contact">
              <span class="w-1 h-1 rounded-full bg-ink-300" />
              <span class="text-ink-500 truncate" :title="it.contact">{{ it.contact }}</span>
            </template>
          </div>
        </td>

        <td>
          <span
            class="inline-flex h-5 px-1.5 items-center text-[11px] rounded border whitespace-nowrap"
            :class="payMethodChip(it.paymentMethod).cls"
          >
            {{ payMethodChip(it.paymentMethod).text }}
          </span>
        </td>

        <td class="!text-right">
          <div class="text-ink-500 text-[11px]">×{{ it.quantity }}</div>
          <div class="font-medium text-price">¥{{ formatMoneyRaw(it.totalAmount) }}</div>
        </td>

        <td class="!text-right text-ink-500 text-xs">
          {{
            it.upstreamAmount !== null && it.upstreamAmount !== undefined
              ? '¥' + formatMoneyRaw(it.upstreamAmount)
              : '—'
          }}
        </td>

        <!-- 核销进度 -->
        <td class="!text-center text-xs whitespace-nowrap">
          <template v-if="it.status === 'DELIVERED'">
            <span class="text-ink-700">{{ it.usedCount }}/{{ it.quantity }}</span>
            <span v-if="it.voidedCount > 0" class="text-rose-500 ml-1" :title="`已作废 ${it.voidedCount} 个`">废{{ it.voidedCount }}</span>
          </template>
          <span v-else class="text-ink-300">—</span>
        </td>

        <td>
          <StatusTag :status="it.status" />
          <div
            v-if="it.failReason"
            class="text-[10px] text-rose-600 mt-1 max-w-[180px] truncate"
            :title="it.failReason"
          >{{ it.failReason }}</div>
        </td>

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
  <ForgeQuotaOrderDetailDrawer
    :order-no="currentOrderNo"
    @close="currentOrderNo = null"
    @changed="load()"
  />
</template>
