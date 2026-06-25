<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import { useSiteStore } from '@/stores/site';
import { useUserStore } from '@/stores/user';
import {
  formatCardKeyContent,
  formatCardKeysForCopy,
  formatDeliveryAccountForCopy,
  parseWarehouseDeliveryAccount,
  type ParsedDeliveryAccount,
} from '@/utils/card-key';
import { statusOf, shouldKeepPolling } from '@/utils/order-status';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import EmailCodeBox from '@/components/EmailCodeBox.vue';
import BrandButton from '@/components/BrandButton.vue';
import Skeleton from '@/components/Skeleton.vue';
import { formatDateTime, formatMoneyRaw, copyText } from '@/utils/format';

const route = useRoute();
const router = useRouter();
const site = useSiteStore();
const user = useUserStore();
const order = ref<any>(null);
const loading = ref(true);
const notFound = ref(false);
const needContact = ref(false);
const contactInput = ref('');
const poolGrant = ref<any | null>(null);
const poolToken = ref('');
const poolLoading = ref(false);
const poolClaiming = ref(false);
let timer: number | undefined;
let pollStart = 0;
const POLL_MAX_MS = 5 * 60 * 1000; // 自动轮询最长 5 分钟，之后降级为手动刷新
const autoPaused = ref(false);

const wechat = computed(() => site.settings.cs_wechat || 'ymw_polo');
const qq = computed(() => site.settings.cs_qq || '');
const telegram = computed(() => site.settings.cs_telegram || '');

const needContactSupport = computed(() => {
  if (!order.value) return false;
  if (isPoolQuotaOrder.value) return false;
  if (!['PAID', 'DELIVERED'].includes(order.value.status)) return false;
  return !order.value.cardKeys?.length;
});

const statusInfo = computed(() => statusOf(order.value?.status));
const isPoolQuotaOrder = computed(() => order.value?.product?.deliveryType === 'POOL_QUOTA');

const deliveryAccounts = computed<Array<ParsedDeliveryAccount & { id?: number; soldAt?: string }>>(() => {
  return (order.value?.cardKeys || [])
    .map((item: any) => {
      const account = parseWarehouseDeliveryAccount(item);
      return account ? { ...account, id: item.id, soldAt: item.soldAt } : null;
    })
    .filter(Boolean) as Array<ParsedDeliveryAccount & { id?: number; soldAt?: string }>;
});

const plainCardKeys = computed(() => {
  return (order.value?.cardKeys || []).filter((item: any) => !parseWarehouseDeliveryAccount(item));
});

const primaryDeliveryEmail = computed(() => deliveryAccounts.value[0]?.email || '');

const poolQuotaPercent = computed(() => {
  if (!poolGrant.value?.quotaTotal) return 0;
  return Math.min(100, Math.max(0, (Number(poolGrant.value.quotaUsed || 0) / Number(poolGrant.value.quotaTotal)) * 100));
});

const poolAccountCopyText = computed(() => {
  const account = poolGrant.value?.account;
  if (!account) return '';
  if (account.raw) return account.raw;
  if (!poolToken.value) return '';
  return [account.email, account.emailPassword, account.cursorPassword, poolToken.value]
    .filter(Boolean)
    .join('----');
});

async function loadPoolGrant() {
  poolGrant.value = null;
  poolToken.value = '';
  if (!isPoolQuotaOrder.value || order.value?.status !== 'DELIVERED') return;
  if (!user.isLoggedIn) return;
  poolLoading.value = true;
  try {
    poolGrant.value = await api.poolQuery(order.value.orderNo, true);
  } catch {
    poolGrant.value = null;
  } finally {
    poolLoading.value = false;
  }
}

async function load(contact?: string) {
  try {
    const r: any = await api.orderQuery(route.params.orderNo as string, contact);
    if (r && r.requireContact) {
      order.value = null; needContact.value = true; notFound.value = false; poolGrant.value = null;
    } else {
      order.value = r; notFound.value = false; needContact.value = false;
      await loadPoolGrant();
    }
  } catch {
    order.value = null; needContact.value = false; notFound.value = true; poolGrant.value = null;
  } finally {
    loading.value = false;
  }
}

