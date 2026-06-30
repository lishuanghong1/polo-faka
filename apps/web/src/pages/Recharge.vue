<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import { useUserStore } from '@/stores/user';
import { useSiteStore } from '@/stores/site';
import { statusOf } from '@/utils/order-status';
import EmptyState from '@/components/EmptyState.vue';
import Skeleton from '@/components/Skeleton.vue';
import { formatRelative, formatMoneyRaw } from '@/utils/format';

const route = useRoute();
const userStore = useUserStore();
const siteStore = useSiteStore();

const customerContacts = computed(() => [
  { label: '客服微信', value: siteStore.settings.cs_wechat || '' },
  { label: '客服 QQ', value: siteStore.settings.cs_qq || '' },
  { label: 'Telegram', value: siteStore.settings.cs_telegram || '' },
].filter((item) => item.value));

async function copyCustomerContact(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    ElMessage.success(`${label}已复制`);
  } catch {
    ElMessage.error('复制失败，请手动复制');
  }
}

const history = ref<any[]>([]);
const loadingHist = ref(false);

const checkingOrder = ref<{ orderNo: string; status: string; amount?: number } | null>(null);

async function loadHistory() {
  loadingHist.value = true;
  try {
    const r = await api.recharge.listMine({ page: 1, pageSize: 10 });
    history.value = r.items;
  } catch {
    history.value = [];
  } finally {
    loadingHist.value = false;
  }
}

async function checkOrder(orderNo: string) {
  try {
    const r = await api.recharge.detail(orderNo);
    checkingOrder.value = { orderNo: r.orderNo, status: r.status, amount: r.amount };
    if (r.status === 'PAID') {
      ElMessage.success(`充值成功：+¥${r.amount.toFixed(2)}`);
      await userStore.restore();
      loadHistory();
    } else if (r.status === 'PENDING') {
      ElMessage.info('订单仍在支付中，请稍候');
    } else {
      ElMessage.info(`订单状态：${statusOf(r.status).text}`);
    }
  } catch {
    ElMessage.error('查询失败');
  }
}

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

onMounted(async () => {
  if (userStore.isLoggedIn) {
    loadHistory();
    const urlOrder = route.params.orderNo as string | undefined;
    const sessionOrder = sessionStorage.getItem('lastRechargeOrder');
    const orderNo = urlOrder || sessionOrder;
    if (orderNo) {
      sessionStorage.removeItem('lastRechargeOrder');
      checkOrder(orderNo);
    }
  }
});
</script>

<template>
  <div class="max-w-xl mx-auto px-4 py-6 md:py-10 space-y-4">
    <!-- 标题 -->
    <div>
      <h1 class="text-2xl font-semibold tracking-tight text-ink-900">账户充值</h1>
      <p class="text-sm text-ink-500 mt-1">余额可用于购买商城内商品，充值请联系客服处理</p>
    </div>

    <!-- 余额条 -->
    <div class="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/80 to-emerald-50/30 p-4 md:p-5 flex items-center justify-between gap-3">
      <div>
        <div class="text-xs text-brand-700/80 mb-1">当前余额</div>
        <div class="text-2xl md:text-3xl font-bold tracking-tight text-ink-900 leading-none">
          <span class="text-sm font-normal text-ink-400 mr-0.5">¥</span>{{ formatMoneyRaw(userStore.profile?.balance) }}
        </div>
      </div>
      <div class="text-[11px] text-ink-500 text-right leading-relaxed max-w-[160px]">
        客服人工充值<br/>到账后即可使用
      </div>
    </div>

    <!-- 客服充值 -->
    <div class="card p-5 md:p-6">
      <div class="flex items-start gap-3">
        <div class="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 5h16v11H8l-4 3V5z" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <div>
          <h2 class="text-base font-semibold text-ink-900">自助充值入口已关闭</h2>
          <p class="text-sm text-ink-600 mt-1 leading-relaxed">
            账户余额仅支持通过客服充值。请联系下方客服并提供您的用户名和充值金额，客服确认后会直接为账户入账。
          </p>
        </div>
      </div>

      <div v-if="customerContacts.length" class="mt-5 grid gap-2 sm:grid-cols-2">
        <button
          v-for="item in customerContacts"
          :key="item.label"
          type="button"
          class="px-3 py-2.5 rounded-xl border border-ink-200 hover:border-brand-300 hover:bg-brand-50/30 text-left transition"
          @click="copyCustomerContact(item.value, item.label)"
        >
          <div class="text-[11px] text-ink-400">{{ item.label }}</div>
          <div class="text-sm font-medium text-ink-900 mt-0.5 truncate">{{ item.value }}</div>
          <div class="text-[10px] text-brand-600 mt-1">点击复制</div>
        </button>
      </div>
      <div v-else class="mt-5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
        暂未配置客服联系方式，请通过网站公告中的联系方式咨询充值。
      </div>
    </div>

    <!-- 最近订单状态浮条 -->
    <div
      v-if="checkingOrder"
      class="rounded-xl border bg-gradient-to-br p-4 flex items-center gap-3"
      :class="checkingOrder.status === 'PAID'
        ? 'from-brand-50 to-emerald-50/30 border-brand-200'
        : checkingOrder.status === 'PENDING'
          ? 'from-amber-50 to-orange-50/30 border-amber-200'
          : 'from-ink-50 to-white border-ink-200'"
    >
      <div
        class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        :class="checkingOrder.status === 'PAID'
          ? 'bg-brand-100 text-brand-700'
          : 'bg-ink-100 text-ink-500'"
      >
        <svg v-if="checkingOrder.status === 'PAID'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-ink-900">
          {{ checkingOrder.status === 'PAID' ? '充值成功' : '订单状态：' + statusOf(checkingOrder.status).text }}
        </div>
        <div class="text-[11px] text-ink-500 mt-0.5 font-mono truncate">{{ checkingOrder.orderNo }}</div>
      </div>
    </div>

    <!-- 充值记录 -->
    <div v-if="userStore.isLoggedIn" class="card p-5 md:p-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-ink-900 flex items-center gap-2">
          <span class="w-1 h-4 bg-brand-600 rounded-full" />
          最近充值
        </h2>
        <button class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded transition" @click="loadHistory">
          刷新
        </button>
      </div>

      <template v-if="loadingHist">
        <div class="space-y-2">
          <Skeleton v-for="i in 3" :key="i" variant="line" height="44px" />
        </div>
      </template>

      <EmptyState
        v-else-if="!history.length"
        icon="wallet"
        title="暂无充值记录"
        compact
      />

      <ul v-else class="divide-y divide-ink-100 -mx-2">
        <li
          v-for="o in history"
          :key="o.orderNo"
          class="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-ink-50/50 cursor-pointer transition"
          @click="checkOrder(o.orderNo)"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span
                class="inline-flex h-5 px-1.5 items-center text-[10px] rounded border whitespace-nowrap"
                :class="rechargeStatusInfo(o.status).cls"
              >{{ rechargeStatusInfo(o.status).text }}</span>
              <span class="text-[11px] text-ink-400 font-mono truncate">{{ o.orderNo }}</span>
            </div>
            <div class="text-[11px] text-ink-400 mt-0.5">{{ formatRelative(o.createdAt) }}</div>
          </div>
          <div
            class="font-semibold text-sm shrink-0"
            :class="o.status === 'PAID' ? 'text-emerald-600' : 'text-ink-700'"
          >
            <span v-if="o.status === 'PAID'">+</span><span class="text-xs font-normal">¥</span>{{ formatMoneyRaw(o.amount) }}
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
