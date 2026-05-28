<script setup lang="ts">
import { onMounted, ref } from 'vue';
import api from '@/api';
import { useUserStore } from '@/stores/user';
import { statusOf } from '@/utils/order-status';

const user = useUserStore();
const orders = ref<any[]>([]);
const logs = ref<any[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    // 并行拉取本地订单 + 三方订单 + 余额明细
    const [local, forge, lg] = await Promise.all([
      api.myOrders({ page: 1, pageSize: 20 }) as Promise<any>,
      api.myForgeOrders({ page: 1, pageSize: 20 }).catch(() => ({ items: [] })),
      api.balanceLogs({ page: 1, pageSize: 20 }),
    ]);

    const localItems = (local.items || []).map((o: any) => ({
      source: 'LOCAL' as const,
      orderNo: o.orderNo,
      title: o.productTitle,
      sub: o.skuName,
      qty: o.quantity,
      amount: o.totalAmount,
      status: o.status,
      createdAt: o.createdAt,
      detailRoute: `/order/${o.orderNo}`,
    }));
    const forgeItems = (forge.items || []).map((o: any) => ({
      source: 'FORGE' as const,
      orderNo: o.orderNo,
      title: o.typeName,
      sub: o.paymentMethod === 'REDEEM' ? '兑换码' : '支付宝',
      qty: o.quantity,
      amount: o.totalAmount,
      status: o.status,
      createdAt: o.createdAt,
      detailRoute: `/forge-order/${o.orderNo}`,
    }));

    orders.value = [...localItems, ...forgeItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    logs.value = lg as any;
  } finally {
    loading.value = false;
  }
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
          <div class="text-xs text-gray-500 flex items-center justify-end gap-1">
            账户余额
            <span class="text-[10px] text-ink-400" title="如需充值请联系客服">ⓘ</span>
          </div>
          <div class="text-xl font-bold text-rose-600">¥{{ user.profile?.balance ?? 0 }}</div>
          <div v-if="Number(user.profile?.balance) <= 0" class="text-[11px] text-ink-400 mt-0.5">
            需充值请联系客服
          </div>
        </div>
      </div>
    </div>

    <div class="card p-6">
      <h2 class="font-semibold mb-3">我的订单</h2>
      <div v-if="loading" class="text-sm text-gray-400 text-center py-8">加载中...</div>
      <div v-else-if="!orders.length" class="text-sm text-gray-400 text-center py-8">暂无订单</div>
      <table v-else class="w-full text-sm">
        <thead class="text-gray-500 text-xs">
          <tr>
            <th class="text-left py-2 px-2">订单号</th>
            <th class="text-left py-2 px-2">商品</th>
            <th class="text-right py-2 px-2">数量</th>
            <th class="text-right py-2 px-2">金额</th>
            <th class="text-left py-2 px-2 pl-3">状态</th>
            <th class="text-left py-2 px-2">时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in orders" :key="o.orderNo" class="border-t">
            <td class="py-2 px-2">
              <router-link :to="o.detailRoute" class="text-brand-600 hover:underline font-mono text-xs">
                {{ o.orderNo }}
              </router-link>
              <span
                v-if="o.source === 'FORGE'"
                class="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-purple-50 text-purple-700"
              >三方</span>
            </td>
            <td class="py-2 px-2">
              <div class="text-ink-900">{{ o.title }}</div>
              <div v-if="o.sub" class="text-[11px] text-gray-400">{{ o.sub }}</div>
            </td>
            <td class="py-2 px-2 text-right text-ink-600">×{{ o.qty }}</td>
            <td class="py-2 px-2 text-right font-medium">¥{{ Number(o.amount).toFixed(2) }}</td>
            <td class="py-2 px-2 pl-3">
              <span :class="['inline-block px-2 py-0.5 rounded text-[11px]', statusOf(o.status).cls]">
                {{ statusOf(o.status).text }}
              </span>
            </td>
            <td class="py-2 px-2 text-gray-500 text-xs">{{ new Date(o.createdAt).toLocaleString() }}</td>
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
