<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import { useUserStore } from '@/stores/user';
import RichContent from '@/components/RichContent.vue';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const packageKey = computed(() => decodeURIComponent(route.params.packageKey as string));
const pkg = ref<any>(null);
const loading = ref(true);

const quantity = ref(1);
const MAX_QTY = 100;
const contact = ref('');
type PayMethod = 'ALIPAY' | 'BALANCE' | 'POINTS' | 'REDEEM';
const payMethod = ref<PayMethod>('ALIPAY');
const redeemCode = ref('');
const submitting = ref(false);
const alipayEnabled = ref(false);
const errorMsg = ref('');

// VIP 折扣
const vipMe = ref<{
  tier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
  tierName: string;
  defaultDiscount: number;
  customDiscount: number | null;
  tierColor: string | null;
  tierIcon: string | null;
} | null>(null);
const vipOverrides = ref<Record<string, number>>({});

const lineTotalOriginal = computed(() => {
  if (!pkg.value) return 0;
  return +(pkg.value.displayPrice * quantity.value).toFixed(2);
});
const vipDiscount = computed(() => {
  if (!vipMe.value || vipMe.value.tier === 'NONE') return 1;
  const t = vipMe.value.tier;
  if (vipOverrides.value[t] !== undefined) return vipOverrides.value[t];
  return vipMe.value.defaultDiscount;
});
const isCustomDiscount = computed(() => {
  if (payMethod.value === 'REDEEM') return false;
  const c = vipMe.value?.customDiscount;
  return c != null && c < vipDiscount.value;
});
const effectiveDiscount = computed(() => {
  if (payMethod.value === 'REDEEM') return 1;
  return isCustomDiscount.value ? (vipMe.value!.customDiscount as number) : vipDiscount.value;
});
const discountLabel = computed(() =>
  isCustomDiscount.value
    ? '专属折扣'
    : `${vipMe.value?.tierIcon ?? ''} ${vipMe.value?.tierName ?? ''}`.trim(),
);
const discountAmount = computed(() => {
  if (effectiveDiscount.value >= 1) return 0;
  return +(lineTotalOriginal.value * (1 - effectiveDiscount.value)).toFixed(2);
});
const lineTotal = computed(() =>
  +(lineTotalOriginal.value - discountAmount.value).toFixed(2),
);

const userBalance = computed(() => Number(userStore.profile?.balance ?? 0));
const balanceEnough = computed(() => userBalance.value >= lineTotal.value);
const userPoints = computed(() => Number(userStore.profile?.points ?? 0));
const pointsRequired = computed(() => Math.ceil(lineTotal.value));
const pointsEnough = computed(() => userPoints.value >= pointsRequired.value);
const pointsAwardEnabled = computed(() => pkg.value?.pointsAwardEnabled !== false);
const pointsPayEnabled = computed(() => pkg.value?.pointsPayEnabled !== false);
const pointsAwardRate = computed(() => {
  const r = pkg.value?.pointsAwardRate;
  if (r === null || r === undefined || r === '') return 0.1;
  const n = Number(r);
  if (!Number.isFinite(n)) return 0.1;
  return Math.max(0, Math.min(1, n));
});
const expectedPointsReward = computed(() =>
  Math.floor(lineTotal.value * pointsAwardRate.value),
);

const canSubmit = computed(() => {
  if (!pkg.value) return false;
  if (quantity.value < 1 || quantity.value > MAX_QTY) return false;
  if (payMethod.value === 'REDEEM' && !redeemCode.value.trim()) return false;
  if (payMethod.value === 'ALIPAY' && !alipayEnabled.value) return false;
  if (payMethod.value === 'BALANCE') {
    if (!userStore.isLoggedIn) return false;
    if (!balanceEnough.value) return false;
  }
  if (payMethod.value === 'POINTS') {
    if (!pointsPayEnabled.value) return false;
    if (!userStore.isLoggedIn) return false;
    if (!pointsEnough.value) return false;
  }
  return true;
});

