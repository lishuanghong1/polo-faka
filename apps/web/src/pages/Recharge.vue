<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import { useUserStore } from '@/stores/user';
import { statusOf } from '@/utils/order-status';

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

const checkingOrder = ref<{ orderNo: string; status: string } | null>(null);

const finalAmount = computed(() => {
  const v = customAmount.value.trim() ? Number(customAmount.value) : amount.value;
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
});

const canSubmit = computed(() =>
  alipayEnabled.value && finalAmount.value >= 0.01 && finalAmount.value <= 10000,
);

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
    // 在跳转前记录订单号，便于返回后查询
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
    checkingOrder.value = { orderNo: r.orderNo, status: r.status };
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

onMounted(async () => {
  await loadEnabled();
  if (userStore.isLoggedIn) {
    loadHistory();
    // 路由参数里有 orderNo（return URL 跳过来）→ 主动查一下
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
  <div class="max-w-xl mx-auto px-4 py-10">
    <div class="card p-6">
      <h1 class="text-xl font-semibold text-ink-900">账户充值</h1>
      <p class="text-sm text-ink-500 mt-1">充值到您的账户余额，可用于购买站内任何商品。</p>

      <div class="mt-5 flex items-center justify-between p-3 rounded-lg bg-ink-50 border border-ink-100">
        <div class="text-sm text-ink-500">当前账户余额</div>
        <div class="text-xl font-bold text-rose-600">
          ¥{{ Number(userStore.profile?.balance ?? 0).toFixed(2) }}
        </div>
      </div>

      <div class="mt-6">
        <div class="text-sm text-ink-700 mb-2">选择金额</div>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="v in presetAmounts"
            :key="v"
            type="button"
            :class="[
              'py-2.5 rounded-lg border-2 text-sm font-medium transition',
              !customAmount && amount === v
                ? 'border-brand-500 bg-brand-50/40 text-brand-700'
                : 'border-ink-200 hover:border-ink-300',
            ]"
            @click="amount = v; customAmount = ''"
          >¥{{ v }}</button>
        </div>
      </div>

      <div class="mt-3">
        <div class="text-sm text-ink-700 mb-1">自定义金额</div>
        <div class="flex items-center gap-2">
          <span class="text-ink-500">¥</span>
          <input
            v-model="customAmount"
            type="number"
            min="0.01"
            max="10000"
            step="0.01"
            placeholder="0.01 ~ 10000"
            class="flex-1 px-3 py-2.5 border border-ink-200 rounded-lg text-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
          />
        </div>
        <div class="text-[11px] text-ink-400 mt-1">单笔限额 ¥10,000，支持小数</div>
      </div>

      <div class="mt-5 p-3 rounded-lg bg-ink-50 border border-ink-100">
        <div class="flex items-center justify-between text-sm">
          <span class="text-ink-500">实付金额</span>
          <span class="text-2xl font-bold brand-gradient-text">¥{{ finalAmount.toFixed(2) }}</span>
        </div>
      </div>

      <button
        class="mt-5 w-full py-3 rounded-lg brand-gradient text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
        :disabled="!canSubmit || submitting"
        @click="submit"
      >
        {{ submitting ? '创建订单中…' : alipayEnabled ? '使用支付宝充值' : '支付宝暂未启用' }}
      </button>

      <div class="mt-3 text-[11px] text-ink-400 leading-relaxed">
        充值订单 15 分钟内有效；到账实时；如长时间未到账，可联系客服。
      </div>
    </div>

    <!-- 检测刚才支付完的订单 -->
    <div v-if="checkingOrder" class="mt-4 card p-4 bg-emerald-50/60 border-emerald-200">
      <div class="text-sm">
        最近订单 <span class="font-mono">{{ checkingOrder.orderNo }}</span> 当前状态：
        <span class="font-semibold">{{ statusOf(checkingOrder.status).text }}</span>
      </div>
    </div>

    <!-- 充值记录 -->
    <div v-if="userStore.isLoggedIn" class="card p-6 mt-4">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">最近充值</h2>
        <button class="text-xs text-brand-600 hover:underline" @click="loadHistory">刷新</button>
      </div>
      <div v-if="loadingHist" class="text-sm text-gray-400 text-center py-6">加载中...</div>
      <div v-else-if="!history.length" class="text-sm text-gray-400 text-center py-6">暂无充值记录</div>
      <table v-else class="w-full text-sm mt-3">
        <thead class="text-gray-500 text-xs">
          <tr>
            <th class="text-left py-2 px-2">订单号</th>
            <th class="text-right py-2 px-2">金额</th>
            <th class="text-left py-2 px-2 pl-3">状态</th>
            <th class="text-left py-2 px-2">时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in history" :key="o.orderNo" class="border-t">
            <td class="py-2 px-2 font-mono text-xs">
              <button class="text-brand-600 hover:underline" @click="checkOrder(o.orderNo)">{{ o.orderNo }}</button>
            </td>
            <td class="py-2 px-2 text-right font-medium">¥{{ o.amount.toFixed(2) }}</td>
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
  </div>
</template>
