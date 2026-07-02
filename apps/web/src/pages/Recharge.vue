<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import { useUserStore } from '@/stores/user';
import { statusOf } from '@/utils/order-status';
import BrandButton from '@/components/BrandButton.vue';
import EmptyState from '@/components/EmptyState.vue';
import Skeleton from '@/components/Skeleton.vue';
import { formatRelative, formatMoneyRaw } from '@/utils/format';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const presetAmounts = [10, 30, 50, 100, 200, 500];

const amount = ref<number>(50);
const customAmount = ref<string>('');
const alipayEnabled = ref(false);
const submitting = ref(false);

const history = ref<any[]>([]);
const loadingHist = ref(false);

const checkingOrder = ref<{ orderNo: string; status: string; amount?: number } | null>(null);

const finalAmount = computed(() => {
  const raw = String(customAmount.value ?? '').trim();
  const v = raw ? Number(raw) : amount.value;
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
});

const canSubmit = computed(() =>
  alipayEnabled.value && finalAmount.value >= 0.01 && finalAmount.value <= 10000,
);

const customAmountInvalid = computed(() => {
  const raw = String(customAmount.value ?? '').trim();
  if (!raw) return false;
  const v = Number(raw);
  return !Number.isFinite(v) || v < 0.01 || v > 10000;
});

function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

async function loadEnabled() {
  try {
    const r = await api.pay.alipayEnabled();
    alipayEnabled.value = !!r.enabled;
  } catch {
    alipayEnabled.value = false;
  }
}

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

async function submit() {
  if (!canSubmit.value) return;
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录');
    router.push({ name: 'login', query: { redirect: route.fullPath } });
    return;
  }
  submitting.value = true;
  try {
    const order = await api.recharge.create(finalAmount.value);
    const channel = isMobile() ? 'WAP' : 'PC';
    const { payUrl } = await api.pay.alipayCreate(order.orderNo, channel);
    sessionStorage.setItem('lastRechargeOrder', order.orderNo);
    window.location.href = payUrl;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.message || '创建充值订单失败');
  } finally {
    submitting.value = false;
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
  await loadEnabled();
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
      <p class="text-sm text-ink-500 mt-1">余额可用于购买商城内任意商品，支持小额自定义</p>
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
        充值订单 15 分钟内有效<br/>到账实时
      </div>
    </div>

    <!-- 充值表单 -->
    <div class="card p-5 md:p-6">
      <!-- 预设金额 -->
      <div>
        <div class="text-sm font-medium text-ink-900 mb-2.5 flex items-center justify-between">
          <span>选择金额</span>
          <span class="text-[11px] text-ink-400 font-normal">单笔 0.01 - 10,000</span>
        </div>
        <div class="grid grid-cols-3 gap-2.5">
          <button
            v-for="v in presetAmounts"
            :key="v"
            type="button"
            class="relative h-14 rounded-xl border-2 text-base font-semibold transition group"
            :class="!customAmount && amount === v
              ? 'border-brand-500 bg-brand-50/60 text-brand-700'
              : 'border-ink-200 text-ink-700 hover:border-brand-300 hover:bg-brand-50/30'"
            @click="amount = v; customAmount = ''"
          >
            <span class="text-xs text-ink-400 font-normal mr-0.5"
              :class="!customAmount && amount === v ? 'text-brand-600/80' : ''"
            >¥</span>{{ v }}
            <!-- 选中标记 -->
            <span
              v-if="!customAmount && amount === v"
              class="absolute top-1 right-1 w-4 h-4 rounded-full bg-brand-600 text-white flex items-center justify-center"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="w-2.5 h-2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      <!-- 自定义金额 -->
      <div class="mt-4">
        <div class="text-sm font-medium text-ink-900 mb-1.5">自定义金额</div>
        <div class="relative">
          <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400">¥</span>
          <input
            v-model="customAmount"
            type="number"
            min="0.01"
            max="10000"
            step="0.01"
            placeholder="输入金额（0.01 - 10000）"
            class="w-full pl-8 pr-4 py-2.5 border-2 rounded-xl text-sm focus:outline-none transition"
            :class="customAmountInvalid
              ? 'border-rose-300 bg-rose-50/30 focus:border-rose-500'
              : customAmount
                ? 'border-brand-400 bg-brand-50/30'
                : 'border-ink-200 focus:border-brand-400 focus:bg-brand-50/20'"
          />
        </div>
        <div v-if="customAmountInvalid" class="text-[11px] text-rose-600 mt-1.5">
          金额需在 0.01 ~ 10,000 之间
        </div>
      </div>

      <!-- 实付 -->
      <div class="mt-5 flex items-center justify-between p-3.5 rounded-xl bg-ink-50/70 border border-ink-100">
        <span class="text-sm text-ink-500">实付金额</span>
        <span class="text-2xl font-bold text-ink-900">
          <span class="text-sm font-normal text-ink-400 mr-0.5">¥</span>{{ finalAmount.toFixed(2) }}
        </span>
      </div>

      <BrandButton
        class="mt-4"
        variant="primary"
        size="lg"
        block
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      >
        <svg v-if="!submitting && alipayEnabled" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
          <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
        </svg>
        {{
          submitting
            ? '创建订单中…'
            : alipayEnabled
              ? '使用支付宝充值'
              : '支付宝暂未启用'
        }}
      </BrandButton>

      <div v-if="!alipayEnabled" class="mt-2.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
        当前支付通道暂未启用，请稍后再试或联系客服
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
