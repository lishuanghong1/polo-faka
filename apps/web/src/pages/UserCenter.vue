<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import api from '@/api';
import { useUserStore } from '@/stores/user';
import { useRouter } from 'vue-router';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import EmptyState from '@/components/EmptyState.vue';
import Skeleton from '@/components/Skeleton.vue';
import BrandButton from '@/components/BrandButton.vue';
import {
  formatMoney,
  formatMoneyRaw,
  formatRelative,
  formatDateTime,
} from '@/utils/format';

const user = useUserStore();
const router = useRouter();

type Tab = 'orders' | 'recharges' | 'logs';
const tab = ref<Tab>('orders');

const orders = ref<any[]>([]);
const logs = ref<any[]>([]);
const recharges = ref<any[]>([]);
const loading = ref(false);

const initials = computed(() => {
  const n = user.profile?.nickname || user.profile?.username || '?';
  return n.slice(0, 1).toUpperCase();
});

async function load() {
  loading.value = true;
  try {
    const [local, forge, lg, rc] = await Promise.all([
      api.myOrders({ page: 1, pageSize: 20 }) as Promise<any>,
      api.myForgeOrders({ page: 1, pageSize: 20 }).catch(() => ({ items: [] })),
      api.balanceLogs({ page: 1, pageSize: 20 }) as Promise<any>,
      api.recharge.listMine({ page: 1, pageSize: 10 }).catch(() => ({ items: [] })) as Promise<any>,
    ]);

    const localItems = (local.items || []).map((o: any) => ({
      source: 'LOCAL' as const,
      orderNo: o.orderNo,
      title: o.productTitle,
      sub: o.skuName,
      qty: o.quantity,
      amount: o.totalAmount,
      payMethod: o.payMethod || 'ALIPAY',
      status: o.status,
      createdAt: o.createdAt,
      detailRoute: `/order/${o.orderNo}`,
    }));
    const forgeItems = (forge.items || []).map((o: any) => ({
      source: 'FORGE' as const,
      orderNo: o.orderNo,
      title: o.typeName,
      sub: o.skuName || '',
      qty: o.quantity,
      amount: o.totalAmount,
      payMethod: o.paymentMethod || 'ALIPAY',
      status: o.status,
      createdAt: o.createdAt,
      detailRoute: `/forge-order/${o.orderNo}`,
    }));

    orders.value = [...localItems, ...forgeItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    logs.value = Array.isArray(lg) ? lg : (lg?.items || []);
    recharges.value = rc?.items || [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const payMethodLabel = (m: string) => {
  switch ((m || '').toUpperCase()) {
    case 'ALIPAY': return '支付宝';
    case 'BALANCE': return '账户余额';
    case 'REDEEM': return '兑换码';
    case 'MOCK': return '测试支付';
    default: return m || '-';
  }
};

const balanceLogTypeLabel = (t: string) => {
  switch ((t || '').toUpperCase()) {
    case 'RECHARGE': return '充值';
    case 'CONSUME':  return '消费';
    case 'REFUND':   return '退款';
    case 'ADJUST':   return '调整';
    default:         return t || '-';
  }
};

const rechargeStatusInfo = (s: string) => {
  switch ((s || '').toUpperCase()) {
    case 'PAID':      return { text: '已到账', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'PENDING':   return { text: '待支付', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'EXPIRED':   return { text: '已超时', cls: 'bg-ink-100 text-ink-500 border-ink-200' };
    case 'CANCELLED': return { text: '已取消', cls: 'bg-ink-100 text-ink-500 border-ink-200' };
    case 'REFUNDED':  return { text: '已退款', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
    default:          return { text: s || '-', cls: 'bg-ink-100 text-ink-500 border-ink-200' };
  }
};

function go(route: string) { router.push(route); }
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-6 md:py-10 space-y-4">
    <!-- ────── Hero：用户 + 余额 ────── -->
    <div
      class="card overflow-hidden relative"
    >
      <!-- 装饰背景 -->
      <div class="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-brand-50/80 blur-3xl pointer-events-none" />
      <div class="absolute -bottom-20 -left-10 w-44 h-44 rounded-full bg-amber-50/60 blur-3xl pointer-events-none" />

      <div class="relative p-5 md:p-7">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 md:w-14 md:h-14 rounded-xl bg-brand-600 text-white text-lg md:text-xl font-semibold flex items-center justify-center shadow-sm shrink-0">
            {{ initials }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-ink-900 truncate">
              {{ user.profile?.nickname || user.profile?.username }}
            </div>
            <div class="text-xs text-ink-500 truncate">
              {{ user.profile?.email || '未绑定邮箱' }}
            </div>
          </div>
        </div>

        <!-- 余额行 -->
        <div class="mt-5 md:mt-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div class="text-xs text-ink-500 mb-1 flex items-center gap-1.5">
              账户余额
              <span class="w-1 h-1 rounded-full bg-ink-300" />
              <span class="text-ink-400">可用于商城下单</span>
            </div>
            <div class="text-3xl md:text-4xl font-bold tracking-tight text-ink-900 leading-none">
              <span class="text-base font-normal text-ink-400 mr-0.5">¥</span>{{ formatMoneyRaw(user.profile?.balance) }}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <BrandButton variant="primary" size="md" @click="go('/recharge')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              充值
            </BrandButton>
            <BrandButton variant="secondary" size="md" @click="tab = 'logs'">
              明细
            </BrandButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ────── Tab 切换 ────── -->
    <div class="card p-1.5 inline-flex w-full sm:w-auto">
      <button
        v-for="t in [
          { k: 'orders', label: '我的订单', n: orders.length },
          { k: 'recharges', label: '充值记录', n: recharges.length },
          { k: 'logs', label: '余额明细', n: logs.length },
        ]"
        :key="t.k"
        class="flex-1 sm:flex-none px-4 py-1.5 text-sm rounded-lg transition whitespace-nowrap"
        :class="tab === t.k
          ? 'bg-brand-50 text-brand-700 font-medium'
          : 'text-ink-500 hover:text-ink-900 hover:bg-ink-50'"
        @click="tab = (t.k as Tab)"
      >
        {{ t.label }}
        <span v-if="t.n" class="ml-1 text-[11px] text-ink-400">{{ t.n }}</span>
      </button>
    </div>

    <!-- ────── 我的订单 ────── -->
    <div v-show="tab === 'orders'" class="space-y-2.5">
      <template v-if="loading">
        <Skeleton v-for="i in 4" :key="i" variant="orderRow" />
      </template>

      <div v-else-if="!orders.length" class="card">
        <EmptyState
          icon="receipt"
          title="还没有订单"
          hint="去首页选一款心仪的商品试试看～"
        >
          <template #action>
            <BrandButton variant="primary" size="sm" @click="go('/')">浏览商品</BrandButton>
          </template>
        </EmptyState>
      </div>

      <router-link
        v-else
        v-for="o in orders"
        :key="o.orderNo"
        :to="o.detailRoute"
        class="card card-hover block p-4"
      >
        <div class="flex items-start gap-3">
          <!-- 图标块 -->
          <div
            class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-base font-semibold"
            :class="o.source === 'FORGE'
              ? 'bg-violet-50 text-violet-600'
              : 'bg-brand-50 text-brand-700'"
          >
            {{ o.title?.slice(0, 1) || '商' }}
          </div>

          <!-- 中间主体 -->
          <div class="flex-1 min-w-0">
            <div class="flex items-start gap-2">
              <div class="font-medium text-ink-900 truncate flex-1">{{ o.title }}</div>
              <OrderStatusBadge :status="o.status" :dot="['PENDING','PAID'].includes(o.status)" />
            </div>
            <div class="mt-1 text-xs text-ink-500 flex items-center gap-1.5 flex-wrap">
              <span v-if="o.sub" class="truncate max-w-[180px]">{{ o.sub }}</span>
              <span v-if="o.sub" class="w-1 h-1 rounded-full bg-ink-300" />
              <span>×{{ o.qty }}</span>
              <span class="w-1 h-1 rounded-full bg-ink-300" />
              <span>{{ payMethodLabel(o.payMethod) }}</span>
            </div>
            <div class="mt-1 text-[11px] text-ink-400 flex items-center justify-between gap-2">
              <span class="font-mono truncate">{{ o.orderNo }}</span>
              <span class="shrink-0">{{ formatRelative(o.createdAt) }}</span>
            </div>
          </div>

          <!-- 价格 -->
          <div class="text-right shrink-0">
            <div class="font-semibold text-ink-900 leading-none">
              <span class="text-xs text-ink-400 font-normal">¥</span>{{ formatMoneyRaw(o.amount) }}
            </div>
          </div>
        </div>
      </router-link>
    </div>

    <!-- ────── 充值记录 ────── -->
    <div v-show="tab === 'recharges'" class="space-y-2.5">
      <template v-if="loading">
        <Skeleton v-for="i in 3" :key="i" variant="orderRow" />
      </template>

      <div v-else-if="!recharges.length" class="card">
        <EmptyState
          icon="wallet"
          title="暂无充值记录"
          hint="账户余额可用于购买商城内任意商品"
        >
          <template #action>
            <BrandButton variant="primary" size="sm" @click="go('/recharge')">立即充值</BrandButton>
          </template>
        </EmptyState>
      </div>

      <router-link
        v-else
        v-for="r in recharges"
        :key="r.orderNo"
        :to="`/recharge/${encodeURIComponent(r.orderNo)}`"
        class="card card-hover block p-4"
      >
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5">
              <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/>
              <path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/>
              <path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <div class="font-medium text-ink-900">余额充值</div>
              <span
                class="inline-flex h-6 px-2 items-center text-[11px] rounded-md border whitespace-nowrap"
                :class="rechargeStatusInfo(r.status).cls"
              >
                {{ rechargeStatusInfo(r.status).text }}
              </span>
            </div>
            <div class="mt-1 text-[11px] text-ink-400 flex items-center justify-between gap-2">
              <span class="font-mono truncate">{{ r.orderNo }}</span>
              <span class="shrink-0">{{ formatRelative(r.createdAt) }}</span>
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-semibold text-emerald-600 leading-none">
              +<span class="text-xs font-normal">¥</span>{{ formatMoneyRaw(r.amount) }}
            </div>
          </div>
        </div>
      </router-link>
    </div>

    <!-- ────── 余额明细 ────── -->
    <div v-show="tab === 'logs'" class="card">
      <template v-if="loading">
        <div class="divide-y divide-ink-100">
          <div v-for="i in 4" :key="i" class="p-4">
            <Skeleton variant="line" width="60%" />
          </div>
        </div>
      </template>

      <EmptyState
        v-else-if="!logs.length"
        icon="wallet"
        title="暂无余额明细"
        hint="充值、消费、退款都会记录在这里"
      />

      <ul v-else class="divide-y divide-ink-100">
        <li
          v-for="l in logs"
          :key="l.id"
          class="p-4 flex items-center gap-3"
        >
          <div
            class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-xs font-medium"
            :class="Number(l.amount) >= 0
              ? 'bg-emerald-50 text-emerald-600'
              : 'bg-rose-50 text-rose-600'"
          >
            <svg v-if="Number(l.amount) >= 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-ink-900">{{ balanceLogTypeLabel(l.type) }}</span>
              <span v-if="l.refOrder" class="text-[11px] text-ink-400 font-mono truncate">{{ l.refOrder }}</span>
            </div>
            <div v-if="l.note" class="text-xs text-ink-500 mt-0.5 truncate">{{ l.note }}</div>
            <div class="text-[11px] text-ink-400 mt-0.5">{{ formatDateTime(l.createdAt) }}</div>
          </div>
          <div class="text-right shrink-0">
            <div
              class="font-semibold leading-none"
              :class="Number(l.amount) >= 0 ? 'text-emerald-600' : 'text-rose-600'"
            >
              {{ Number(l.amount) >= 0 ? '+' : '-' }}<span class="text-xs font-normal">¥</span>{{ formatMoneyRaw(Math.abs(Number(l.amount))) }}
            </div>
            <div class="text-[11px] text-ink-400 mt-1">
              余额 {{ formatMoney(l.balance) }}
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
