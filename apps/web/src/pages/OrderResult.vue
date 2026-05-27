<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import { useSiteStore } from '@/stores/site';
import { formatCardKeyContent, formatCardKeysForCopy } from '@/utils/card-key';

const route = useRoute();
const site = useSiteStore();
const order = ref<any>(null);
const loading = ref(true);
let timer: any = null;

const wechat = computed(() => site.settings.cs_wechat || 'ymw_polo');
const qq = computed(() => site.settings.cs_qq || '');
const telegram = computed(() => site.settings.cs_telegram || '');

/** PAID/DELIVERED 但没有任何卡密发出来 → 显示联系卡片 */
const needContactSupport = computed(() => {
  if (!order.value) return false;
  if (!['PAID', 'DELIVERED'].includes(order.value.status)) return false;
  return !order.value.cardKeys?.length;
});

async function load() {
  try {
    order.value = await api.orderQuery(route.params.orderNo as string);
  } finally {
    loading.value = false;
  }
}

const paying = ref(false);
async function goPay() {
  if (!order.value || paying.value) return;
  paying.value = true;
  try {
    const channel = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'WAP' : 'PC';
    const r = await api.pay.alipayCreate(order.value.orderNo, channel);
    window.location.href = r.payUrl;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '获取支付链接失败');
    paying.value = false;
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
  const all = formatCardKeysForCopy(order.value.cardKeys || []);
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
              class="p-3 bg-gray-50 rounded-lg flex items-start justify-between gap-3"
            >
              <code class="text-sm text-gray-700 break-all whitespace-pre-wrap">{{ formatCardKeyContent(c.content) }}</code>
              <button class="text-xs text-brand-600 hover:underline shrink-0" @click="copy(formatCardKeyContent(c.content))">复制</button>
            </li>
          </ul>
        </div>

        <div
          v-else-if="needContactSupport"
          class="mt-6 p-4 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/40"
        >
          <div class="flex items-center gap-2 mb-2">
            <svg class="w-5 h-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/>
            </svg>
            <h3 class="font-semibold text-amber-900">该商品暂无库存，请联系管理员发货</h3>
          </div>
          <p class="text-sm text-amber-800 mb-3 leading-relaxed">
            您已付款成功，订单号 <code class="font-mono bg-white/70 px-1.5 py-0.5 rounded text-amber-900">{{ order.orderNo }}</code>。
            管理员会在工作时间尽快人工为您发货。
          </p>

          <div class="bg-white/80 rounded-lg p-3 space-y-2 text-sm">
            <div class="flex items-center gap-2">
              <span class="w-16 text-ink-500 shrink-0">微信</span>
              <code class="font-mono text-ink-900 font-semibold">{{ wechat }}</code>
              <button
                class="ml-auto text-xs text-brand-600 hover:underline"
                @click="copy(wechat)"
              >复制微信号</button>
            </div>
            <div v-if="qq" class="flex items-center gap-2">
              <span class="w-16 text-ink-500 shrink-0">QQ</span>
              <code class="font-mono text-ink-900">{{ qq }}</code>
              <button class="ml-auto text-xs text-brand-600 hover:underline" @click="copy(qq)">复制</button>
            </div>
            <div v-if="telegram" class="flex items-center gap-2">
              <span class="w-16 text-ink-500 shrink-0">Telegram</span>
              <code class="font-mono text-ink-900">{{ telegram }}</code>
              <button class="ml-auto text-xs text-brand-600 hover:underline" @click="copy(telegram)">复制</button>
            </div>
          </div>

          <p class="mt-3 text-[11px] text-amber-700/80 leading-relaxed">
            联系时请提供订单号便于核单。如长时间未发货可申请原路退款。
          </p>
        </div>

        <div v-if="order.status === 'PENDING'" class="mt-6 flex justify-end">
          <button
            class="px-4 py-2 rounded-lg brand-gradient text-white text-sm disabled:opacity-50"
            :disabled="paying"
            @click="goPay"
          >
            {{ paying ? '正在跳转支付宝…' : '去支付' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
