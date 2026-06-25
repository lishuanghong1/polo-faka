<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import StatusTag from '@/components/admin/StatusTag.vue';
import AdminSearchInput from '@/components/admin/AdminSearchInput.vue';
import OrderDetailDrawer from '@/components/admin/OrderDetailDrawer.vue';
import ForgeOrderDetailDrawer from '@/components/admin/ForgeOrderDetailDrawer.vue';

const route = useRoute();
type UnifiedOrder = {
  id: string;
  source: 'LOCAL' | 'FORGE';
  orderNo: string;
  productTitle: string;
  skuName: string;
  quantity: number;
  amount: number;
  payMethod: string;
  status: string;
  createdAt: string;
  buyerLogonId?: string | null;
  failReason?: string | null;
};

const list = ref<UnifiedOrder[]>([]);
const total = ref(0);
const filter = ref<{ status?: string; keyword?: string }>({});
const page = ref(1);
const loading = ref(false);
const currentLocalOrderNo = ref<string | null>(
  typeof route.query.orderNo === 'string' ? route.query.orderNo : null,
);
const currentForgeOrderNo = ref<string | null>(null);
const pageSize = 50;

async function load() {
  loading.value = true;
  try {
    const [local, forge] = await Promise.all([
      api.admin.orders({ ...filter.value, page: page.value, pageSize }),
      api.forge.admin.listOrders({
        page: page.value,
        pageSize,
        status: filter.value.status || undefined,
        keyword: filter.value.keyword || undefined,
      }),
    ]);

    const localItems: UnifiedOrder[] = (local.items || []).map((o: any) => ({
      id: `local-${o.id || o.orderNo}`,
      source: 'LOCAL',
      orderNo: o.orderNo,
      productTitle: o.productTitle,
      skuName: o.skuName,
      quantity: o.quantity,
      amount: Number(o.payAmount ?? o.totalAmount ?? 0),
      payMethod: o.payMethod,
      status: o.status,
      createdAt: o.createdAt,
      buyerLogonId: o.buyerLogonId,
    }));
    const forgeItems: UnifiedOrder[] = (forge.items || []).map((o: any) => ({
      id: `forge-${o.orderNo}`,
      source: 'FORGE',
      orderNo: o.orderNo,
      productTitle: o.typeName,
      skuName: o.typeKey || '',
      quantity: o.quantity,
      amount: Number(o.payAmount ?? o.totalAmount ?? 0),
      payMethod: o.paymentMethod,
      status: o.status,
      createdAt: o.createdAt,
      buyerLogonId: o.buyerLogonId,
      failReason: o.failReason,
    }));
    list.value = [...localItems, ...forgeItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, pageSize);
    total.value = Number(local.total || 0) + Number(forge.total || 0);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'PENDING', label: '待支付' },
  { value: 'PAID', label: '已支付' },
  { value: 'DELIVERED', label: '已发货' },
  { value: 'FAILED', label: '失败' },
  { value: 'CANCELLED', label: '已取消' },
  { value: 'EXPIRED', label: '已过期' },
  { value: 'REFUNDED', label: '已退款' },
];

const payMethodLabel: Record<string, string> = {
  ALIPAY: '支付宝',
  WECHAT: '微信',
  BALANCE: '余额',
  POINTS: '积分',
  REDEEM: '兑换码',
  USDT: 'USDT',
  MOCK: 'Mock',
};

const sourceLabel: Record<UnifiedOrder['source'], string> = {
  LOCAL: '本地',
  FORGE: '三方',
};

const sourceClass: Record<UnifiedOrder['source'], string> = {
  LOCAL: 'bg-brand-50 text-brand-700 border-brand-200',
  FORGE: 'bg-violet-50 text-violet-700 border-violet-200',
};

const shownTotal = computed(() => list.value.length);

function openDetail(o: UnifiedOrder) {
  if (o.source === 'FORGE') currentForgeOrderNo.value = o.orderNo;
  else currentLocalOrderNo.value = o.orderNo;
}
</script>

<template>
  <AdminPageHeader title="订单" :subtitle="`共 ${total} 条订单 · 当前显示 ${shownTotal} 条`" />

  <div class="card p-3 mb-4 admin-filter-bar">
    <AdminSearchInput
      v-model="filter.keyword"
      placeholder="搜索订单号 / 商品名 / 支付单号"
      @enter="load"
    />
    <select v-model="filter.status" class="admin-select flex-1 sm:flex-none">
      <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <button class="px-4 h-9 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm shrink-0" @click="load">查询</button>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" min-width="1400px">
    <thead>
      <tr>
        <th>订单号</th>
        <th>类型</th>
        <th>商品</th>
        <th>规格</th>
        <th class="!text-right">数量</th>
        <th class="!text-right">金额</th>
        <th>支付</th>
        <th>支付账号</th>
        <th>状态</th>
        <th class="!text-right">下单时间</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="o in list"
        :key="o.id"
        class="cursor-pointer"
        @click="openDetail(o)"
      >
        <td>
          <span class="font-mono text-xs text-brand-700">{{ o.orderNo }}</span>
        </td>
        <td>
          <span
            class="inline-flex h-5 px-1.5 items-center text-[11px] rounded border whitespace-nowrap"
            :class="sourceClass[o.source]"
          >{{ sourceLabel[o.source] }}</span>
        </td>
        <td class="max-w-[260px] truncate">{{ o.productTitle }}</td>
        <td class="text-ink-500 max-w-[220px] truncate">{{ o.skuName || '—' }}</td>
        <td class="text-right text-ink-600">×{{ o.quantity }}</td>
        <td class="text-right font-medium text-price">¥{{ o.amount.toFixed(2) }}</td>
        <td class="text-ink-600">{{ payMethodLabel[o.payMethod] || o.payMethod }}</td>
        <td class="text-ink-600 text-xs font-mono">
          <span v-if="o.buyerLogonId">{{ o.buyerLogonId }}</span>
          <span v-else class="text-ink-300">—</span>
        </td>
        <td>
          <StatusTag :status="o.status" />
          <div
            v-if="o.failReason"
            class="text-[10px] text-rose-600 mt-1 max-w-[180px] truncate"
            :title="o.failReason"
          >{{ o.failReason }}</div>
        </td>
        <td class="text-right text-ink-400 text-xs">{{ new Date(o.createdAt).toLocaleString() }}</td>
      </tr>
    </tbody>
  </DataTable>

  <OrderDetailDrawer
    :order-no="currentLocalOrderNo"
    @close="currentLocalOrderNo = null"
    @changed="load()"
  />
  <ForgeOrderDetailDrawer
    :order-no="currentForgeOrderNo"
    @close="currentForgeOrderNo = null"
    @changed="load()"
  />
</template>