async function submitContact() {
  const c = contactInput.value.trim();
  if (!c) return ElMessage.warning('请输入下单时填写的联系方式');
  loading.value = true;
  try {
    await load(c);
    if (needContact.value) {
      ElMessage.error('联系方式不匹配');
    } else if (notFound.value) {
      ElMessage.error('联系方式不匹配');
      notFound.value = false;
      needContact.value = true;
    }
  } finally {
    loading.value = false;
  }
}

const paying = ref(false);
async function goPay() {
  if (!order.value || paying.value) return;
  // 先在点击同步上下文开空白页签，避免 await 后被拦截
  const payWindow = window.open('', '_blank');
  paying.value = true;
  try {
    const channel = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'WAP' : 'PC';
    const r = await api.pay.alipayCreate(order.value.orderNo, channel);
    // 支付宝新页签打开，当前订单页保持轮询
    if (payWindow) payWindow.location.href = r.payUrl;
    else window.open(r.payUrl, '_blank');
  } catch (e: any) {
    if (payWindow) payWindow.close();
    ElMessage.error(e?.response?.data?.error?.message || '获取支付链接失败');
  } finally {
    paying.value = false;
  }
}

function stopPolling() {
  if (timer) { clearInterval(timer); timer = undefined; }
}

async function poll() {
  if (!order.value) return;
  if (!shouldKeepPolling(order.value.status)) { stopPolling(); return; }
  if (Date.now() - pollStart > POLL_MAX_MS) { stopPolling(); autoPaused.value = true; return; }
  await load(order.value?.contact || contactInput.value.trim() || undefined);
}

async function manualRefresh() {
  await load(order.value?.contact || contactInput.value.trim() || undefined);
  if (order.value && shouldKeepPolling(order.value.status)) {
    autoPaused.value = false;
    pollStart = Date.now();
    stopPolling();
    timer = window.setInterval(poll, 3000);
  }
}

async function copy(text: string, label = '已复制') {
  if (!text) return;
  const ok = await copyText(text);
  if (ok) ElMessage.success(label);
  else ElMessage.error('复制失败');
}
function copyAll() {
  copy(formatCardKeysForCopy(order.value.cardKeys || []), '已复制全部交付内容');
}

// 桌面工具联动：仅 Cursor 类卡密展示「一键导入」按钮。
// 简单判定规则：内容里含 JWT 形态 `eyJ...` 即视为 Cursor 类。
const showDesktopHint = ref(false);
function isCursorCardKey(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/.test(raw);
}
/** 把整段卡密内容塞进 deep link 的 raw 参数，桌面端会再次解析 */
function buildDesktopLinkRaw(raw: string) {
  return `polo-tool://import?token=${encodeURIComponent(raw)}`;
}

async function claimPoolAccount() {
  if (!order.value || poolClaiming.value) return;
  poolClaiming.value = true;
  try {
    const r = await api.poolClaim(order.value.orderNo);
    poolGrant.value = r;
    poolToken.value = r?.account?.token || '';
    ElMessage.success('已分配号池账号');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '申请账号失败');
  } finally {
    poolClaiming.value = false;
  }
}

async function refreshPoolGrant() {
  if (!order.value || poolLoading.value) return;
  poolLoading.value = true;
  try {
    poolGrant.value = await api.poolQuery(order.value.orderNo);
    ElMessage.success('额度已刷新');
  } finally {
    poolLoading.value = false;
  }
}

