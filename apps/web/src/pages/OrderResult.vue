<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import { useSiteStore } from '@/stores/site';
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
const order = ref<any>(null);
const loading = ref(true);
const notFound = ref(false);
const needContact = ref(false);
const contactInput = ref('');
let timer: any = null;

const wechat = computed(() => site.settings.cs_wechat || 'ymw_polo');
const qq = computed(() => site.settings.cs_qq || '');
const telegram = computed(() => site.settings.cs_telegram || '');

const needContactSupport = computed(() => {
  if (!order.value) return false;
  if (!['PAID', 'DELIVERED'].includes(order.value.status)) return false;
  return !order.value.cardKeys?.length;
});

const statusInfo = computed(() => statusOf(order.value?.status));

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

async function load(contact?: string) {
  try {
    const r: any = await api.orderQuery(route.params.orderNo as string, contact);
    if (r && r.requireContact) {
      order.value = null; needContact.value = true; notFound.value = false;
    } else {
      order.value = r; notFound.value = false; needContact.value = false;
    }
  } catch {
    order.value = null; needContact.value = false; notFound.value = true;
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

async function poll() {
  if (!order.value) return;
  if (!shouldKeepPolling(order.value.status)) return;
  await load(order.value?.contact || contactInput.value.trim() || undefined);
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

onMounted(async () => {
  const fromQuery = (route.query.contact as string | undefined)?.trim();
  if (fromQuery) {
    contactInput.value = fromQuery;
    await load(fromQuery);
  } else {
    await load();
  }
  timer = setInterval(poll, 3000);
});
onBeforeUnmount(() => clearInterval(timer));

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
            class="group p-3.5 bg-ink-50/70 hover:bg-ink-50 rounded-lg flex items-start justify-between gap-3 transition"
          >
            <div class="flex items-start gap-3 flex-1 min-w-0">
              <span class="text-[11px] text-ink-400 font-mono mt-0.5 shrink-0">#{{ i + 1 }}</span>
              <code class="text-sm text-ink-800 break-all whitespace-pre-wrap flex-1 leading-relaxed">{{ formatCardKeyContent(c.content) }}</code>
            </div>
            <button
              class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded shrink-0 transition opacity-70 group-hover:opacity-100"
              @click="copy(formatCardKeyContent(c.content))"
            >复制</button>
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
  </div>
</template>
