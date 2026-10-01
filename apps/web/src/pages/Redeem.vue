<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import BrandButton from '@/components/BrandButton.vue';
import {
  formatCardKeyContent,
  formatCardKeysForCopy,
  formatDeliveryAccountForCopy,
  parseWarehouseDeliveryAccount,
  type DeliveryCardKeyItem,
  type ParsedDeliveryAccount,
} from '@/utils/card-key';

interface RedeemOrder {
  orderNo: string;
  productTitle: string;
  skuName: string;
  quantity: number;
  status: string;
  hasContact?: boolean;
  redeemedAt?: string;
  createdAt?: string;
}
interface RedeemInfo {
  code: string;
  status: string;
  productTitle: string;
  productCover?: string;
  skuName: string;
  deliveryType?: string | null;
  qtyPerUse: number;
  remaining: number;
  maxUses: number;
  expireAt?: string | null;
  redeemable: boolean;
  orders: RedeemOrder[];
}
interface RedeemResult extends RedeemOrder {
  cardKeys?: Array<DeliveryCardKeyItem & { id?: number; soldAt?: string }>;
  product?: { deliveryType?: string };
}

const router = useRouter();
const route = useRoute();
const code = ref('');
const contact = ref('');
const codeInput = ref<HTMLInputElement | null>(null);
const resultHeading = ref<HTMLElement | null>(null);
const checking = ref(false);
const loading = ref(false);
const recovering = ref(false);
const checkError = ref('');
const redeemError = ref('');
const recoveryHint = ref('');
const uncertainCodes = ref(new Set<string>());
const cardInfo = ref<RedeemInfo | null>(null);
const cardResult = ref<RedeemResult | null>(null);
const verifiedCode = ref('');
const submittedContact = ref('');
const showAllHistory = ref(false);
let checkSequence = 0;
let checkController: AbortController | null = null;
let disposed = false;

const normalizedCode = computed(() => code.value.trim().toUpperCase());
const uncertainSubmission = computed(() => uncertainCodes.value.has(normalizedCode.value));
const historyOrders = computed(() => cardInfo.value?.orders || []);
const visibleOrders = computed(() => showAllHistory.value ? historyOrders.value : historyOrders.value.slice(0, 3));
const expired = computed(() => Boolean(cardInfo.value?.expireAt && new Date(cardInfo.value.expireAt).getTime() <= Date.now()));
const effectiveStatus = computed(() => {
  if (!cardInfo.value) return '';
  if (cardInfo.value.status === 'ACTIVE' && expired.value) return 'EXPIRED';
  if (cardInfo.value.status === 'ACTIVE' && cardInfo.value.remaining <= 0) return 'EXHAUSTED';
  return cardInfo.value.status;
});
const canResume = computed(() => Boolean(
  cardInfo.value && verifiedCode.value === normalizedCode.value
  && effectiveStatus.value === 'ACTIVE' && cardInfo.value.redeemable !== false
  && !checking.value && !loading.value && !recovering.value,
));
const canRedeem = computed(() => canResume.value && !uncertainSubmission.value);
const step = computed(() => cardResult.value ? 3 : cardInfo.value ? 2 : 1);

