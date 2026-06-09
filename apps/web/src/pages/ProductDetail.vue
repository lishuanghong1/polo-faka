<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElRadioGroup, ElRadio, ElInputNumber, ElButton } from 'element-plus';
import api from '@/api';
import { useUserStore } from '@/stores/user';
import RichContent from '@/components/RichContent.vue';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const product = ref<any>(null);
const skuId = ref<number | null>(null);
const qty = ref(1);
const contact = ref('');
const submitting = ref(false);
const alipayEnabled = ref(false);

type PayMethod = 'ALIPAY' | 'BALANCE' | 'POINTS';
const payMethod = ref<PayMethod>('ALIPAY');

// VIP 折扣相关
const vipMe = ref<{
  tier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
  tierName: string;
  defaultDiscount: number;
  tierColor: string | null;
  tierIcon: string | null;
} | null>(null);
const vipOverrides = ref<Record<string, number>>({}); // tier -> discount

const currentSku = computed(() => product.value?.skus?.find((s: any) => s.id === skuId.value));
const isPoolQuotaProduct = computed(() => product.value?.deliveryType === 'POOL_QUOTA');
// 商品级积分开关（后端没下发时默认开启返积分、禁用积分支付以保守为先）
const pointsAwardEnabled = computed(() => product.value?.pointsAwardEnabled !== false);
const pointsPayEnabled = computed(() => product.value?.pointsPayEnabled === true);
const bulk = computed<any[] | null>(() => product.value?.bulkPricing || null);
const unitPrice = computed(() => {
  if (!currentSku.value) return 0;
  if (Array.isArray(bulk.value) && bulk.value.length) {
    const hit = bulk.value.find((b) => qty.value >= b.min && qty.value <= b.max);
    if (hit) return Number(hit.price);
  }
  return Number(currentSku.value.price);
});
const originalAmount = computed(() => +(unitPrice.value * qty.value).toFixed(2));
const effectiveDiscount = computed(() => {
  if (!vipMe.value || vipMe.value.tier === 'NONE') return 1;
  const t = vipMe.value.tier;
  if (vipOverrides.value[t] !== undefined) return vipOverrides.value[t];
  return vipMe.value.defaultDiscount;
});
const discountAmount = computed(() => {
  if (effectiveDiscount.value >= 1) return 0;
  return +(originalAmount.value * (1 - effectiveDiscount.value)).toFixed(2);
});
const totalAmount = computed(() => +(originalAmount.value - discountAmount.value).toFixed(2));
const userBalance = computed(() => Number(userStore.profile?.balance ?? 0));
const balanceEnough = computed(() => userBalance.value >= totalAmount.value);
const userPoints = computed(() => Number(userStore.profile?.points ?? 0));
const pointsRequired = computed(() => Math.ceil(totalAmount.value));
const pointsEnough = computed(() => userPoints.value >= pointsRequired.value);
const expectedPointsReward = computed(() => Math.floor(totalAmount.value * 0.1));

async function load() {
  product.value = await api.product(Number(route.params.id));
  const first = product.value.skus?.[0];
  skuId.value = first ? first.id : null;

  try {
    const r = await api.pay.alipayEnabled();
    alipayEnabled.value = !!r.enabled;
  } catch {
    alipayEnabled.value = false;
  }
  if (!alipayEnabled.value && userStore.isLoggedIn) {
    payMethod.value = 'BALANCE';
  }
  // 该商品禁用积分支付时，确保默认支付方式不是积分
  if (!pointsPayEnabled.value && payMethod.value === 'POINTS') {
    payMethod.value = alipayEnabled.value ? 'ALIPAY' : 'BALANCE';
  }
  // VIP 折扣（登录才有 tier；商品 override 任何人都能取）
  if (userStore.isLoggedIn) {
    try {
      vipMe.value = await api.vip.me() as any;
    } catch {
      vipMe.value = null;
    }
  }
  try {
    const overrides = await api.vip.productDiscounts('LOCAL', String(product.value.id));
    const map: Record<string, number> = {};
    for (const o of overrides) {
      if (o.isOverride) map[o.tier] = o.discount;
    }
    vipOverrides.value = map;
  } catch {
    vipOverrides.value = {};
  }
}

onMounted(load);

function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