onMounted(async () => {
  const fromQuery = (route.query.contact as string | undefined)?.trim();
  if (fromQuery) {
    contactInput.value = fromQuery;
    await load(fromQuery);
  } else {
    await load();
  }
  pollStart = Date.now();
  timer = window.setInterval(poll, 3000);
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
  <div class="max-w-3xl mx-auto px-4 py-6 md:py-10">
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
          v-model="contactInput"
          class="mt-5 w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition"
          placeholder="下单时填写的联系方式"
          @keydown.enter="submitContact"
        />
        <BrandButton class="mt-4" variant="primary" size="md" block @click="submitContact">查看订单</BrandButton>
      </div>
    </div>

    <!-- 不存在 -->
    <div v-else-if="notFound || !order" class="card p-12 text-center">
      <div class="w-14 h-14 rounded-2xl bg-ink-50 text-ink-300 flex items-center justify-center mx-auto mb-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="w-7 h-7">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <div class="text-ink-700 font-medium">未找到该订单</div>
      <div class="text-xs text-ink-400 mt-1">订单号可能输入错误，或订单已被删除</div>
      <BrandButton class="mt-4" variant="secondary" size="sm" @click="router.push('/query')">重新查询</BrandButton>
    </div>

    <template v-else>
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
            <BrandButton
              variant="primary"
              size="md"
              :loading="paying"
              @click="goPay"
            >
              {{ paying ? '正在跳转…' : '前往支付宝' }}
            </BrandButton>
          </div>
        </div>

        <!-- PAID 中：发货进度 -->
        <div v-if="order.status === 'PAID'" class="mt-4 flex items-center gap-2.5 text-sm text-sky-800">
          <div class="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin shrink-0" />
          <span>付款已到账，正在为您出库…通常 3-10 秒完成</span>
        </div>
      </div>

      <!-- 自动刷新已暂停 → 手动刷新 -->
      <div
        v-if="autoPaused && ['PENDING', 'PAID'].includes(order.status)"
        class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-2.5 text-xs text-ink-500"
      >
        <span>已暂停自动刷新，如已完成支付可手动刷新查看最新状态</span>
        <button class="text-brand-600 hover:text-brand-700 font-medium shrink-0" @click="manualRefresh">
          手动刷新
        </button>
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
            <dd class="text-ink-900 text-right truncate">{{ order.productTitle }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">规格</dt>
            <dd class="text-ink-900 text-right truncate">{{ order.skuName }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">数量</dt>
            <dd class="text-ink-900">×{{ order.quantity }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">单价</dt>
            <dd class="text-ink-900">¥{{ formatMoneyRaw(order.unitPrice) }}</dd>
          </div>
          <div v-if="order.redeemCode" class="flex justify-between gap-3 items-center">
            <dt class="text-ink-500 shrink-0">兑换码</dt>
            <dd class="flex items-center gap-2 min-w-0 justify-end">
              <code class="text-ink-900 font-mono text-xs truncate">{{ order.redeemCode }}</code>
              <button
                class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-0.5 rounded shrink-0 transition"
                @click="copy(order.redeemCode, '兑换码已复制')"
              >复制</button>
            </dd>
          </div>
          <div v-if="order.contact" class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">联系方式</dt>
            <dd class="text-ink-900 truncate">{{ order.contact }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-500 shrink-0">下单时间</dt>
            <dd class="text-ink-900">{{ formatDateTime(order.createdAt) }}</dd>
          </div>
        </dl>
      </div>

      <!-- ────── 号池额度 ────── -->
      <div v-if="isPoolQuotaOrder" class="card p-5 md:p-6 mb-4">
        <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 class="text-sm font-semibold text-ink-900 flex items-center gap-2">
            <span class="w-1 h-4 bg-brand-600 rounded-full" />
            高级模型额度
          </h3>
          <button
            v-if="user.isLoggedIn && poolGrant"
            class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded transition"
            :disabled="poolLoading"
            @click="refreshPoolGrant"
          >
            {{ poolLoading ? '刷新中' : '刷新额度' }}
          </button>
        </div>

        <div v-if="!user.isLoggedIn" class="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
          该商品是登录用户专属额度包。请登录购买账号后查看额度并申请号池账号。
          <button
            class="ml-2 text-brand-700 hover:underline"
            @click="router.push({ name: 'login', query: { redirect: route.fullPath } })"
          >去登录</button>
        </div>

        <div v-else-if="poolLoading && !poolGrant" class="text-sm text-ink-500 py-2">正在读取额度…</div>

        <div v-else-if="poolGrant" class="space-y-4">
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="rounded-xl bg-ink-50/80 px-3 py-3">
              <div class="text-xs text-ink-500">总额度</div>
              <div class="mt-1 text-lg font-semibold text-ink-900">${{ Number(poolGrant.quotaTotal || 0).toFixed(2) }}</div>
            </div>
            <div class="rounded-xl bg-ink-50/80 px-3 py-3">
              <div class="text-xs text-ink-500">已使用</div>
              <div class="mt-1 text-lg font-semibold text-ink-800">${{ Number(poolGrant.quotaUsed || 0).toFixed(2) }}</div>
            </div>
            <div class="rounded-xl bg-brand-50/70 px-3 py-3">
              <div class="text-xs text-brand-700">剩余额度</div>
              <div class="mt-1 text-lg font-semibold text-brand-800">${{ Number(poolGrant.quotaRemain || 0).toFixed(2) }}</div>
            </div>
          </div>

          <div>
            <div class="h-2 rounded-full bg-ink-100 overflow-hidden">
              <div class="h-full bg-brand-600 transition-all" :style="{ width: `${poolQuotaPercent}%` }" />
            </div>
            <div class="mt-2 flex justify-between gap-3 text-xs text-ink-500">
              <span>{{ poolGrant.active ? '额度可用' : '额度已停用' }}</span>
              <span v-if="poolGrant.endAt">有效期至 {{ formatDateTime(poolGrant.endAt) }}</span>
            </div>
          </div>

          <div v-if="poolGrant.account" class="rounded-xl border border-ink-100 bg-ink-50/60 p-4 space-y-2.5">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div class="text-sm font-medium text-ink-900">{{ poolGrant.account.label }}</div>
                <div class="text-xs text-ink-500 font-mono">{{ poolGrant.account.type }}</div>
              </div>
              <span class="text-xs px-2 py-0.5 rounded-md border border-brand-200 bg-brand-50 text-brand-700">已分配</span>
            </div>
            <div v-if="poolGrant.account.email" class="flex items-center gap-2.5">
              <div class="text-xs text-ink-500 w-14 shrink-0">邮箱</div>
              <code class="text-sm text-ink-900 break-all flex-1 font-mono">{{ poolGrant.account.email }}</code>
              <button class="text-xs text-brand-600 hover:underline shrink-0" @click="copy(poolGrant.account.email, '邮箱已复制')">复制</button>
            </div>
            <div v-if="poolGrant.account.emailPassword" class="flex items-center gap-2.5">
              <div class="text-xs text-ink-500 w-14 shrink-0">邮箱密码</div>
              <code class="text-sm text-ink-900 break-all flex-1 font-mono">{{ poolGrant.account.emailPassword }}</code>
              <button class="text-xs text-brand-600 hover:underline shrink-0" @click="copy(poolGrant.account.emailPassword, '邮箱密码已复制')">复制</button>
            </div>
            <div v-if="poolGrant.account.cursorPassword" class="flex items-center gap-2.5">
              <div class="text-xs text-ink-500 w-14 shrink-0">账号密码</div>
              <code class="text-sm text-ink-900 break-all flex-1 font-mono">{{ poolGrant.account.cursorPassword }}</code>
              <button class="text-xs text-brand-600 hover:underline shrink-0" @click="copy(poolGrant.account.cursorPassword, '账号密码已复制')">复制</button>
            </div>
            <div class="flex items-start gap-2.5">
              <div class="text-xs text-ink-500 w-14 shrink-0 mt-1">Token</div>
              <code class="text-xs text-ink-700 break-all flex-1 font-mono leading-relaxed">{{ poolToken || poolGrant.account.tokenMasked }}</code>
              <button
                v-if="poolToken"
                class="text-xs text-brand-600 hover:underline shrink-0 mt-0.5"
                @click="copy(poolToken, 'Token 已复制')"
              >复制</button>
              <button
                v-else
                class="text-xs text-brand-600 hover:underline shrink-0 mt-0.5"
                :disabled="poolClaiming || !poolGrant.active"
                @click="claimPoolAccount"
              >查看</button>
            </div>
            <div v-if="poolAccountCopyText" class="pt-1">
              <button
                class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded transition"
                @click="copy(poolAccountCopyText, '账号信息已复制')"
              >复制完整账号</button>
            </div>
          </div>

          <BrandButton
            v-else
            variant="primary"
            size="md"
            block
            :loading="poolClaiming"
            :disabled="!poolGrant.active || Number(poolGrant.quotaRemain || 0) <= 0"
            @click="claimPoolAccount"
          >
            {{ poolClaiming ? '正在申请…' : '申请号池账号' }}
          </BrandButton>
        </div>

        <div v-else class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-4">
          额度正在发放中，请稍后刷新订单页。
        </div>
      </div>

      <!-- ────── 账号交付 ────── -->
      <div v-if="deliveryAccounts.length" class="card p-5 md:p-6 mb-4">
        <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 class="text-sm font-semibold text-ink-900 flex items-center gap-2">
            <span class="w-1 h-4 bg-brand-600 rounded-full" />
            账号交付
            <span class="text-xs font-normal text-ink-400">共 {{ deliveryAccounts.length }} 个</span>
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
            v-for="(a, i) in deliveryAccounts"
            :key="a.id || a.email || i"
            class="p-4 bg-ink-50/70 rounded-xl space-y-2.5"
          >
            <div class="flex items-center justify-between gap-3 flex-wrap text-xs">
              <span class="text-ink-500">账号 #{{ i + 1 }}</span>
              <span v-if="a.id" class="text-ink-400 font-mono">ID: {{ a.id }}</span>
            </div>

            <div class="flex items-center gap-2.5">
              <div class="text-xs text-ink-500 w-14 shrink-0">邮箱</div>
              <code class="text-sm text-ink-900 break-all flex-1 font-mono">{{ a.email }}</code>
              <button
                class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded shrink-0 transition"
                @click="copy(a.email, '邮箱已复制')"
              >复制</button>
            </div>

            <div class="flex items-start gap-2.5">
              <div class="text-xs text-ink-500 w-14 shrink-0 mt-1">Token</div>
              <code class="text-xs text-ink-700 break-all flex-1 font-mono leading-relaxed">{{ a.token }}</code>
              <button
                class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded shrink-0 mt-0.5 transition"
                @click="copy(a.token, 'Token 已复制')"
              >复制</button>
            </div>

            <div class="pt-1">
              <button
                class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded transition"
                @click="copy(formatDeliveryAccountForCopy(a), '账号已复制')"
              >复制该账号</button>
            </div>
          </li>
        </ul>
      </div>

      <!-- ────── 接验证码 ────── -->
      <div v-if="primaryDeliveryEmail && order.status === 'DELIVERED'" class="card p-5 md:p-6 mb-4">
        <h3 class="text-sm font-semibold text-ink-900 mb-3 flex items-center gap-2">
          <span class="w-1 h-4 bg-brand-600 rounded-full" />
          为该账号接验证码
        </h3>
        <EmailCodeBox :model-value="primaryDeliveryEmail" :editable="false" compact />
      </div>

      <!-- ────── 卡密交付 ────── -->
      <div v-if="plainCardKeys.length" class="card p-5 md:p-6 mb-4">
        <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 class="text-sm font-semibold text-ink-900 flex items-center gap-2">
            <span class="w-1 h-4 bg-brand-600 rounded-full" />
            卡密交付
            <span class="text-xs font-normal text-ink-400">共 {{ plainCardKeys.length }} 条</span>
          </h3>
          <BrandButton variant="ghost" size="sm" @click="copyAll">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            复制全部
          </BrandButton>
        </div>
        <ul class="space-y-2">
          <li
            v-for="(c, i) in plainCardKeys"
            :key="i"
            class="group p-3.5 bg-ink-50/70 hover:bg-ink-50 rounded-lg space-y-2 transition"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-start gap-3 flex-1 min-w-0">
                <span class="text-[11px] text-ink-400 font-mono mt-0.5 shrink-0">#{{ i + 1 }}</span>
                <code class="text-sm text-ink-800 break-all whitespace-pre-wrap flex-1 leading-relaxed">{{ formatCardKeyContent(c.content) }}</code>
              </div>
              <button
                class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded shrink-0 transition opacity-70 group-hover:opacity-100"
                @click="copy(formatCardKeyContent(c.content))"
              >复制</button>
            </div>

            <div v-if="isCursorCardKey(c.content)" class="pt-2 border-t border-ink-200/70 flex items-center gap-2">
              <a
                :href="buildDesktopLinkRaw(formatCardKeyContent(c.content))"
                class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 rounded-md font-medium transition"
                title="在已安装 Polo 桌面工具的电脑上打开，将自动写入 Cursor 本地存储"
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 6h16M4 12h16M4 18h7" stroke-linecap="round" />
                  <path d="m17 16 4 3-4 3" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                在桌面工具中一键导入
              </a>
              <span class="text-[11px] text-ink-400">
                需先安装
                <a href="#" class="text-brand-600 hover:underline" @click.prevent="showDesktopHint = true">Polo 账号工具</a>
              </span>
            </div>
          </li>
        </ul>
      </div>

      <!-- ────── 缺货 → 联系客服 ────── -->
      <div
        v-else-if="needContactSupport"
        class="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/80 to-orange-50/40 p-5 md:p-6 mb-4"
      >
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-white/80 text-amber-600 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-amber-900">暂无现货，请联系客服发货</div>
            <p class="text-sm text-amber-800 mt-1 leading-relaxed">
              您已付款成功，订单号 <code class="font-mono bg-white/80 px-1.5 py-0.5 rounded text-amber-900 text-xs">{{ order.orderNo }}</code>。客服会尽快人工发货。
            </p>
          </div>
        </div>

        <div class="mt-4 bg-white/85 rounded-xl p-3.5 space-y-2.5 text-sm border border-amber-100/80">
          <div class="flex items-center gap-3">
            <span class="w-16 text-xs text-ink-500 shrink-0">微信</span>
            <code class="font-mono text-ink-900 font-medium flex-1 truncate">{{ wechat }}</code>
            <button class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded transition shrink-0" @click="copy(wechat, '微信号已复制')">复制</button>
          </div>
          <div v-if="qq" class="flex items-center gap-3">
            <span class="w-16 text-xs text-ink-500 shrink-0">QQ</span>
            <code class="font-mono text-ink-900 flex-1 truncate">{{ qq }}</code>
            <button class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded transition shrink-0" @click="copy(qq)">复制</button>
          </div>
          <div v-if="telegram" class="flex items-center gap-3">
            <span class="w-16 text-xs text-ink-500 shrink-0">Telegram</span>
            <code class="font-mono text-ink-900 flex-1 truncate">{{ telegram }}</code>
            <button class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded transition shrink-0" @click="copy(telegram)">复制</button>
          </div>
        </div>

        <p class="mt-3 text-[11px] text-amber-700/80 leading-relaxed">
          联系时请提供订单号便于核单。若长时间未发货可申请原路退款。
        </p>
      </div>

      <!-- ────── 返回 ────── -->
      <div class="text-center mt-6">
        <BrandButton variant="secondary" size="sm" @click="router.push('/')">继续逛逛</BrandButton>
      </div>
    </template>

    <!-- 桌面工具提示弹窗 -->
    <div
      v-if="showDesktopHint"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      @click.self="showDesktopHint = false"
    >
      <div class="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <h3 class="text-base font-semibold text-ink-900 mb-2">Polo 桌面账号工具</h3>
        <p class="text-sm text-ink-600 leading-relaxed">
          本地工具：把卡密链接打开 → 自动写入 Cursor 本机存储；同时支持：
        </p>
        <ul class="mt-3 space-y-1.5 text-sm text-ink-700">
          <li class="flex gap-2"><span class="text-emerald-500">✓</span> 一键导入并切换 Cursor 账号</li>
          <li class="flex gap-2"><span class="text-emerald-500">✓</span> 实时查 Cursor 用量、剩余额度、重置时间</li>
          <li class="flex gap-2"><span class="text-emerald-500">✓</span> 多账号管理 + 阈值预警</li>
          <li class="flex gap-2"><span class="text-emerald-500">✓</span> 自动重置机器指纹</li>
        </ul>
        <p class="text-xs text-ink-500 mt-3">
          所有操作均在本机完成，token 不会上传到任何服务器。
        </p>
        <div class="mt-5 flex items-center gap-2">
          <BrandButton size="sm" @click="router.push('/tools/desktop')">立即下载</BrandButton>
          <button
            class="px-4 py-1.5 text-sm text-ink-500 hover:text-ink-700"
            @click="showDesktopHint = false"
          >以后再说</button>
        </div>
      </div>
    </div>
  </div>
</template>