const statusLabels: Record<string, string> = {
  ACTIVE: '可以兑换', DISABLED: '已禁用', EXHAUSTED: '已用完', EXPIRED: '已过期',
};
const orderStatusLabels: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '待处理', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PAID: { text: '待发货', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  DELIVERED: { text: '已发货', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  FAILED: { text: '发货失败', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  EXPIRED: { text: '已超时', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  CANCELLED: { text: '已取消', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  REFUNDED: { text: '已退款', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};
const deliveryNames: Record<string, string> = {
  CARD_KEY: '卡密交付', POOL_QUOTA: '额度商品', MANUAL: '人工处理',
};
const unavailableMessage = computed(() => {
  if (!cardInfo.value) return '';
  if (cardInfo.value.redeemable === false) return '对应商品已停售，兑换记录仍可查看。未使用的兑换码请联系客服处理。';
  if (effectiveStatus.value === 'EXPIRED') return '兑换码已过期，无法继续兑换。已兑换的订单仍可在下方查看。';
  if (effectiveStatus.value === 'EXHAUSTED') return '兑换次数已用完，已兑换的订单仍可在下方查看。';
  if (effectiveStatus.value === 'DISABLED') return '兑换码已被禁用，如有疑问请联系客服。';
  if (effectiveStatus.value !== 'ACTIVE') return '兑换码当前无法使用，请联系客服核实。';
  return '';
});
const resultStatus = computed(() => orderStatusLabels[cardResult.value?.status || ''] || { text: '处理中', cls: 'bg-ink-100 text-ink-600 border-ink-200' });
const resultDelivered = computed(() => cardResult.value?.status === 'DELIVERED');
const resultTitle = computed(() => resultDelivered.value ? '兑换完成' : cardResult.value?.status === 'FAILED' ? '订单待处理' : '订单已创建');
const resultDescription = computed(() => {
  if (resultDelivered.value) return '商品已发货，请保存订单号和交付内容。';
  if (cardResult.value?.status === 'FAILED') return '交付遇到问题，请凭订单号联系客服处理。';
  return '兑换已受理，请在订单页查看交付进度，无需再次兑换。';
});
const resultDeliveryType = computed(() => cardResult.value?.product?.deliveryType || cardInfo.value?.deliveryType);
const cardResultAccounts = computed<Array<ParsedDeliveryAccount & { id?: number }>>(() => (cardResult.value?.cardKeys || [])
  .flatMap(item => {
    const account = parseWarehouseDeliveryAccount(item);
    return account ? [{ ...account, id: item.id }] : [];
  }));
const cardResultPlainKeys = computed(() => (cardResult.value?.cardKeys || []).filter(item => !parseWarehouseDeliveryAccount(item)));

function errorText(error: any, fallback: string): string {
  const message = error?.response?.data?.error;
  if (typeof message === 'string') return message;
  if (typeof message?.message === 'string') return message.message;
  if (!error?.response) return fallback;
  return typeof error?.message === 'string' ? error.message : fallback;
}
function dateText(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}
function cancelCheck() {
  checkSequence += 1;
  checkController?.abort();
  checkController = null;
  checking.value = false;
}
watch(code, () => {
  cancelCheck();
  cardInfo.value = null;
  verifiedCode.value = '';
  checkError.value = '';
  redeemError.value = '';
  recoveryHint.value = '';
  showAllHistory.value = false;
}, { flush: 'sync' });

async function checkInfo() {
  if (checking.value || loading.value || recovering.value) return;
  const currentCode = normalizedCode.value;
  if (!currentCode) {
    checkError.value = '请先填写兑换码。';
    codeInput.value?.focus();
    return;
  }
  code.value = currentCode;
  const sequence = ++checkSequence;
  const activeController = new AbortController();
  checkController = activeController;
  checking.value = true;
  checkError.value = '';
  cardInfo.value = null;
  verifiedCode.value = '';
  showAllHistory.value = false;
  try {
    const info = await api.redeem.info(currentCode, { signal: activeController.signal });
    if (disposed || sequence !== checkSequence || activeController.signal.aborted) return;
    cardInfo.value = info;
    verifiedCode.value = currentCode;
  } catch (error) {
    if (disposed || sequence !== checkSequence || activeController.signal.aborted) return;
    checkError.value = errorText(error, '查询失败，请检查网络后重试。');
  } finally {
    if (sequence === checkSequence) {
      checking.value = false;
      checkController = null;
    }
  }
}

// A failed POST may have consumed the code and created an order. Recover only via GET.
async function recoverOrders(currentCode: string, knownOrders: Set<string>, ambiguous: boolean) {
  verifiedCode.value = '';
  recovering.value = true;
  try {
    const info: RedeemInfo = await api.redeem.info(currentCode);
    if (disposed || normalizedCode.value !== currentCode) return;
    cardInfo.value = info;
    verifiedCode.value = currentCode;
    const newOrders = info.orders.filter(order => !knownOrders.has(order.orderNo));
    if (newOrders.length) {
      uncertainCodes.value.add(currentCode);
      recoveryHint.value = '已查到新的订单，请先在兑换记录中查看交付进度。';
    } else if (ambiguous) {
      recoveryHint.value = '暂未查到新的订单。请求可能仍在处理，请稍后刷新兑换记录或联系客服。';
    }
  } catch {
    if (!disposed) recoveryHint.value = '暂时无法更新兑换记录，请稍后重新查询或联系客服核实。';
  } finally {
    if (!disposed) recovering.value = false;
  }
}

async function doRedeemCard() {
  if (!canRedeem.value || !cardInfo.value) return;
  const currentCode = verifiedCode.value;
  const currentContact = contact.value.trim();
  const knownOrders = new Set(historyOrders.value.map(order => order.orderNo));
  loading.value = true;
  redeemError.value = '';
  recoveryHint.value = '';
  try {
    const order = await api.redeem.use({ code: currentCode, contact: currentContact || undefined }, { silent: true, timeout: 45_000 });
    if (disposed) return;
    submittedContact.value = currentContact;
    cardResult.value = order;
    await nextTick();
    resultHeading.value?.focus({ preventScroll: true });
    resultHeading.value?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (error: any) {
    if (disposed) return;
    const ambiguous = !error?.response || error.response.status >= 500;
    if (ambiguous) uncertainCodes.value.add(currentCode);
    redeemError.value = errorText(error, '未能确认兑换结果，请先查看兑换记录。');
    await recoverOrders(currentCode, knownOrders, ambiguous);
  } finally {
    if (!disposed) loading.value = false;
  }
}

async function reset() {
  if (loading.value || recovering.value) return;
  cancelCheck();
  cardResult.value = null;
  cardInfo.value = null;
  code.value = '';
  contact.value = '';
  submittedContact.value = '';
  verifiedCode.value = '';
  checkError.value = '';
  redeemError.value = '';
  recoveryHint.value = '';
  showAllHistory.value = false;
  await nextTick();
  codeInput.value?.focus();
}
function resumeRedeem() {
  if (!canResume.value) return;
  uncertainCodes.value.delete(normalizedCode.value);
  redeemError.value = '';
  recoveryHint.value = '';
}
async function copyTextContent(text: string, label = '已复制') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(label);
  } catch {
    ElMessage.error('复制失败，请手动选中内容复制');
  }
}
function copyAllCardKeys() {
  void copyTextContent(formatCardKeysForCopy(cardResult.value?.cardKeys || []), '已复制全部交付内容');
}
function goCardHistory(orderNo: string) {
  router.push(`/order/${encodeURIComponent(orderNo)}`);
}
function goCardOrder() {
  if (!cardResult.value) return;
  router.push({
    path: `/order/${encodeURIComponent(cardResult.value.orderNo)}`,
    query: submittedContact.value ? { contact: submittedContact.value } : undefined,
  });
}
watch(() => route.query.code, value => {
  if (loading.value || recovering.value) return;
  const preset = typeof value === 'string' ? value.trim() : '';
  if (!preset) return;
  cardResult.value = null;
  code.value = preset;
  void checkInfo();
}, { immediate: true });
onBeforeUnmount(() => {
  disposed = true;
  cancelCheck();
});
</script>

<template>
  <div class="redeem-page max-w-5xl mx-auto px-4 py-8 md:py-12">
    <header class="text-center mb-7 md:mb-9">
      <div class="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 mx-auto mb-3 flex items-center justify-center">
        <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6V5Z" stroke-linejoin="round" /><path d="M12 8v2m0 4v2" stroke-linecap="round" /></svg>
      </div>
      <h1 class="text-2xl md:text-3xl font-semibold tracking-tight text-ink-900">兑换码下单</h1>
      <p class="mt-2 text-sm text-ink-500">先查询商品，再确认兑换，交付内容在这里领取</p>
    </header>
    <ol class="redeem-steps mb-7" aria-label="兑换步骤">
      <li v-for="(label, index) in ['输入兑换码', '确认商品', '查看交付']" :key="label" :class="{ 'step-current': step === index + 1, 'step-done': step > index + 1 }" :aria-current="step === index + 1 ? 'step' : undefined">
        <span class="step-number"><svg v-if="step > index + 1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round" /></svg><template v-else>{{ index + 1 }}</template></span><span>{{ label }}</span>
      </li>
    </ol>
    <div class="redeem-workspace">
      <div class="min-w-0 space-y-5">
        <section v-if="cardResult" class="card overflow-hidden" aria-labelledby="redeem-result-title">
          <div class="result-banner p-5 md:p-7" :class="resultDelivered ? 'result-delivered' : 'result-pending'">
            <div class="flex items-center justify-between gap-3 mb-3">
              <div class="result-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-6 h-6" aria-hidden="true"><path v-if="resultDelivered" d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round" /><template v-else><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" stroke-linecap="round" /></template></svg></div>
              <span class="status-badge" :class="resultStatus.cls">{{ resultStatus.text }}</span>
            </div>
            <h2 id="redeem-result-title" ref="resultHeading" tabindex="-1" class="text-xl font-semibold text-ink-900 focus:outline-none scroll-mt-24">{{ resultTitle }}</h2>
            <p class="mt-2 text-sm text-ink-500 leading-relaxed" role="status">{{ resultDescription }}</p>
          </div>
          <div class="p-5 md:p-7">
            <dl class="order-summary text-sm">
              <div><dt>订单号</dt><dd class="flex items-start justify-end gap-2"><code class="font-mono break-all">{{ cardResult.orderNo }}</code><button type="button" class="text-link shrink-0" @click="copyTextContent(cardResult.orderNo, '订单号已复制')">复制</button></dd></div>
              <div><dt>商品</dt><dd>{{ cardResult.productTitle }}</dd></div>
              <div><dt>规格与数量</dt><dd>{{ cardResult.skuName || '默认规格' }} × {{ cardResult.quantity }}</dd></div>
            </dl>
            <div v-if="cardResult.cardKeys?.length" class="delivery-section mt-6 pt-5 border-t border-ink-100">
              <div class="flex items-center justify-between gap-3 mb-4"><h3 class="text-sm font-semibold text-ink-900">交付内容 <span class="font-normal text-ink-400 ml-1">{{ cardResult.cardKeys.length }} 份</span></h3><BrandButton variant="subtle" size="sm" @click="copyAllCardKeys">复制全部</BrandButton></div>
              <div v-if="cardResultAccounts.length" class="space-y-3">
                <article v-for="(account, index) in cardResultAccounts" :key="account.id || index" class="delivery-item">
                  <div class="flex items-center justify-between gap-3 mb-3"><h4 class="text-xs font-medium text-ink-600">账号 {{ index + 1 }}</h4><button type="button" class="text-link" @click="copyTextContent(formatDeliveryAccountForCopy(account), '账号已复制')">复制账号</button></div>
                  <div class="delivery-field"><span>邮箱</span><code>{{ account.email }}</code><button type="button" class="text-link" aria-label="复制邮箱" @click="copyTextContent(account.email, '邮箱已复制')">复制</button></div>
                  <div class="delivery-field mt-3"><span>Token</span><code class="token-content">{{ account.token }}</code><button type="button" class="text-link" aria-label="复制 Token" @click="copyTextContent(account.token, 'Token 已复制')">复制</button></div>
                </article>
              </div>
              <div v-if="cardResultPlainKeys.length" class="space-y-3" :class="cardResultAccounts.length ? 'mt-3' : ''">
                <article v-for="(item, index) in cardResultPlainKeys" :key="item.id || index" class="delivery-item">
                  <div class="flex items-center justify-between gap-3 mb-2"><h4 class="text-xs font-medium text-ink-600">卡密 {{ index + 1 }}</h4><button type="button" class="text-link" @click="copyTextContent(item.content, '卡密已复制')">复制卡密</button></div>
                  <pre class="text-sm font-mono text-ink-800 whitespace-pre-wrap break-all leading-relaxed">{{ formatCardKeyContent(item.content) }}</pre>
                </article>
              </div>
            </div>
            <div v-else class="mt-5 notice-box" :class="resultDelivered ? 'notice-neutral' : 'notice-warning'">
              <p v-if="resultDelivered && resultDeliveryType === 'POOL_QUOTA'">额度商品已交付，请进入订单页查看额度与账号信息。</p>
              <p v-else-if="resultDelivered">订单已发货，请进入订单页查看交付详情。</p>
              <p v-else-if="cardResult.status === 'FAILED'">交付暂未完成，请凭订单号联系客服。无需再次消耗兑换次数。</p>
              <p v-else-if="resultDeliveryType === 'MANUAL'">订单已提交，等待人工处理。您可以在订单页查看最新进度。</p>
              <p v-else>交付内容正在处理，请在订单页查看进度。无需再次消耗兑换次数。</p>
            </div>
            <div class="result-actions mt-6"><BrandButton variant="secondary" block @click="reset">再兑一个</BrandButton><BrandButton block @click="goCardOrder">查看订单<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke-linecap="round" stroke-linejoin="round" /></svg></BrandButton></div>
          </div>
        </section>
        <template v-else>
          <section class="card p-5 md:p-7" aria-labelledby="redeem-input-title">
            <div class="flex items-start justify-between gap-3 mb-5"><div><h2 id="redeem-input-title" class="text-base font-semibold text-ink-900">填写兑换码</h2><p class="text-xs text-ink-400 mt-1.5">查询商品和剩余次数，不会消耗兑换码</p></div><span class="tag-chip tag-chip-accent shrink-0">无需登录</span></div>
            <form :aria-busy="checking" @submit.prevent="checkInfo">
              <label for="redeem-code" class="block text-xs font-medium text-ink-700 mb-2">兑换码</label>
              <div class="code-entry">
                <div class="relative min-w-0 flex-1"><input id="redeem-code" ref="codeInput" v-model="code" type="text" class="input code-input w-full" placeholder="粘贴或输入您的兑换码" autocomplete="off" autocapitalize="characters" spellcheck="false" :disabled="loading || recovering" :aria-invalid="Boolean(checkError)" :aria-describedby="checkError ? 'redeem-code-error' : 'redeem-code-help'" /><button v-if="code" type="button" class="clear-code" aria-label="清空兑换码" :disabled="loading || recovering" @click="reset"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke-linecap="round" /></svg></button></div>
                <BrandButton type="submit" variant="secondary" :loading="checking" :disabled="loading || recovering || !normalizedCode" class="query-code-button">{{ checking ? '查询中' : '查询兑换码' }}</BrandButton>
              </div>
              <p id="redeem-code-help" class="mt-2.5 text-xs text-ink-400">不区分大小写，输入后按 Enter 即可查询</p>
              <div v-if="checkError" id="redeem-code-error" class="notice-box notice-error mt-4" role="alert">{{ checkError }}</div>
            </form>
          </section>
          <section v-if="redeemError || uncertainSubmission" class="card p-5 md:p-7" aria-label="核对兑换结果">
            <div class="notice-box notice-error" role="alert"><p>{{ redeemError || '此前兑换结果尚未确认，请先核对兑换记录。' }}</p><p v-if="recovering" class="mt-1">正在核对兑换记录，请稍候…</p><p v-else-if="recoveryHint" class="mt-1">{{ recoveryHint }}</p></div>
            <p v-if="uncertainSubmission" class="mt-3 text-xs text-ink-500 leading-relaxed">请先查看兑换记录，确认上一笔订单的处理结果。继续兑换会再消耗 1 次兑换次数。</p>
            <div class="mt-4 flex flex-wrap items-center gap-3"><BrandButton variant="secondary" size="sm" :loading="checking || recovering" :disabled="loading" @click="checkInfo">刷新兑换记录</BrandButton><button v-if="uncertainSubmission && canResume" type="button" class="text-link py-2" @click="resumeRedeem">已核对记录，继续兑换</button></div>
          </section>
          <section v-if="checking" class="card p-5 md:p-7" aria-label="正在查询商品" role="status"><div class="flex items-center gap-3"><div class="skeleton w-14 h-14 shrink-0" /><div class="flex-1 space-y-3"><div class="skeleton h-4 w-2/3" /><div class="skeleton h-3 w-1/2" /></div></div><p class="mt-4 text-xs text-ink-400">正在查询对应商品和兑换记录…</p></section>
          <section v-else-if="cardInfo" class="card p-5 md:p-7" aria-labelledby="redeem-product-title">
            <div class="flex items-start gap-4">
              <div class="product-cover"><img v-if="cardInfo.productCover" :src="cardInfo.productCover" alt="" class="w-full h-full object-cover" /><svg v-else class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v8l9 5 9-5V8M12 13v8" stroke-linecap="round" stroke-linejoin="round" /></svg></div>
              <div class="min-w-0 flex-1"><div class="flex items-center gap-2 flex-wrap mb-2"><span class="status-badge" :class="effectiveStatus === 'ACTIVE' && cardInfo.redeemable !== false ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-ink-50 text-ink-500 border-ink-200'">{{ cardInfo.redeemable === false ? '商品已停售' : statusLabels[effectiveStatus] || effectiveStatus }}</span><span v-if="deliveryNames[cardInfo.deliveryType || '']" class="text-xs text-ink-400">{{ deliveryNames[cardInfo.deliveryType || ''] }}</span></div><h2 id="redeem-product-title" class="text-base font-semibold text-ink-900 break-words">{{ cardInfo.productTitle || '商品信息暂不可用' }}</h2><p class="mt-1 text-sm text-ink-500 break-words">{{ cardInfo.skuName || '默认规格' }}</p></div>
            </div>
            <dl class="product-facts mt-5"><div><dt>本次领取</dt><dd>{{ cardInfo.qtyPerUse }} <span>件</span></dd></div><div><dt>剩余次数</dt><dd>{{ cardInfo.remaining }} <span>/ {{ cardInfo.maxUses }} 次</span></dd></div><div><dt>有效期（北京时间）</dt><dd class="expiry-value">{{ cardInfo.expireAt ? dateText(cardInfo.expireAt) : '长期有效' }}</dd></div></dl>
            <div v-if="unavailableMessage" class="notice-box notice-warning mt-5" role="status">{{ unavailableMessage }}</div>
            <template v-else>
              <form class="mt-6 pt-5 border-t border-ink-100" :aria-busy="loading || recovering" @submit.prevent="doRedeemCard">
                <label for="redeem-contact" class="block text-xs font-medium text-ink-700 mb-2">联系方式 <span class="text-ink-400 font-normal ml-1">可选</span></label>
                <input id="redeem-contact" v-model="contact" type="text" class="input w-full" maxlength="64" placeholder="QQ / 邮箱 / 手机" autocomplete="off" :disabled="loading || recovering || uncertainSubmission" aria-describedby="redeem-contact-help" />
                <p id="redeem-contact-help" class="text-xs text-ink-400 mt-2 leading-relaxed">如填写，查询订单时需输入相同的联系方式，请妥善保存。</p>
                <BrandButton type="submit" size="lg" block class="mt-5" :loading="loading || recovering" :disabled="!canRedeem">{{ recovering ? '核对订单中…' : loading ? '正在兑换，请稍候…' : uncertainSubmission ? '请先核对兑换记录' : '确认兑换' }}</BrandButton>
                <p class="text-center text-xs text-ink-400 mt-3">{{ uncertainSubmission ? '请先确认订单结果，避免重复消耗兑换次数' : '本次消耗 1 次兑换次数 · 无需额外支付' }}</p>
              </form>
            </template>
          </section>
          <section v-else-if="!checking && !checkError" class="ready-placeholder"><div class="w-10 h-10 rounded-xl bg-ink-100 mx-auto mb-3 flex items-center justify-center text-ink-400"><svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M9 12h6m-6 4h4M6 3h12v18H6V3Z" stroke-linecap="round" stroke-linejoin="round" /></svg></div><h2 class="text-sm font-medium text-ink-500">商品信息将在查询后显示</h2><p class="text-xs text-ink-400 mt-2">已兑换的码也能查询，方便找回历史订单</p></section>
          <section v-if="historyOrders.length" class="card p-5 md:p-7" aria-labelledby="redeem-history-title">
            <div class="flex items-center justify-between gap-3 mb-4"><h2 id="redeem-history-title" class="text-sm font-semibold text-ink-900">兑换记录</h2><span class="text-xs text-ink-400">最近 {{ historyOrders.length }} 笔</span></div>
            <ul class="space-y-2"><li v-for="order in visibleOrders" :key="order.orderNo"><button type="button" class="history-order" @click="goCardHistory(order.orderNo)"><div class="min-w-0"><p class="text-sm font-medium text-ink-800 break-words">{{ order.productTitle }}<span class="font-normal text-ink-500"> · {{ order.skuName || '默认规格' }} × {{ order.quantity }}</span></p><p class="font-mono text-xs text-ink-500 break-all mt-1.5">{{ order.orderNo }}</p><p class="text-[11px] text-ink-400 mt-1.5">{{ dateText(order.redeemedAt || order.createdAt) }}<span v-if="order.hasContact" class="text-amber-600 ml-2">查看需验证联系方式</span></p></div><div class="history-status"><span class="status-badge" :class="(orderStatusLabels[order.status] || { cls: 'bg-ink-50 text-ink-500 border-ink-200' }).cls">{{ (orderStatusLabels[order.status] || { text: order.status }).text }}</span><svg class="w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke-linecap="round" stroke-linejoin="round" /></svg></div></button></li></ul>
            <button v-if="historyOrders.length > 3" type="button" class="w-full text-link mt-4 py-1" @click="showAllHistory = !showAllHistory">{{ showAllHistory ? '收起记录' : `查看全部 ${historyOrders.length} 笔记录` }}</button>
          </section>
        </template>
      </div>
      <aside class="redeem-help space-y-4" aria-label="兑换帮助">
        <section class="card p-5"><div class="flex items-center gap-2 mb-4"><span class="w-2 h-2 rounded-full bg-brand-500" /><h2 class="text-sm font-semibold text-ink-900">兑换小提示</h2></div><ul class="help-list"><li><strong>先确认，再兑换</strong><p>查询不会消耗次数，核对商品和规格后再确认兑换。</p></li><li><strong>保存订单号</strong><p>交付状态和内容可在订单页查看。兑换后请保存订单号。</p></li><li><strong>已兑换也能找回</strong><p>再次查询同一个兑换码，即可查看最近的兑换记录。</p></li></ul><router-link to="/query" class="help-query-link mt-5">已有订单号？查询订单<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke-linecap="round" stroke-linejoin="round" /></svg></router-link></section>
        <section class="rounded-2xl border border-ink-100 bg-white/60 p-5"><h2 class="text-xs font-medium text-ink-700 mb-3">常见问题</h2><details class="help-question"><summary>兑换码无法使用怎么办？</summary><p>核对是否复制完整，去掉首尾空格。若提示已禁用、过期或商品停售，请联系提供兑换码的客服。</p></details><details class="help-question"><summary>兑换后还没有收到商品？</summary><p>先查看兑换记录或订单页的发货状态。人工处理或待发货订单请等待处理，避免重复兑换。</p></details></section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.redeem-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 272px; gap: 24px; align-items: start; }
.redeem-steps { display: flex; align-items: center; justify-content: center; padding: 0; list-style: none; }
.redeem-steps li { display: flex; align-items: center; gap: 9px; color: #a8a29e; font-size: 12px; }
.redeem-steps li + li::before { content: ''; width: 60px; height: 1px; background: #e7e5e4; margin: 0 15px 0 6px; }
.step-number { display: flex; align-items: center; justify-content: center; width: 25px; height: 25px; border: 1px solid #e7e5e4; border-radius: 50%; background: white; font-size: 11px; }
.step-number svg { width: 13px; height: 13px; }
.redeem-steps .step-current { color: #047857; font-weight: 600; }
.step-current .step-number { background: #059669; border-color: #059669; color: white; }
.redeem-steps .step-done { color: #047857; }
.step-done .step-number { background: #ecfdf5; border-color: #a7f3d0; }
.code-entry { display: flex; gap: 10px; align-items: center; }
.code-input { height: 46px; padding-right: 38px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .03em; }
.code-input::placeholder { text-transform: none; letter-spacing: normal; font-family: Inter, system-ui, sans-serif; }
.query-code-button { height: 46px; }
.clear-code { position: absolute; inset: 0 5px 0 auto; width: 30px; display: flex; align-items: center; justify-content: center; color: #a8a29e; border-radius: 8px; }
.clear-code:hover:not(:disabled) { color: #57534e; }
input:disabled { background: #fafaf9; cursor: not-allowed; color: #a8a29e; }
.ready-placeholder { text-align: center; border: 1px dashed #e7e5e4; border-radius: 16px; padding: 36px 20px; }
.product-cover { width: 60px; height: 60px; border-radius: 13px; overflow: hidden; background: #ecfdf5; color: #059669; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.status-badge { display: inline-flex; align-items: center; border-width: 1px; border-style: solid; font-size: 11px; font-weight: 500; border-radius: 6px; padding: 3px 8px; white-space: nowrap; }
.product-facts { display: grid; grid-template-columns: .85fr 1fr 1.5fr; gap: 12px; padding: 16px; background: #fafaf9; border: 1px solid #f5f5f4; border-radius: 12px; }
.product-facts dt { color: #a8a29e; font-size: 11px; margin-bottom: 7px; }
.product-facts dd { color: #292524; font-size: 18px; font-weight: 600; }
.product-facts dd span { font-size: 12px; font-weight: 400; color: #78716c; }
.product-facts .expiry-value { font-size: 12px; line-height: 25px; font-weight: 500; }
.notice-box { border: 1px solid; border-radius: 10px; padding: 12px 14px; font-size: 12px; line-height: 1.8; }
.notice-error { color: #be123c; background: #fff1f2; border-color: #ffe4e6; }
.notice-warning { color: #b45309; background: #fffbeb; border-color: #fde68a; }
.notice-neutral { color: #57534e; background: #fafaf9; border-color: #e7e5e4; }
.text-link { color: #047857; font-size: 12px; }
.text-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.result-banner { border-bottom: 1px solid #f5f5f4; }
.result-delivered { background: linear-gradient(110deg, #ecfdf5, #ffffff); }
.result-pending { background: linear-gradient(110deg, #f0f9ff, #ffffff); }
.result-icon { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: white; color: #059669; border: 1px solid #d1fae5; }
.result-pending .result-icon { color: #0284c7; border-color: #e0f2fe; }
.order-summary > div { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 12px; margin-bottom: 12px; }
.order-summary > div:last-child { margin-bottom: 0; }
.order-summary dt { color: #a8a29e; font-size: 12px; }
.order-summary dd { color: #292524; text-align: right; overflow-wrap: anywhere; }
.delivery-item { background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 12px; padding: 15px; }
.delivery-field { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: start; }
.delivery-field > span { color: #a8a29e; font-size: 11px; padding-top: 2px; }
.delivery-field code { color: #44403c; font-size: 12px; overflow-wrap: anywhere; line-height: 1.7; }
.token-content { max-height: 144px; overflow-y: auto; padding-right: 5px; }
.result-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.history-order { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px; text-align: left; background: #fafaf9; border: 1px solid transparent; border-radius: 12px; transition: border-color .15s, background .15s; }
.history-order:hover { border-color: #a7f3d0; background: #f0fdf4; }
.history-status { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.help-list { display: flex; flex-direction: column; gap: 17px; }
.help-list strong { font-size: 12px; font-weight: 500; color: #57534e; }
.help-list p { color: #a8a29e; font-size: 12px; line-height: 1.8; margin-top: 5px; }
.help-query-link { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #f5f5f4; padding-top: 15px; color: #047857; font-size: 12px; }
.help-question { font-size: 12px; color: #78716c; }
.help-question + .help-question { border-top: 1px solid #f5f5f4; margin-top: 12px; padding-top: 12px; }
.help-question summary { cursor: pointer; }
.help-question p { font-size: 11px; color: #a8a29e; line-height: 1.9; margin-top: 9px; }
.redeem-page button:focus-visible, .redeem-page a:focus-visible, .redeem-page summary:focus-visible { outline: 2px solid #059669; outline-offset: 3px; }
@media (max-width: 767px) {
  .redeem-workspace { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .redeem-steps li { gap: 6px; font-size: 11px; }
  .redeem-steps li + li::before { width: 22px; margin: 0 9px 0 3px; }
  .redeem-help { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .redeem-help > section { margin-top: 0; }
}
@media (max-width: 479px) {
  .code-entry { flex-direction: column; align-items: stretch; }
  .query-code-button { width: 100%; }
  .redeem-help { display: block; }
  .redeem-help > section + section { margin-top: 16px; }
  .product-facts { grid-template-columns: 1fr 1fr; }
  .product-facts > div:last-child { grid-column: 1 / -1; }
  .history-order { align-items: start; gap: 8px; }
  .history-status { flex-direction: column; align-items: end; gap: 8px; }
  .order-summary > div { grid-template-columns: 76px minmax(0, 1fr); gap: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .history-order { transition: none; }
}
</style>
