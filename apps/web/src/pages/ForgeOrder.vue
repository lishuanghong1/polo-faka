<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import EmailCodeBox from '@/components/EmailCodeBox.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import BrandButton from '@/components/BrandButton.vue';
import Skeleton from '@/components/Skeleton.vue';
import { formatDateTime, formatMoneyRaw, copyText } from '@/utils/format';

const route = useRoute();
const router = useRouter();

const order = ref<any>(null);
const loading = ref(true);
const errorMsg = ref('');
const contactPrompt = ref('');
const needContact = ref(false);
let pollTimer: number | undefined;

const orderNo = computed(() => route.params.orderNo as string);

const primaryEmail = computed(() => {
  const first = order.value?.accounts?.[0];
  return first?.account_json?.email || first?.email || '';
});

const payMethodLabel = computed(() => {
  const m = (order.value?.paymentMethod || '').toUpperCase();
  if (m === 'ALIPAY') return '支付宝';
  if (m === 'BALANCE') return '账户余额';
  if (m === 'REDEEM') return '兑换码';
  return order.value?.paymentMethod || '-';
});

function isMobile() {
  return /Mobi|Android|iPhone/i.test(navigator.userAgent);
}

async function load(contact?: string) {
  try {
    const r: any = await api.forge.orderDetail(orderNo.value, contact);
    if (r && r.requireContact) {
      order.value = null; needContact.value = true; errorMsg.value = '';
    } else {
      order.value = r; needContact.value = false; errorMsg.value = '';
    }
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || '订单不存在';
    order.value = null;
    if (e?.response?.status === 404 && contact) {
      needContact.value = true;
      errorMsg.value = '联系方式不匹配，请重试';
    } else {
      errorMsg.value = msg;
    }
  } finally {
    loading.value = false;
  }
}

function checkContact() {
  if (!contactPrompt.value.trim()) return ElMessage.warning('请输入联系方式');
  loading.value = true;
  load(contactPrompt.value.trim());
}

async function copy(text: string, label = '已复制') {
  if (!text) return;
  const ok = await copyText(text);
  if (ok) ElMessage.success(label);
  else ElMessage.error('复制失败');
}

function copyAll() {
  const lines: string[] = [];
  for (const a of order.value?.accounts || []) {
    const email = a.account_json?.email || a.email;
    const token = a.account_json?.access_token;
    if (email) lines.push(`邮箱: ${email}`);
    if (token) lines.push(`Token: ${token}`);
    lines.push('---');
  }
  copy(lines.join('\n'), '已复制全部账号');
}

const paying = ref(false);
async function goPay() {
  if (paying.value) return;
  paying.value = true;
  try {
    const channel = isMobile() ? 'WAP' : 'PC';
    const { payUrl } = await api.pay.alipayCreate(orderNo.value, channel);
    window.location.href = payUrl;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '创建支付链接失败');
    paying.value = false;
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = window.setInterval(async () => {
    if (!order.value) return;
    if (['PENDING', 'PAID'].includes(order.value.status)) {
      try {
        const fresh = await api.forge.orderDetail(orderNo.value, order.value.contact || undefined);
        order.value = fresh;
      } catch { /* ignore */ }
    } else {
      stopPolling();
    }
  }, 3000);
}
function stopPolling() {
  if (pollTimer) { window.clearInterval(pollTimer); pollTimer = undefined; }
}

watch(
  () => order.value?.status,
  (s) => {
    if (s === 'PENDING' || s === 'PAID') startPolling();
    else stopPolling();
  },
);

onMounted(() => {
  const fromQuery = (route.query.contact as string | undefined)?.trim();
  if (fromQuery) {
    contactPrompt.value = fromQuery;
    return load(fromQuery);
  }
  return load();
});
onBeforeUnmount(stopPolling);

const statusHeroClass = computed(() => {
  const s = (order.value?.status || '').toUpperCase();
  switch (s) {
    case 'PENDING':   return 'from-amber-50 to-orange-50/30 border-amber-200';
    case 'PAID':      return 'from-sky-50 to-sky-50/30 border-sky-200';
    case 'DELIVERED': return 'from-brand-50 to-emerald-50/30 border-brand-200';
    case 'FAILED':
    case 'REFUNDED':  return 'from-rose-50 to-rose-50/30 border-rose-200';
    default:          return 'from-ink-50 to-white border-ink-200';
  }
});
</script>