async function load() {
  loading.value = true;
  try {
    pkg.value = await api.forge.quota.getPackage(packageKey.value);
  } catch (e: any) {
    errorMsg.value = e?.response?.data?.error?.message || '加载额度包失败';
  } finally {
    loading.value = false;
  }
  try {
    const r = await api.pay.alipayEnabled();
    alipayEnabled.value = !!r.enabled;
    if (!alipayEnabled.value) {
      payMethod.value = userStore.isLoggedIn ? 'BALANCE' : 'REDEEM';
    }
  } catch {
    alipayEnabled.value = false;
    payMethod.value = userStore.isLoggedIn ? 'BALANCE' : 'REDEEM';
  }
  if (!pointsPayEnabled.value && payMethod.value === 'POINTS') {
    payMethod.value = alipayEnabled.value
      ? 'ALIPAY'
      : userStore.isLoggedIn
      ? 'BALANCE'
      : 'REDEEM';
  }
  if (userStore.isLoggedIn) {
    try {
      vipMe.value = await api.vip.me() as any;
    } catch {
      vipMe.value = null;
    }
  }
  try {
    const overrides = await api.vip.productDiscounts('FORGE_QUOTA', packageKey.value);
    const map: Record<string, number> = {};
    for (const o of overrides) {
      if (o.isOverride) map[o.tier] = o.discount;
    }
    vipOverrides.value = map;
  } catch {
    vipOverrides.value = {};
  }
}

