<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';

const route = useRoute();
const router = useRouter();

const typeKey = computed(() => decodeURIComponent(route.params.typeKey as string));
const product = ref<any>(null);
const loading = ref(true);

const quantity = ref(1);
const contact = ref('');
const payMethod = ref<'ALIPAY' | 'REDEEM'>('ALIPAY');
const redeemCode = ref('');
const submitting = ref(false);
const alipayEnabled = ref(false);
const errorMsg = ref('');

const lineTotal = computed(() => {
  if (!product.value) return 0;
  return +(product.value.displayPrice * quantity.value).toFixed(2);
});

const canSubmit = computed(() => {
  if (!product.value) return false;
  if (product.value.stock <= 0) return false;
  if (quantity.value < 1 || quantity.value > 10) return false;
  if (payMethod.value === 'REDEEM' && !redeemCode.value.trim()) return false;
  if (payMethod.value === 'ALIPAY' && !alipayEnabled.value) return false;
  return true;
});

async function load() {
  loading.value = true;
  try {
    product.value = await api.forge.getProduct(typeKey.value);
  } catch (e: any) {
    errorMsg.value = e?.response?.data?.error?.message || '加载商品失败';
  } finally {
    loading.value = false;
  }
  try {
    const r = await api.pay.alipayEnabled();
    alipayEnabled.value = !!r.enabled;
    if (!alipayEnabled.value) payMethod.value = 'REDEEM';
  } catch {
    alipayEnabled.value = false;
    payMethod.value = 'REDEEM';
  }
}

