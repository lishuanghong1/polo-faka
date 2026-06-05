<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import StatusTag from '@/components/admin/StatusTag.vue';
import OrderDetailDrawer from '@/components/admin/OrderDetailDrawer.vue';

const route = useRoute();
const list = ref<any[]>([]);
const total = ref(0);
const filter = ref<{ status?: string; keyword?: string }>({});
const page = ref(1);
const loading = ref(false);
const currentOrderNo = ref<string | null>(
  typeof route.query.orderNo === 'string' ? route.query.orderNo : null,
);

async function load() {
  loading.value = true;
  try {
    const a = await api.admin.orders({ ...filter.value, page: page.value, pageSize: 50 });
    list.value = a.items;
    total.value = a.total;
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
  { value: 'CANCELLED', label: '已取消' },
  { value: 'REFUNDED', label: '已退款' },
];

const payMethodLabel: Record<string, string> = {
  ALIPAY: '支付宝', WECHAT: '微信', BALANCE: '余额', USDT: 'USDT', MOCK: 'Mock',
};

function openDetail(orderNo: string) {
  currentOrderNo.value = orderNo;
}
</script>

<template>
  <AdminPageHeader title="订单" :subtitle="`共 ${total} 条订单`" />

  <div class="card p-3 mb-4 flex items-center gap-2 text-sm flex-wrap">
    <input
      v-model="filter.keyword"
      placeholder="搜索订单号 / 商品名"
      class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-full sm:w-64"
      @keydown.enter="load"
    />
    <select v-model="filter.status" class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm bg-white flex-1 sm:flex-none">
      <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm shrink-0" @click="load">查询</button>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" min-width="1120px">
    <thead>
      <tr>
        <th>订单号</th>
        <th>商品</th>
        <th>规格</th>
        <th class="!text-right">数量</th>
        <th class="!text-right">金额</th>
        <th>支付</th>
        <th>状态</th>
        <th class="!text-right">下单时间</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="o in list"
        :key="o.id"
        class="cursor-pointer"
        @click="openDetail(o.orderNo)"
      >
        <td>
          <span class="font-mono text-xs text-brand-700">{{ o.orderNo }}</span>
        </td>
        <td class="max-w-[260px] truncate">{{ o.productTitle }}</td>
        <td class="text-ink-500">{{ o.skuName }}</td>
        <td class="text-right text-ink-600">×{{ o.quantity }}</td>
        <td class="text-right font-medium text-price">¥{{ o.totalAmount }}</td>
        <td class="text-ink-600">{{ payMethodLabel[o.payMethod] || o.payMethod }}</td>
        <td><StatusTag :status="o.status" /></td>
        <td class="text-right text-ink-400 text-xs">{{ new Date(o.createdAt).toLocaleString() }}</td>
      </tr>
    </tbody>
  </DataTable>

  <OrderDetailDrawer
    :order-no="currentOrderNo"
    @close="currentOrderNo = null"
    @changed="load()"
  />
</template>
