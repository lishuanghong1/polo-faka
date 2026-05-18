<script setup lang="ts">
import { onMounted, ref } from 'vue';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const user = useUserStore();
const orders = ref<any[]>([]);
const logs = ref<any[]>([]);

async function load() {
  const a = await api.myOrders({ page: 1, pageSize: 20 });
  orders.value = a.items;
  logs.value = await api.balanceLogs({ page: 1, pageSize: 20 });
}

onMounted(load);
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-8 space-y-4">
    <div class="card p-6">
      <div class="flex items-center gap-4">
        <div class="w-14 h-14 rounded-full brand-gradient text-white text-xl font-bold flex items-center justify-center">
          {{ user.profile?.nickname?.[0] || user.profile?.username?.[0] }}
        </div>
        <div>
          <div class="font-semibold">{{ user.profile?.nickname || user.profile?.username }}</div>
          <div class="text-xs text-gray-500">{{ user.profile?.email || '未绑定邮箱' }}</div>
        </div>
        <div class="ml-auto text-right">
          <div class="text-xs text-gray-500">账户余额</div>
          <div class="text-xl font-bold text-rose-600">¥{{ user.profile?.balance ?? 0 }}</div>
        </div>
      </div>
    </div>

    <div class="card p-6">
      <h2 class="font-semibold mb-3">我的订单</h2>
      <div v-if="!orders.length" class="text-sm text-gray-400 text-center py-8">暂无订单</div>
      <table v-else class="w-full text-sm">
        <thead class="text-gray-500 text-xs">
          <tr>
            <th class="text-left py-2 px-2">订单号</th>
            <th class="text-left py-2 px-2">商品</th>
            <th class="text-left py-2 px-2">金额</th>
            <th class="text-left py-2 px-2">状态</th>
            <th class="text-left py-2 px-2">时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in orders" :key="o.id" class="border-t">
            <td class="py-2 px-2">
              <router-link :to="`/order/${o.orderNo}`" class="text-brand-600 hover:underline">{{ o.orderNo }}</router-link>
            </td>
            <td class="py-2 px-2">{{ o.productTitle }}</td>
            <td class="py-2 px-2">¥{{ o.totalAmount }}</td>
            <td class="py-2 px-2">{{ o.status }}</td>
            <td class="py-2 px-2 text-gray-500">{{ new Date(o.createdAt).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card p-6">
      <h2 class="font-semibold mb-3">余额明细</h2>
      <div v-if="!logs.length" class="text-sm text-gray-400 text-center py-8">暂无</div>
      <table v-else class="w-full text-sm">
        <thead class="text-gray-500 text-xs">
          <tr>
            <th class="text-left py-2 px-2">类型</th>
            <th class="text-left py-2 px-2">金额</th>
            <th class="text-left py-2 px-2">余额</th>
            <th class="text-left py-2 px-2">备注</th>
            <th class="text-left py-2 px-2">时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in logs" :key="l.id" class="border-t">
            <td class="py-2 px-2">{{ l.type }}</td>
            <td class="py-2 px-2" :class="Number(l.amount) >= 0 ? 'text-emerald-600' : 'text-rose-600'">
              {{ Number(l.amount) >= 0 ? '+' : '' }}{{ l.amount }}
            </td>
            <td class="py-2 px-2">{{ l.balance }}</td>
            <td class="py-2 px-2">{{ l.note }}</td>
            <td class="py-2 px-2 text-gray-500">{{ new Date(l.createdAt).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
