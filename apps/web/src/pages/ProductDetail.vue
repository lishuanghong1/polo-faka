<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElRadioGroup, ElRadio, ElInputNumber, ElButton } from 'element-plus';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const route = useRoute();
const router = useRouter();
const user = useUserStore();

const product = ref<any>(null);
const skuId = ref<number | null>(null);
const qty = ref(1);
const payMethod = ref<'ALIPAY' | 'BALANCE' | 'MOCK'>('ALIPAY');
const contact = ref('');
const submitting = ref(false);
const alipayEnabled = ref(false);

const currentSku = computed(() => product.value?.skus?.find((s: any) => s.id === skuId.value));
const bulk = computed<any[] | null>(() => product.value?.bulkPricing || null);
const unitPrice = computed(() => {
  if (!currentSku.value) return 0;
  if (Array.isArray(bulk.value) && bulk.value.length) {
    const hit = bulk.value.find((b) => qty.value >= b.min && qty.value <= b.max);
    if (hit) return Number(hit.price);
  }
  return Number(currentSku.value.price);
});
const totalAmount = computed(() => +(unitPrice.value * qty.value).toFixed(2));

async function load() {
  product.value = await api.product(Number(route.params.id));
  const first = product.value.skus?.[0];
  skuId.value = first ? first.id : null;

  try {
    const r = await api.pay.alipayEnabled();
    alipayEnabled.value = !!r.enabled;
    if (!alipayEnabled.value && payMethod.value === 'ALIPAY') {
      payMethod.value = user.isLoggedIn ? 'BALANCE' : 'MOCK';
    }
  } catch {
    alipayEnabled.value = false;
    payMethod.value = user.isLoggedIn ? 'BALANCE' : 'MOCK';
  }
}

onMounted(load);

function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

async function buy() {
  if (!skuId.value) return;
  if (currentSku.value.stock <= 0) {
    ElMessage.warning('该规格已售罄');
    return;
  }
  if (payMethod.value === 'BALANCE' && !user.isLoggedIn) {
    ElMessage.info('余额支付请先登录');
    router.push({ name: 'login', query: { redirect: route.fullPath } });
    return;
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
    if (payMethod.value === 'BALANCE') {
      router.push(`/order/${order.orderNo}`);
    } else if (payMethod.value === 'ALIPAY') {
      const channel = isMobile() ? 'WAP' : 'PC';
      const { payUrl } = await api.pay.alipayCreate(order.orderNo, channel);
      // 直接跳支付宝
      window.location.href = payUrl;
    } else {
      router.push(`/mock-pay?orderNo=${encodeURIComponent(order.orderNo)}`);
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '下单失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="!product" class="text-center py-20 text-gray-400">加载中...</div>
  <div v-else class="max-w-4xl mx-auto px-4 py-8">
    <button class="text-sm text-gray-500 hover:text-brand-600 mb-3" @click="router.back()">
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
      <h1 class="text-xl md:text-2xl font-bold leading-snug">{{ product.title }}</h1>
      <p v-if="product.subtitle" class="mt-2 text-sm text-gray-500">{{ product.subtitle }}</p>

      <div v-if="product.description" class="mt-4 text-sm text-gray-600 whitespace-pre-wrap">
        {{ product.description }}
      </div>

      <div class="mt-5 text-xs text-gray-400 flex gap-4">
        <span>已售 {{ product.sales }}</span>
      </div>

      <div class="mt-6">
        <div class="text-sm text-gray-700 mb-2">规格</div>
        <el-radio-group v-model="skuId">
          <el-radio
            v-for="s in product.skus"
            :key="s.id"
            :value="s.id"
            :disabled="s.stock <= 0"
            class="!mr-2 !mb-2"
          >
            <span>{{ s.name }}</span>
            <span class="ml-1 text-rose-600 font-medium">¥{{ s.price }}</span>
            <span class="ml-1 text-gray-400 text-xs">({{ s.stock }})</span>
          </el-radio>
        </el-radio-group>
      </div>

      <div v-if="bulk && bulk.length" class="mt-4 text-xs text-gray-500">
        批量优惠：
        <span v-for="(b, i) in bulk" :key="i" class="mr-3">
          {{ b.min }}-{{ b.max }} 个 ¥{{ b.price }}
        </span>
      </div>

      <div class="mt-4 flex items-center gap-3">
        <span class="text-sm text-gray-700">数量</span>
        <el-input-number v-model="qty" :min="1" :max="1000" />
      </div>

      <div class="mt-4">
        <div class="text-sm text-gray-700 mb-2">支付方式</div>
        <el-radio-group v-model="payMethod">
          <el-radio v-if="alipayEnabled" value="ALIPAY">
            <span class="inline-flex items-center">
              <svg class="w-4 h-4 mr-1 text-[#1677ff]" viewBox="0 0 1024 1024" fill="currentColor">
                <path d="M230 0h564c127 0 230 103 230 230v564c0 127-103 230-230 230H230C103 1024 0 921 0 794V230C0 103 103 0 230 0z"/>
                <path fill="#fff" d="M310 624c0 31 25 56 56 56h44v-87h-44c-31 0-56 14-56 31zm334-138c-9 0-26 1-46 5l50 134c30-19 45-39 45-58 0-43-15-81-49-81zm-43-104c-43 0-90 23-90 47h180c0-24-47-47-90-47z"/>
              </svg>
              支付宝
            </span>
          </el-radio>
          <el-radio v-if="user.isLoggedIn" value="BALANCE">
            余额（{{ user.profile?.balance ?? '0.00' }}）
          </el-radio>
          <el-radio value="MOCK">Mock（开发）</el-radio>
        </el-radio-group>
      </div>

      <div class="mt-4">
        <div class="text-sm text-gray-700 mb-2">联系方式（可选）</div>
        <input
          v-model="contact"
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
          placeholder="留 QQ / 邮箱，便于售后联系"
        />
      </div>

      <div class="mt-6 flex items-center justify-between border-t pt-4">
        <div class="text-sm text-gray-500">
          合计 <span class="text-2xl font-bold brand-gradient-text">¥{{ totalAmount }}</span>
        </div>
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="!skuId || !currentSku || currentSku.stock <= 0"
          @click="buy"
        >
          {{ currentSku?.stock > 0 ? '立即购买' : '暂无库存' }}
        </el-button>
      </div>
    </div>
  </div>
</template>