function isMobile() {
  return /Mobi|Android|iPhone/i.test(navigator.userAgent);
}

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  errorMsg.value = '';

  let payWindow: Window | null = null;
  if (payMethod.value === 'ALIPAY') {
    payWindow = window.open('', '_blank');
  }

  submitting.value = true;
  try {
    if (payMethod.value === 'REDEEM') {
      const order = await api.forge.quota.order({
        code: redeemCode.value.trim(),
        packageKey: packageKey.value,
        quantity: quantity.value,
        contact: contact.value.trim() || undefined,
      });
      router.push(`/quota-order/${encodeURIComponent(order.orderNo)}`);
    } else if (payMethod.value === 'BALANCE') {
      const order = await api.forge.quota.balanceOrder({
        packageKey: packageKey.value,
        quantity: quantity.value,
        contact: contact.value.trim() || undefined,
      });
      await userStore.restore();
      router.push(`/quota-order/${encodeURIComponent(order.orderNo)}`);
    } else if (payMethod.value === 'POINTS') {
      const order = await api.forge.quota.pointsOrder({
        packageKey: packageKey.value,
        quantity: quantity.value,
        contact: contact.value.trim() || undefined,
      });
      await userStore.restore();
      router.push(`/quota-order/${encodeURIComponent(order.orderNo)}`);
    } else {
      const order = await api.forge.quota.alipayOrder({
        packageKey: packageKey.value,
        quantity: quantity.value,
        contact: contact.value.trim() || undefined,
      });
      const channel = isMobile() ? 'WAP' : 'PC';
      const { payUrl } = await api.pay.alipayCreate(order.orderNo, channel);
      if (payWindow) payWindow.location.href = payUrl;
      else window.open(payUrl, '_blank');
      router.push(`/quota-order/${encodeURIComponent(order.orderNo)}`);
    }
  } catch (e: any) {
    if (payWindow) payWindow.close();
    const msg = e?.response?.data?.error?.message || e?.response?.data?.message || e?.message || '下单失败';
    errorMsg.value = msg;
    ElMessage.error(msg);
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="max-w-5xl mx-auto px-4 py-8">
    <div v-if="loading" class="card p-10 text-center text-ink-400 text-sm">加载中…</div>

    <div v-else-if="!pkg" class="card p-10 text-center">
      <div class="text-rose-600 text-sm">{{ errorMsg || '额度包不存在或已下架' }}</div>
      <button
        class="mt-4 px-4 py-2 rounded-lg border border-ink-200 text-sm hover:bg-ink-50"
        @click="router.push('/')"
      >返回首页</button>
    </div>

    <template v-else>
      <div class="card p-6 bg-white border border-ink-100 rounded-2xl">
        <!-- 头部：封面 + 标题 -->
        <div class="flex items-start gap-4">
          <div
            v-if="pkg.coverImage"
            class="w-20 h-20 rounded-lg overflow-hidden bg-ink-50 shrink-0 relative"
          >
            <img
              :src="pkg.coverImage"
              alt=""
              referrerpolicy="no-referrer"
              class="w-full h-full object-cover"
              @error="(($event.target as HTMLImageElement).style.display = 'none')"
            />
            <span class="absolute inset-0 flex items-center justify-center font-bold text-ink-400 text-2xl select-none -z-10">
              {{ pkg.name.slice(0, 1) }}
            </span>
          </div>
          <div
            v-else
            class="w-20 h-20 rounded-lg bg-gradient-to-br from-emerald-50 to-teal-100 text-emerald-700 flex flex-col items-center justify-center shrink-0"
          >
            <span class="text-xl font-bold leading-none">${{ pkg.quotaUsd }}</span>
            <span class="text-[10px] mt-1">额度</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs text-ink-500 mb-1">中转 Key 额度包</div>
            <h1 class="text-2xl font-semibold text-ink-900">{{ pkg.name }}</h1>
            <p v-if="pkg.subtitle" class="text-sm text-ink-600 mt-1.5">{{ pkg.subtitle }}</p>
            <p v-else class="text-sm text-ink-600 mt-1.5">
              面值 ${{ pkg.quotaUsd }} 美金 · 兑换码形式发货，官网登录核销即到账
            </p>
          </div>
        </div>

        <!-- 亮点列表 -->
        <ul
          v-if="pkg.highlights && pkg.highlights.length"
          class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-ink-700"
        >
          <li v-for="(h, i) in pkg.highlights" :key="i" class="flex gap-1.5">
            <span class="text-emerald-500 font-bold">✓</span><span>{{ h }}</span>
          </li>
        </ul>

        <div class="flex items-end justify-between gap-4 mt-4 pb-5 border-b border-ink-100">
          <div>
            <div class="text-3xl font-bold text-rose-600">¥{{ pkg.displayPrice.toFixed(2) }}</div>
            <div class="text-xs text-ink-500 mt-1">单价 / 个（面值 ${{ pkg.quotaUsd }}）</div>
          </div>
          <div class="text-right text-xs space-y-1">
            <div class="text-emerald-600">✓ 下单即发兑换码</div>
            <div class="text-ink-600">已有按额度计费的 Key → 面值直接充入</div>
            <div class="text-ink-600">没有 Key → 核销时自动创建新 Key</div>
          </div>
        </div>

        <!-- 详细描述 -->
        <div v-if="pkg.description" class="mt-5 pb-5 border-b border-ink-100">
          <div class="text-xs font-semibold tracking-widest uppercase text-ink-500 mb-2">商品介绍</div>
          <RichContent :html="pkg.description" />
        </div>

        <!-- 数量 -->
        <div class="mt-5 flex items-center justify-between">
          <label class="text-sm text-ink-700">购买数量（1-{{ MAX_QTY }}）</label>
          <div class="flex items-center gap-2">
            <button
              class="w-8 h-8 rounded-md border border-ink-200 hover:bg-ink-50 disabled:opacity-50"
              :disabled="quantity <= 1"
              @click="quantity = Math.max(1, quantity - 1)"
            >−</button>
            <input
              v-model.number="quantity"
              type="number"
              min="1"
              :max="MAX_QTY"
              class="w-16 text-center px-2 py-1 border border-ink-200 rounded-md text-sm"
            />
            <button
              class="w-8 h-8 rounded-md border border-ink-200 hover:bg-ink-50 disabled:opacity-50"
              :disabled="quantity >= MAX_QTY"
              @click="quantity = Math.min(MAX_QTY, quantity + 1)"
            >+</button>
          </div>
        </div>

        <!-- 联系方式 -->
        <div class="mt-5">
          <label class="block text-sm text-ink-700 mb-2">联系方式（可选）</label>
          <input
            v-model="contact"
            placeholder="QQ / 邮箱 / 手机号，便于售后查单"
            maxlength="128"
            class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm"
          />
          <p class="text-[11px] text-ink-400 mt-1">
            填了之后，再次访问订单页需要验证这个联系方式（防订单号被别人猜中）。
          </p>
        </div>

        <!-- 支付方式 -->
        <div class="mt-6">
          <label class="block text-sm text-ink-700 mb-2">支付方式</label>
          <div
            :class="[
              'grid gap-2',
              pointsPayEnabled
                ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
                : 'grid-cols-1 sm:grid-cols-3',
            ]"
          >
            <button
              :class="[
                'p-3 rounded-lg border-2 text-left transition min-w-0',
                payMethod === 'ALIPAY'
                  ? 'border-brand-500 bg-brand-50/30'
                  : 'border-ink-100 hover:border-ink-300',
                !alipayEnabled ? 'opacity-50 cursor-not-allowed' : '',
              ]"
              :disabled="!alipayEnabled"
              @click="alipayEnabled && (payMethod = 'ALIPAY')"
            >
              <div class="font-medium text-sm text-ink-900 flex items-center gap-2 whitespace-nowrap">
                <svg class="w-4 h-4 text-[#1677ff]" viewBox="0 0 1024 1024" fill="currentColor">
                  <path d="M230 0h564c127 0 230 103 230 230v564c0 127-103 230-230 230H230C103 1024 0 921 0 794V230C0 103 103 0 230 0z"/>
                </svg>
                支付宝
              </div>
              <div class="text-[11px] text-ink-500 mt-1">
                {{ alipayEnabled ? '扫码支付，秒发码' : '未启用' }}
              </div>
            </button>

            <button
              v-if="pointsPayEnabled"
              :class="[
                'p-3 rounded-lg border-2 text-left transition min-w-0',
                payMethod === 'POINTS' ? 'border-brand-500 bg-brand-50/30' : 'border-ink-100 hover:border-ink-300',
              ]"
              @click="payMethod = 'POINTS'"
            >
              <div class="font-medium text-sm text-ink-900 flex items-center justify-between gap-2 min-w-0">
                <span class="flex items-center gap-2 whitespace-nowrap min-w-0">
                  <svg class="w-4 h-4 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.3 6.7 19l1-5.8-4.2-4.1 5.9-.9L12 3z" stroke-linejoin="round"/>
                  </svg>
                  积分
                </span>
                <span v-if="userStore.isLoggedIn" class="text-xs whitespace-nowrap shrink-0" :class="pointsEnough ? 'text-emerald-600' : 'text-rose-600'">
                  {{ userPoints }} 分
                </span>
              </div>
              <div class="text-[11px] text-ink-500 mt-1">
                <template v-if="!userStore.isLoggedIn">登录后可用</template>
                <template v-else-if="!pointsEnough">需 {{ pointsRequired }} 分，还差 {{ pointsRequired - userPoints }}</template>
                <template v-else>需 {{ pointsRequired }} 分</template>
              </div>
            </button>

            <button
              :class="[
                'p-3 rounded-lg border-2 text-left transition min-w-0',
                payMethod === 'BALANCE' ? 'border-brand-500 bg-brand-50/30' : 'border-ink-100 hover:border-ink-300',
              ]"
              @click="payMethod = 'BALANCE'"
            >
              <div class="font-medium text-sm text-ink-900 flex items-center justify-between gap-2 min-w-0">
                <span class="flex items-center gap-2 whitespace-nowrap min-w-0">
                  <svg class="w-4 h-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  账户余额
                </span>
                <span v-if="userStore.isLoggedIn" class="text-xs whitespace-nowrap shrink-0" :class="balanceEnough ? 'text-emerald-600' : 'text-rose-600'">
                  ¥{{ userBalance.toFixed(2) }}
                </span>
              </div>
              <div class="text-[11px] text-ink-500 mt-1">
                <template v-if="!userStore.isLoggedIn">登录后可用</template>
                <template v-else-if="!balanceEnough">余额不足，前往充值</template>
                <template v-else>即时扣款，立即发码</template>
              </div>
            </button>

            <button
              :class="[
                'p-3 rounded-lg border-2 text-left transition min-w-0',
                payMethod === 'REDEEM' ? 'border-brand-500 bg-brand-50/30' : 'border-ink-100 hover:border-ink-300',
              ]"
              @click="payMethod = 'REDEEM'"
            >
              <div class="font-medium text-sm text-ink-900 whitespace-nowrap">兑换码</div>
              <div class="text-[11px] text-ink-500 mt-1">使用已购买的兑换码</div>
            </button>
          </div>

          <div v-if="payMethod === 'REDEEM'" class="mt-3">
            <input
              v-model="redeemCode"
              placeholder="请输入兑换码"
              class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm font-mono tracking-wider"
            />
          </div>
          <div v-if="payMethod === 'BALANCE' && userStore.isLoggedIn && !balanceEnough" class="mt-3">
            <button
              class="text-xs text-brand-600 hover:underline"
              @click="router.push('/recharge')"
            >→ 前往充值</button>
          </div>
          <div v-if="payMethod === 'BALANCE' && !userStore.isLoggedIn" class="mt-3">
            <button
              class="text-xs text-brand-600 hover:underline"
              @click="router.push({ name: 'login', query: { redirect: route.fullPath } })"
            >→ 去登录</button>
          </div>
          <div v-if="payMethod === 'POINTS' && pointsPayEnabled && !userStore.isLoggedIn" class="mt-3">
            <button
              class="text-xs text-brand-600 hover:underline"
              @click="router.push({ name: 'login', query: { redirect: route.fullPath } })"
            >→ 去登录</button>
          </div>
        </div>

        <!-- 总价 + 下单按钮 -->
        <div class="mt-6 pt-5 border-t border-ink-100">
          <div v-if="discountAmount > 0" class="mb-2 flex items-center justify-between text-xs">
            <span class="text-ink-500">原价</span>
            <span class="text-ink-400 line-through">¥{{ lineTotalOriginal.toFixed(2) }}</span>
          </div>
          <div v-if="discountAmount > 0" class="mb-3 flex items-center justify-between text-xs">
            <span class="text-rose-600">
              {{ discountLabel }}{{ isCustomDiscount ? '' : '专属' }}（{{ (effectiveDiscount * 10).toFixed(1) }} 折）
            </span>
            <span class="text-rose-600 font-medium">-¥{{ discountAmount.toFixed(2) }}</span>
          </div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm text-ink-500">{{ discountAmount > 0 ? '实付' : '合计' }}</span>
            <span class="text-2xl font-bold text-rose-600">¥{{ lineTotal.toFixed(2) }}</span>
          </div>
          <div
            v-if="pointsAwardEnabled && payMethod !== 'POINTS' && expectedPointsReward > 0"
            class="mb-3 text-[11px] text-amber-600"
          >
            登录用户成功发货预计返 {{ expectedPointsReward }} 积分
          </div>
          <div v-else-if="payMethod === 'POINTS'" class="mb-3 text-[11px] text-ink-500">
            本单将使用 {{ pointsRequired }} 积分支付，不再返积分
          </div>

          <div v-if="errorMsg" class="text-sm text-rose-600 mb-3">{{ errorMsg }}</div>

          <button
            class="w-full px-4 py-3 rounded-lg brand-gradient text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            :disabled="!canSubmit || submitting"
            @click="submit"
          >
            <template v-if="submitting">下单中（请勿刷新）…</template>
            <template v-else-if="payMethod === 'ALIPAY'">立即支付（支付宝）</template>
            <template v-else-if="payMethod === 'BALANCE'">使用余额支付</template>
            <template v-else-if="payMethod === 'POINTS'">使用积分支付</template>
            <template v-else>使用兑换码下单</template>
          </button>

          <p class="text-xs text-ink-400 mt-3 text-center">
            付款成功后自动跳到订单页，兑换码即时可见；拿码到官网登录核销，面值自动充入你的中转 Key。
          </p>
        </div>

        <!-- 购买须知 -->
        <div
          class="mt-5 p-3.5 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-900 leading-relaxed"
        >
          <div class="font-semibold mb-1 flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke-linecap="round" stroke-linejoin="round"/></svg>
            购买须知
          </div>
          <div v-if="pkg.notice" class="whitespace-pre-wrap">{{ pkg.notice }}</div>
          <div v-else class="space-y-0.5">
            <p>· 兑换码为不记名资产，请妥善保管，泄漏等同丢货。</p>
            <p>· 已有按额度计费的中转 Key：核销后面值直接充入；没有则自动按对应线路创建新 Key。</p>
            <p>· 兑换码一经核销不支持退款；未核销的码如需售后请联系客服。</p>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
