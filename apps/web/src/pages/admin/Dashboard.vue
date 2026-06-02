<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/api';
import { statusOf as statusInfo } from '@/utils/order-status';

const router = useRouter();
const data = ref<any>(null);
const recent = ref<any[]>([]);
const trend = ref<{ date: string; revenue: number; orders: number }[]>([]);
const alerts = ref<any[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    [data.value, recent.value, trend.value, alerts.value] = await Promise.all([
      api.admin.dashboard(),
      api.admin.recent(),
      api.admin.revenueTrend(14),
      api.admin.stockAlerts(5),
    ]);
  } finally {
    loading.value = false;
  }
});

const maxRevenue = computed(() => Math.max(1, ...trend.value.map((t) => t.revenue)));

function openOrder(orderNo: string) {
  router.push({ path: '/admin/orders', query: { orderNo } });
}

const kpis = computed(() => {
  if (!data.value) return [];
  const d = data.value;
  const b = d.order.breakdown || { local: {}, forge: {} };
  return [
    {
      label: '今日营收',
      value: `¥${Number(d.order.todayRevenue || 0).toLocaleString()}`,
      hint: `本站 ¥${Number(b.local.todayRevenue || 0).toFixed(0)} · 三方 ¥${Number(b.forge.todayRevenue || 0).toFixed(0)} · 近 7 日 ¥${Number(d.order.weekRevenue || 0).toLocaleString()}`,
      tone: 'brand',
    },
    {
      label: '今日订单',
      value: d.order.today,
      hint: `已支付 ${d.order.todayPaid}（本站 ${b.local.today || 0} · 三方 ${b.forge.today || 0}）`,
      tone: 'ink',
    },
    {
      label: '待处理',
      value: d.order.pendingDeliver,
      hint: d.order.pendingDeliver > 0
        ? `本站 ${b.local.pendingDeliver || 0} · 三方 ${b.forge.pendingDeliver || 0}`
        : '已清空',
      tone: d.order.pendingDeliver > 0 ? 'warn' : 'ink',
    },
    {
      label: '可用卡密',
      value: d.cardKey.available,
      hint: `占总量 ${d.cardKey.total ? Math.round((d.cardKey.available / d.cardKey.total) * 100) : 0}%`,
      tone: d.cardKey.available < 10 ? 'warn' : 'ink',
    },
  ];
});

const meta = computed(() => {
  if (!data.value) return [];
  const d = data.value;
  return [
    { label: '在售商品', value: `${d.product.onSale} / ${d.product.total}` },
    { label: '注册用户', value: d.user.total },
    { label: '号池账号', value: d.pool.accounts },
  ];
});

function statusOf(s: string) {
  const info = statusInfo(s);
  return { text: info.text, cls: info.borderCls };
}

function fmtTime(t: string | Date) {
  const d = new Date(t);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return d.toLocaleDateString();
}
</script>