<template>
  <section class="max-w-3xl mx-auto px-4 py-6 md:py-10">
    <!-- 加载骨架 -->
    <div v-if="loading" class="space-y-4">
      <div class="card p-6 space-y-3">
        <Skeleton variant="line" width="160px" height="20px" />
        <Skeleton variant="text" :rows="3" />
      </div>
      <div class="card p-6">
        <Skeleton variant="block" height="120px" />
      </div>
    </div>

    <!-- 需要联系方式 -->
    <div v-else-if="needContact" class="max-w-md mx-auto">
      <div class="card p-6 md:p-8">
        <div class="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-6 h-6">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 class="text-lg font-semibold text-ink-900">订单受保护</h2>
        <p class="text-sm text-ink-500 mt-1.5 leading-relaxed">
          该订单下单时填写过联系方式，请输入相同的手机/邮箱/QQ 才能查看发货内容。
        </p>
        <input
          v-model="contactPrompt"
          class="mt-5 w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition"
          placeholder="下单时填写的联系方式"
          @keydown.enter="checkContact"
        />
        <BrandButton class="mt-4" variant="primary" size="md" block @click="checkContact">查看订单</BrandButton>
        <div v-if="errorMsg" class="mt-3 text-sm text-rose-600">{{ errorMsg }}</div>
      </div>
    </div>

    <!-- 错误兜底 -->
    <div v-else-if="errorMsg && !order" class="card p-12 text-center">
      <div class="w-14 h-14 rounded-2xl bg-ink-50 text-ink-300 flex items-center justify-center mx-auto mb-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="w-7 h-7">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div class="text-ink-700 font-medium">{{ errorMsg }}</div>
      <BrandButton class="mt-4" variant="secondary" size="sm" @click="router.push('/')">返回首页</BrandButton>
    </div>

    <template v-else-if="order">
      <!-- ────── Hero 状态卡 ────── -->
      <div
        class="rounded-2xl border bg-gradient-to-br p-5 md:p-7 mb-4"
        :class="statusHeroClass"
      >
        <div class="flex items-center gap-3 mb-3 flex-wrap">
          <OrderStatusBadge :status="order.status" size="md" :dot="['PENDING','PAID'].includes(order.status)" />
          <span class="text-xs text-ink-500 font-mono truncate">{{ order.orderNo }}</span>
        </div>
        <div class="flex items-end justify-between gap-3 flex-wrap">
          <div class="min-w-0">
            <div class="text-xs text-ink-500 mb-1">
              {{ Number(order.discountAmount || 0) > 0 ? '实付金额' : '合计金额' }}
            </div>
            <div class="text-3xl md:text-4xl font-bold tracking-tight text-ink-900 leading-none">
              <span class="text-base font-normal text-ink-400 mr-0.5">¥</span>{{ formatMoneyRaw(order.payAmount ?? order.totalAmount) }}
            </div>
            <div v-if="Number(order.discountAmount || 0) > 0" class="mt-2 flex items-center gap-2 text-xs flex-wrap">
              <span class="text-ink-400 line-through">¥{{ formatMoneyRaw(order.totalAmount) }}</span>
              <span
                v-if="order.vipTier && order.vipTier !== 'NONE'"
                class="px-1.5 py-0.5 bg-rose-50 text-rose-600 rounded-md font-medium"
              >
                {{ order.vipTier === 'GOLD' ? '黄金' : order.vipTier === 'DIAMOND' ? '钻石' : '超级' }}会员立省 ¥{{ formatMoneyRaw(order.discountAmount) }}
              </span>
            </div>
          </div>
          <div v-if="order.status === 'PENDING'" class="shrink-0">
            <BrandButton variant="primary" size="md" :loading="paying" @click="goPay">
              {{ paying ? '正在跳转…' : '前往支付宝' }}
            </BrandButton>
          </div>
        </div>

        <!-- PAID：发货中 -->
        <div v-if="order.status === 'PAID'" class="mt-4 flex items-center gap-2.5 text-sm text-sky-800">
          <div class="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin shrink-0" />
          <span>付款已到账，正在为您出库…通常 3-10 秒完成</span>
        </div>

        <!-- 失败：原因 -->
        <div v-if="order.status === 'FAILED' && order.failReason" class="mt-4 text-sm text-rose-800">
          <div class="flex items-start gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 mt-0.5 shrink-0">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <div>
              <div class="font-medium">发货失败</div>
              <div class="text-xs mt-0.5 text-rose-700">{{ order.failReason }}</div>
              <div class="text-[11px] mt-1 text-rose-600/80">如已付款但未发货，请联系客服处理</div>
            </div>
          </div>
        </div>

        <!-- 待支付：过期时间 -->
        <div v-if="order.status === 'PENDING' && order.expireAt" class="mt-3 text-[11px] text-amber-700">
          请于 {{ formatDateTime(order.expireAt) }} 前完成支付，超时订单将自动取消
        </div>
      </div>

      <!-- ────── 订单信息 ────── -->
      <div class="card p-5 md:p-6 mb-4">
        <h3 class="text-sm font-semibold text-ink-900 mb-3 flex items-center gap-2">
          <span class="w-1 h-4 bg-brand-600 rounded-full" />
          订单信息
        </h3>
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-y-2.5 gap-x-6 text-sm">
          <div class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">商品</dt>
            <dd class="text-ink-900 text-right truncate">{{ order.typeName }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">数量</dt>
            <dd class="text-ink-900">×{{ order.quantity }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">单价</dt>
            <dd class="text-ink-900">¥{{ formatMoneyRaw(order.displayPrice) }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">支付方式</dt>
            <dd class="text-ink-900">{{ payMethodLabel }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">下单时间</dt>
            <dd class="text-ink-900">{{ formatDateTime(order.createdAt) }}</dd>
          </div>
          <div v-if="order.paidAt" class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">付款时间</dt>
            <dd class="text-ink-900">{{ formatDateTime(order.paidAt) }}</dd>
          </div>
          <div v-if="order.deliveredAt" class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">发货时间</dt>
            <dd class="text-ink-900">{{ formatDateTime(order.deliveredAt) }}</dd>
          </div>
          <div v-if="order.thirdTradeNo" class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">支付单号</dt>
            <dd class="text-ink-900 font-mono text-xs truncate">{{ order.thirdTradeNo }}</dd>
          </div>
          <div v-if="order.contact" class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">联系方式</dt>
            <dd class="text-ink-900 truncate">{{ order.contact }}</dd>
          </div>
        </dl>
      </div>

      <!-- ────── 账号交付 ────── -->
      <div v-if="order.accounts?.length" class="card p-5 md:p-6 mb-4">
        <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 class="text-sm font-semibold text-ink-900 flex items-center gap-2">
            <span class="w-1 h-4 bg-brand-600 rounded-full" />
            账号交付
            <span class="text-xs font-normal text-ink-400">共 {{ order.accounts.length }} 个</span>
          </h3>
          <BrandButton variant="ghost" size="sm" @click="copyAll">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            复制全部
          </BrandButton>
        </div>
        <ul class="space-y-3">
          <li
            v-for="(a, i) in order.accounts"
            :key="i"
            class="p-4 bg-ink-50/70 rounded-xl space-y-2.5"
          >
            <div class="flex items-center justify-between gap-3 flex-wrap text-xs">
              <span class="text-ink-500">账号 #{{ i + 1 }}</span>
              <span v-if="a.id" class="text-ink-400 font-mono">ID: {{ a.id }}</span>
            </div>

            <div class="flex items-center gap-2.5">
              <div class="text-xs text-ink-500 w-14 shrink-0">邮箱</div>
              <code class="text-sm text-ink-900 break-all flex-1 font-mono">{{ a.account_json?.email || a.email }}</code>
              <button class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded shrink-0 transition" @click="copy((a.account_json?.email || a.email) as string, '邮箱已复制')">复制</button>
            </div>

            <div v-if="a.account_json?.access_token" class="flex items-start gap-2.5">
              <div class="text-xs text-ink-500 w-14 shrink-0 mt-1">Token</div>
              <code class="text-xs text-ink-700 break-all flex-1 font-mono leading-relaxed">{{ a.account_json.access_token }}</code>
              <button class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded shrink-0 mt-0.5 transition" @click="copy(a.account_json!.access_token as string, 'Token 已复制')">复制</button>
            </div>
          </li>
        </ul>
      </div>

      <!-- ────── 接验证码 ────── -->
      <div v-if="primaryEmail && order.status === 'DELIVERED'" class="card p-5 md:p-6 mb-4">
        <h3 class="text-sm font-semibold text-ink-900 mb-3 flex items-center gap-2">
          <span class="w-1 h-4 bg-brand-600 rounded-full" />
          为该账号接验证码
        </h3>
        <EmailCodeBox :model-value="primaryEmail" :editable="false" compact />
      </div>

      <div class="text-center mt-6">
        <BrandButton variant="secondary" size="sm" @click="router.push('/')">继续逛逛</BrandButton>
      </div>
    </template>
  </section>
</template>