async function buy() {
  if (!skuId.value) return;
  if (isPoolQuotaProduct.value && !userStore.isLoggedIn) {
    ElMessage.warning('号池额度包需要先登录');
    router.push({ name: 'login', query: { redirect: route.fullPath } });
    return;
  }
  if (isPoolQuotaProduct.value && currentSku.value && currentSku.value.stock <= 0) {
    ElMessage.warning('暂无可申请的号池账号，请稍后再试');
    return;
  }
  if (payMethod.value === 'BALANCE') {
    if (!userStore.isLoggedIn) {
      ElMessage.warning('余额支付需要先登录');
      router.push({ name: 'login', query: { redirect: route.fullPath } });
      return;
    }
    if (!balanceEnough.value) {
      ElMessage.warning('余额不足，前往充值');
      router.push('/recharge');
      return;
    }
  } else if (payMethod.value === 'POINTS') {
    if (!userStore.isLoggedIn) {
      ElMessage.warning('积分支付需要先登录');
      router.push({ name: 'login', query: { redirect: route.fullPath } });
      return;
    }
    if (!pointsPayEnabled.value) {
      ElMessage.warning('该商品暂不支持积分支付');
      return;
    }
    if (!pointsEnough.value) {
      ElMessage.warning(`积分不足，还差 ${pointsRequired.value - userPoints.value} 积分`);
      return;
    }
  } else if (!alipayEnabled.value) {
    ElMessage.warning('支付宝暂未启用，请稍后再试');
    return;
  }

  // 支付宝：在点击的同步上下文里先开一个空白页签，避免 await 之后被浏览器拦截弹窗
  let payWindow: Window | null = null;
  if (payMethod.value === 'ALIPAY') {
    payWindow = window.open('', '_blank');
  }

  submitting.value = true;
  try {
    const order = await api.createOrder({
      productId: product.value.id,
      skuId: skuId.value,
      quantity: qty.value,
      payMethod: payMethod.value,
      contact: contact.value || undefined,
    });
    if (payMethod.value === 'BALANCE' || payMethod.value === 'POINTS') {
      ElMessage.success('支付成功，准备发货');
      await userStore.restore();
      router.push(`/order/${order.orderNo}`);
      return;
    }
    const channel = isMobile() ? 'WAP' : 'PC';
    const { payUrl } = await api.pay.alipayCreate(order.orderNo, channel);
    // 支付宝在新页签打开，当前页跳到订单页轮询支付状态
    if (payWindow) payWindow.location.href = payUrl;
    else window.open(payUrl, '_blank');
    router.push(`/order/${order.orderNo}`);
  } catch (e: any) {
    if (payWindow) payWindow.close();
    ElMessage.error(e?.response?.data?.error?.message || e?.message || '下单失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="!product" class="text-center py-20 text-ink-400">加载中...</div>
  <div v-else class="max-w-4xl mx-auto px-4 py-8">
    <button class="text-sm text-ink-500 hover:text-brand-600 mb-3" @click="router.back()">
      ← 返回
    </button>

    <div class="card p-6">
      <div class="flex items-center gap-2 flex-wrap mb-2">
        <span
          v-for="t in (Array.isArray(product.tags) ? product.tags : [])"
          :key="t"
          class="tag-chip"
        >{{ t }}</span>
      </div>
      <h1 class="text-xl md:text-2xl font-bold leading-snug text-ink-900">{{ product.title }}</h1>
      <p v-if="product.subtitle" class="mt-2 text-sm text-ink-500">{{ product.subtitle }}</p>

      <RichContent v-if="product.description" :html="product.description" class="mt-4" />

      <div class="mt-5 text-xs text-ink-400 flex gap-4">
        <span>已售 {{ product.sales }}</span>
      </div>

      <div class="mt-6">
        <div class="text-sm text-ink-700 mb-2">规格</div>
        <el-radio-group v-model="skuId">
          <el-radio
            v-for="s in product.skus"
            :key="s.id"
            :value="s.id"
            class="!mr-2 !mb-2"
          >
            <span>{{ s.name }}</span>
            <span class="ml-1 text-rose-600 font-medium">¥{{ s.price }}</span>
            <span
              class="ml-1 text-xs"
              :class="s.stock <= 0 ? 'text-amber-600' : 'text-ink-400'"
            >
              ({{
                isPoolQuotaProduct
                  ? (s.stock <= 0 ? '暂无可申请账号' : `可申请 ${s.stock} 个账号`)
                  : (s.stock <= 0 ? '需联系客服' : s.stock)
              }})
            </span>
          </el-radio>
        </el-radio-group>
      </div>

      <div
        v-if="currentSku && currentSku.stock <= 0 && !isPoolQuotaProduct"
        class="mt-3 px-3 py-2 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-800 leading-relaxed"
      >
        当前规格暂无库存，可正常下单并完成支付，付款后我们会人工尽快为您发货；如急需可在订单页联系客服。
      </div>

      <div
        v-if="isPoolQuotaProduct"
        class="mt-3 px-3 py-2 rounded-lg bg-brand-50/70 border border-brand-200 text-xs text-brand-900 leading-relaxed"
      >
        该商品为高级模型额度包。付款后会生成可用额度，您可在订单页申请号池账号；额度用完或过期后不再展示账号 Token。
      </div>

      <div v-if="bulk && bulk.length" class="mt-4 text-xs text-ink-500">
        批量优惠：
        <span v-for="(b, i) in bulk" :key="i" class="mr-3">
          {{ b.min }}-{{ b.max }} 个 ¥{{ b.price }}
        </span>
      </div>

      <div class="mt-4 flex items-center gap-3">
        <span class="text-sm text-ink-700">数量</span>
        <el-input-number v-model="qty" :min="1" :max="1000" />
      </div>

      <div class="mt-4">
        <div class="text-sm text-ink-700 mb-2">支付方式</div>
        <div
          :class="[
            'grid gap-2',
            pointsPayEnabled ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2',
          ]"
        >
          <button
            type="button"
            :class="[
              'text-left px-3 py-2.5 rounded-lg border-2 transition flex items-center gap-2 text-sm',
              payMethod === 'ALIPAY'
                ? 'border-brand-500 bg-brand-50/40'
                : 'border-ink-200 hover:border-ink-300 bg-white',
              !alipayEnabled && 'opacity-50 cursor-not-allowed',
            ]"
            :disabled="!alipayEnabled"
            @click="alipayEnabled && (payMethod = 'ALIPAY')"
          >
            <svg class="w-4 h-4 text-[#1677ff]" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M230 0h564c127 0 230 103 230 230v564c0 127-103 230-230 230H230C103 1024 0 921 0 794V230C0 103 103 0 230 0z"/>
              <path fill="#fff" d="M310 624c0 31 25 56 56 56h44v-87h-44c-31 0-56 14-56 31zm334-138c-9 0-26 1-46 5l50 134c30-19 45-39 45-58 0-43-15-81-49-81zm-43-104c-43 0-90 23-90 47h180c0-24-47-47-90-47z"/>
            </svg>
            <div>
              <div class="font-medium">支付宝</div>
              <div class="text-[11px] text-ink-500">{{ alipayEnabled ? '扫码 / 跳转支付' : '暂未启用' }}</div>
            </div>
          </button>
          <button
            type="button"
            :class="[
              'text-left px-3 py-2.5 rounded-lg border-2 transition text-sm',
              payMethod === 'BALANCE'
                ? 'border-brand-500 bg-brand-50/40'
                : 'border-ink-200 hover:border-ink-300 bg-white',
            ]"
            @click="payMethod = 'BALANCE'"
          >
            <div class="flex items-center justify-between">
              <div class="font-medium flex items-center gap-2">
                <svg class="w-4 h-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="16" cy="13" r="1.5" fill="currentColor"/>
                </svg>
                账户余额
              </div>
              <span v-if="userStore.isLoggedIn" class="text-xs" :class="balanceEnough ? 'text-emerald-600' : 'text-rose-600'">
                ¥{{ userBalance.toFixed(2) }}
              </span>
              <span v-else class="text-xs text-ink-400">未登录</span>
            </div>
            <div class="text-[11px] text-ink-500 mt-0.5">
              <template v-if="!userStore.isLoggedIn">登录后可用</template>
              <template v-else-if="!balanceEnough">余额不足，前往充值</template>
              <template v-else>即时扣款，立即发货</template>
            </div>
          </button>
          <button
            v-if="pointsPayEnabled"
            type="button"
            :class="[
              'text-left px-3 py-2.5 rounded-lg border-2 transition text-sm',
              payMethod === 'POINTS'
                ? 'border-brand-500 bg-brand-50/40'
                : 'border-ink-200 hover:border-ink-300 bg-white',
            ]"
            @click="payMethod = 'POINTS'"
          >
            <div class="flex items-center justify-between">
              <div class="font-medium flex items-center gap-2">
                <svg class="w-4 h-4 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.3 6.7 19l1-5.8-4.2-4.1 5.9-.9L12 3z" stroke-linejoin="round"/>
                </svg>
                积分支付
              </div>
              <span v-if="userStore.isLoggedIn" class="text-xs" :class="pointsEnough ? 'text-emerald-600' : 'text-rose-600'">
                {{ userPoints }} 分
              </span>
              <span v-else class="text-xs text-ink-400">未登录</span>
            </div>
            <div class="text-[11px] text-ink-500 mt-0.5">
              <template v-if="!userStore.isLoggedIn">登录后可用</template>
              <template v-else-if="!pointsEnough">需 {{ pointsRequired }} 分，还差 {{ pointsRequired - userPoints }}</template>
              <template v-else>需 {{ pointsRequired }} 分，1 分 = 1 元</template>
            </div>
          </button>
        </div>
      </div>

      <div class="mt-4">
        <div class="text-sm text-ink-700 mb-2 flex items-center gap-2">
          联系方式（可选）
          <span class="text-[11px] text-ink-400 font-normal">支付后凭它+订单号可查发货内容</span>
        </div>
        <input
          v-model="contact"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
          placeholder="留 QQ / 邮箱 / 手机，便于售后联系"
        />
      </div>

      <div class="mt-6 flex items-center justify-between border-t border-ink-100 pt-4 gap-3 flex-wrap">
        <div class="text-sm text-ink-500">
          <template v-if="discountAmount > 0">
            <span class="text-ink-400 line-through text-xs mr-1">¥{{ originalAmount.toFixed(2) }}</span>
            实付 <span class="text-2xl font-bold brand-gradient-text">¥{{ totalAmount.toFixed(2) }}</span>
            <div class="mt-1 text-[11px]">
              <span
                class="inline-block px-1.5 py-0.5 bg-rose-50 text-rose-600 rounded-md font-medium"
              >
                {{ vipMe?.tierIcon }} {{ vipMe?.tierName }}立省 ¥{{ discountAmount.toFixed(2) }}
                <span class="text-rose-500/70">（{{ (effectiveDiscount * 10).toFixed(1) }} 折）</span>
              </span>
            </div>
          </template>
          <template v-else>
            合计 <span class="text-2xl font-bold brand-gradient-text">¥{{ totalAmount.toFixed(2) }}</span>
          </template>
          <div
            v-if="pointsAwardEnabled && payMethod !== 'POINTS' && expectedPointsReward > 0"
            class="mt-1 text-[11px] text-amber-600"
          >
            成功发货预计返 {{ expectedPointsReward }} 积分
          </div>
          <div v-else-if="payMethod === 'POINTS'" class="mt-1 text-[11px] text-ink-500">
            本单将使用 {{ pointsRequired }} 积分支付，不再返积分
          </div>
        </div>
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="
            !skuId ||
            !currentSku ||
            (payMethod === 'ALIPAY' && !alipayEnabled) ||
            (payMethod === 'POINTS' && (!pointsPayEnabled || !userStore.isLoggedIn || !pointsEnough)) ||
            (isPoolQuotaProduct && (!userStore.isLoggedIn || currentSku.stock <= 0))
          "
          @click="buy"
        >
          {{
            payMethod === 'POINTS'
              ? (userStore.isLoggedIn
                  ? (pointsEnough ? '积分支付' : '积分不足')
                  : '登录后用积分支付')
              : payMethod === 'BALANCE'
              ? (userStore.isLoggedIn
                  ? (balanceEnough ? '余额支付' : '余额不足 · 去充值')
                  : '登录后用余额支付')
              : (alipayEnabled
                  ? (isPoolQuotaProduct && !userStore.isLoggedIn
                      ? '登录后购买额度包'
                      : isPoolQuotaProduct && currentSku && currentSku.stock <= 0
                        ? '暂无可申请账号'
                        : currentSku && currentSku.stock <= 0 ? '下单（人工发货）' : '立即购买')
                  : '支付宝未启用')
          }}
        </el-button>
      </div>
    </div>
  </div>
</template>