<template>
  <div class="flex items-center justify-between mb-5">
    <div>
      <h1 class="text-xl font-semibold text-ink-900">概览</h1>
      <p class="text-xs text-ink-500 mt-0.5">业务运行状态一览</p>
    </div>
  </div>

  <div v-if="loading" class="text-center py-20 text-ink-400 text-sm">加载中...</div>

  <template v-else>
    <!-- KPI cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div
        v-for="k in kpis"
        :key="k.label"
        class="card p-5"
      >
        <div class="flex items-start justify-between">
          <div class="text-xs text-ink-500">{{ k.label }}</div>
          <span
            v-if="k.tone === 'brand'"
            class="w-2 h-2 rounded-full bg-brand-500"
          ></span>
          <span
            v-else-if="k.tone === 'warn'"
            class="w-2 h-2 rounded-full bg-amber-500"
          ></span>
        </div>
        <div class="mt-3 text-2xl font-semibold tracking-tight"
          :class="k.tone === 'brand' ? 'text-brand-700' : k.tone === 'warn' ? 'text-amber-700' : 'text-ink-900'"
        >
          {{ k.value }}
        </div>
        <div class="mt-1 text-[11px] text-ink-400">{{ k.hint }}</div>
      </div>
    </div>

    <!-- Side stats -->
    <div class="mt-3 card p-4 grid grid-cols-3 gap-y-2 sm:divide-x sm:divide-ink-100">
      <div
        v-for="m in meta"
        :key="m.label"
        class="px-2 sm:px-4 sm:first:pl-2 sm:last:pr-2"
      >
        <div class="text-xs text-ink-500">{{ m.label }}</div>
        <div class="mt-1 text-lg font-medium text-ink-900">{{ m.value }}</div>
      </div>
    </div>

    <!-- Trend + Stock alerts -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-5">
      <!-- Trend chart -->
      <div class="card p-5 lg:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="font-semibold text-ink-900">近 14 日营收</h2>
            <p class="text-xs text-ink-400 mt-0.5">本站 + 三方合计，仅含已支付 / 已发货</p>
          </div>
          <div class="text-right text-xs text-ink-500">
            合计 <span class="text-ink-900 font-semibold">¥{{ trend.reduce((s, t) => s + t.revenue, 0).toLocaleString() }}</span>
          </div>
        </div>
        <div v-if="!trend.length" class="text-center py-10 text-sm text-ink-400">暂无数据</div>
        <div v-else class="flex items-stretch justify-between gap-1 h-40 px-1">
          <div
            v-for="(t, i) in trend"
            :key="i"
            class="flex-1 flex flex-col items-center justify-end group h-full"
          >
            <div
              :title="`${t.date}：¥${t.revenue.toFixed(2)} / ${t.orders} 单`"
              :class="[
                'w-full rounded-t transition-colors',
                t.revenue > 0 ? 'bg-brand-500 group-hover:bg-brand-600' : 'bg-ink-100',
              ]"
              :style="{ height: `${Math.max(2, (t.revenue / maxRevenue) * 90)}%` }"
            />
            <div class="text-[9px] text-ink-400 mt-1 leading-none">{{ t.date.slice(5) }}</div>
          </div>
        </div>
      </div>

      <!-- Stock alerts -->
      <div class="card p-5">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h2 class="font-semibold text-ink-900">库存预警</h2>
            <p class="text-xs text-ink-400 mt-0.5">可售 &lt; 5 的在售规格</p>
          </div>
          <router-link to="/admin/card-keys" class="text-xs text-ink-500 hover:text-brand-700">补货 →</router-link>
        </div>
        <div v-if="!alerts.length" class="text-center py-10 text-sm text-ink-400">
          全部规格库存充足
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="a in alerts"
            :key="a.skuId"
            class="flex items-center justify-between py-1.5 border-b border-ink-100 last:border-0"
          >
            <div class="min-w-0 flex-1">
              <div class="text-sm text-ink-800 truncate">{{ a.productTitle }}</div>
              <div class="text-[11px] text-ink-400 truncate">{{ a.skuName }}</div>
            </div>
            <div
              class="text-sm font-semibold ml-2 px-2 py-0.5 rounded"
              :class="a.available === 0 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'"
            >
              {{ a.available }}
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Recent orders -->
    <div class="card p-5 mt-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-ink-900">最近订单</h2>
        <router-link to="/admin/orders" class="text-xs text-ink-500 hover:text-brand-700">查看全部 →</router-link>
      </div>

      <div v-if="!recent.length" class="text-center py-10 text-sm text-ink-400">暂无订单</div>

      <div v-else class="overflow-x-auto -mx-1 px-1">
      <table class="w-full text-sm min-w-[720px]">
        <thead>
          <tr class="text-ink-400 text-[11px] uppercase tracking-wider">
            <th class="text-left font-medium py-2 px-2">订单号</th>
            <th class="text-left font-medium py-2 px-2">商品</th>
            <th class="text-left font-medium py-2 px-2">规格</th>
            <th class="text-right font-medium py-2 px-2">金额</th>
            <th class="text-left font-medium py-2 px-2 pl-4">状态</th>
            <th class="text-right font-medium py-2 px-2">时间</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="o in recent"
            :key="o.id"
            class="border-t border-ink-100 hover:bg-ink-50/60 transition-colors cursor-pointer"
            @click="openOrder(o.orderNo)"
          >
            <td class="py-2.5 px-2 font-mono text-xs text-ink-600" :title="o.orderNo">
              <span class="hidden xl:inline">{{ o.orderNo }}</span>
              <span class="xl:hidden">…{{ o.orderNo.slice(-12) }}</span>
            </td>
            <td class="py-2.5 px-2 max-w-[280px] truncate text-ink-800">{{ o.productTitle }}</td>
            <td class="py-2.5 px-2 text-ink-500">{{ o.skuName }}</td>
            <td class="py-2.5 px-2 text-right font-medium text-ink-900">¥{{ o.totalAmount }}</td>
            <td class="py-2.5 px-2 pl-4">
              <span class="inline-flex px-2 py-0.5 rounded-md text-[11px] border" :class="statusOf(o.status).cls">
                {{ statusOf(o.status).text }}
              </span>
            </td>
            <td class="py-2.5 px-2 text-right text-ink-400 text-xs">{{ fmtTime(o.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  </template>
</template>