function isMobile() {
  return /Mobi|Android|iPhone/i.test(navigator.userAgent);
}

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  errorMsg.value = '';
  submitting.value = true;
  try {
    if (payMethod.value === 'REDEEM') {
      const order = await api.forge.order({
        code: redeemCode.value.trim(),
        typeKey: typeKey.value,
        quantity: quantity.value,
        contact: contact.value.trim() || undefined,
      });
      router.push(`/forge-order/${encodeURIComponent(order.orderNo)}`);
    } else {
      const order = await api.forge.alipayOrder({
        typeKey: typeKey.value,
        quantity: quantity.value,
        contact: contact.value.trim() || undefined,
      });
      const channel = isMobile() ? 'WAP' : 'PC';
      const { payUrl } = await api.pay.alipayCreate(order.orderNo, channel);
      window.location.href = payUrl;
    }
  } catch (e: any) {
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
  <section class="max-w-3xl mx-auto px-4 py-8">
    <div v-if="loading" class="card p-10 text-center text-ink-400 text-sm">加载中…</div>

    <div v-else-if="!product" class="card p-10 text-center">
      <div class="text-rose-600 text-sm">{{ errorMsg || '商品不存在或已下架' }}</div>
      <button
        class="mt-4 px-4 py-2 rounded-lg border border-ink-200 text-sm hover:bg-ink-50"
        @click="router.push('/')"
      >返回首页</button>
    </div>

    <template v-else>
      <!-- 商品信息 -->
      <div class="card p-6 bg-white border border-ink-100 rounded-2xl">
        <div class="text-xs text-ink-500 mb-2">{{ product.categoryName }}</div>
        <h1 class="text-2xl font-semibold text-ink-900">{{ product.typeName }}</h1>

        <div class="flex items-end justify-between gap-4 mt-4 pb-5 border-b border-ink-100">
          <div>
            <div class="text-3xl font-bold text-rose-600">¥{{ product.displayPrice.toFixed(2) }}</div>
            <div class="text-xs text-ink-500 mt-1">单价（含税）</div>
          </div>
          <div class="text-right text-xs">
            <div v-if="product.warrantyHours" class="text-ink-600">
              <svg class="w-3.5 h-3.5 inline mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke-linecap="round" stroke-linejoin="round"/></svg>
              质保 {{ product.warrantyHours }} 小时
            </div>
            <div v-if="product.emailCodeEnabled" class="text-brand-600 mt-1">
              ✓ 支持在线接验证码
            </div>
            <div
              :class="[
                'mt-1 font-medium',
                product.stock <= 0 ? 'text-rose-600' : product.stock <= 5 ? 'text-amber-600' : 'text-ink-600',
              ]"
            >
              {{ product.stock <= 0 ? '当前缺货' : `库存 ${product.stock}` }}
            </div>
          </div>
        </div>

        <!-- 数量 -->
        <div class="mt-5 flex items-center justify-between">
          <label class="text-sm text-ink-700">购买数量</label>
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
              :max="Math.min(10, product.stock || 1)"
              class="w-16 text-center px-2 py-1 border border-ink-200 rounded-md text-sm"
            />
            <button
              class="w-8 h-8 rounded-md border border-ink-200 hover:bg-ink-50 disabled:opacity-50"
              :disabled="quantity >= Math.min(10, product.stock || 1)"
              @click="quantity = Math.min(Math.min(10, product.stock || 1), quantity + 1)"
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
          <div class="grid grid-cols-2 gap-2">
            <button
              :class="[
                'p-3 rounded-lg border-2 text-left transition',
                payMethod === 'ALIPAY'
                  ? 'border-brand-500 bg-brand-50/30'
                  : 'border-ink-100 hover:border-ink-300',
                !alipayEnabled ? 'opacity-50 cursor-not-allowed' : '',
              ]"
              :disabled="!alipayEnabled"
              @click="alipayEnabled && (payMethod = 'ALIPAY')"
            >
              <div class="font-medium text-sm text-ink-900 flex items-center gap-2">
                <svg class="w-4 h-4 text-[#1677ff]" viewBox="0 0 1024 1024" fill="currentColor">
                  <path d="M230 0h564c127 0 230 103 230 230v564c0 127-103 230-230 230H230C103 1024 0 921 0 794V230C0 103 103 0 230 0z"/>
                </svg>
                支付宝
              </div>
              <div class="text-[11px] text-ink-500 mt-1">
                {{ alipayEnabled ? '扫码支付，秒到货' : '未启用' }}
              </div>
            </button>

            <button
              :class="[
                'p-3 rounded-lg border-2 text-left transition',
                payMethod === 'REDEEM' ? 'border-brand-500 bg-brand-50/30' : 'border-ink-100 hover:border-ink-300',
              ]"
              @click="payMethod = 'REDEEM'"
            >
              <div class="font-medium text-sm text-ink-900">兑换码</div>
              <div class="text-[11px] text-ink-500 mt-1">使用已购买的兑换码</div>
            </button>
          </div>

          <div v-if="payMethod === 'REDEEM'" class="mt-3">
            <input
              v-model="redeemCode"
              placeholder="FK-XXXX-XXXX-XXXX-XXXX"
              class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm font-mono tracking-wider"
            />
          </div>
        </div>

        <!-- 总价 + 下单按钮 -->
        <div class="mt-6 pt-5 border-t border-ink-100">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm text-ink-500">合计</span>
            <span class="text-2xl font-bold text-rose-600">¥{{ lineTotal.toFixed(2) }}</span>
          </div>

          <div v-if="errorMsg" class="text-sm text-rose-600 mb-3">{{ errorMsg }}</div>

          <button
            class="w-full px-4 py-3 rounded-lg brand-gradient text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            :disabled="!canSubmit || submitting"
            @click="submit"
          >
            <template v-if="submitting">下单中（请勿刷新）…</template>
            <template v-else-if="product.stock <= 0">已缺货</template>
            <template v-else-if="payMethod === 'ALIPAY'">立即支付（支付宝）</template>
            <template v-else>使用兑换码下单</template>
          </button>

          <p class="text-xs text-ink-400 mt-3 text-center">
            下单成功后会自动跳到订单详情页，可查看账号信息<span v-if="product.emailCodeEnabled">并接收验证码</span>。
          </p>
        </div>
      </div>
    </template>
  </section>
</template>
