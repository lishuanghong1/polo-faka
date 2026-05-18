<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';

const route = useRoute();
const order = ref<any>(null);
const loading = ref(true);
let timer: any = null;

async function load() {
  try {
    order.value = await api.orderQuery(route.params.orderNo as string);
  } finally {
    loading.value = false;
  }
}

async function poll() {
  if (!order.value) return;
  if (order.value.status === 'DELIVERED' || order.value.status === 'REFUNDED') return;
  await load();
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => ElMessage.success('已复制'));
}

function copyAll() {
  const all = order.value.cardKeys.map((c: any) => c.content).join('\n');
  copy(all);
}

onMounted(async () => {
  await load();
  timer = setInterval(poll, 2000);
});

onBeforeUnmount(() => clearInterval(timer));

function statusText(s: string) {
  return {
    PENDING: '待支付',
    PAID: '已支付（分配中）',
    DELIVERED: '已发货',
    CANCELLED: '已取消',
    EXPIRED: '已超时',
    REFUNDED: '已退款',
  }[s] || s;
}

function statusColor(s: string) {
  return {
    PENDING: 'text-amber-600 bg-amber-50',
    PAID: 'text-blue-600 bg-blue-50',
    DELIVERED: 'text-emerald-600 bg-emerald-50',
    CANCELLED: 'text-gray-500 bg-gray-100',
    EXPIRED: 'text-gray-500 bg-gray-100',
    REFUNDED: 'text-rose-600 bg-rose-50',
  }[s] || 'text-gray-500 bg-gray-100';
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-8">
    <div v-if="loading" class="text-center text-gray-400 py-12">加载中...</div>
    <div v-else-if="!order" class="text-center text-gray-400 py-12">订单不存在</div>
    <template v-else>
      <div class="card p-6">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">订单详情</h2>
          <span class="px-2.5 py-1 text-xs rounded-full" :class="statusColor(order.status)">
            {{ statusText(order.status) }}
          </span>
        </div>

        <dl class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          <div class="flex justify-between"><dt class="text-gray-500">订单号</dt><dd>{{ order.orderNo }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">商品</dt><dd class="truncate ml-3">{{ order.productTitle }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">规格</dt><dd>{{ order.skuName }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">数量</dt><dd>×{{ order.quantity }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">单价</dt><dd>¥{{ order.unitPrice }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">合计</dt><dd class="font-semibold text-rose-600">¥{{ order.totalAmount }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">下单时间</dt><dd>{{ new Date(order.createdAt).toLocaleString() }}</dd></div>
        </dl>

        <div v-if="order.cardKeys?.length" class="mt-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-medium">卡密信息</h3>
            <button class="text-sm text-brand-600 hover:underline" @click="copyAll">一键复制全部</button>
          </div>
          <ul class="space-y-2">
            <li
              v-for="(c, i) in order.cardKeys"
              :key="i"
              class="p-3 bg-gray-50 rounded-lg flex items-center justify-between gap-3"
            >
              <code class="text-sm text-gray-700 break-all">{{ c.content }}</code>
              <button class="text-xs text-brand-600 hover:underline shrink-0" @click="copy(c.content)">复制</button>
            </li>
          </ul>
        </div>

        <div v-else-if="order.status === 'PAID'" class="mt-4 text-sm text-amber-600">
          ⏳ 卡密正在分配中，请稍候...
        </div>

        <div v-if="order.status === 'PENDING'" class="mt-6 flex justify-end">
          <router-link
            :to="`/mock-pay?orderNo=${order.orderNo}`"
            class="px-4 py-2 rounded-lg brand-gradient text-white text-sm"
          >
            去支付
          </router-link>
        </div>
      </div>
    </template>
  </div>
</template>
