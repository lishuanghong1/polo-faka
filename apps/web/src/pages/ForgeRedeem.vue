<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';

const router = useRouter();

const code = ref('');
const querying = ref(false);
const placing = ref(false);
const info = ref<Awaited<ReturnType<typeof api.forge.check>> | null>(null);
const errorMsg = ref('');

const selectedTypeKey = ref<string>('');
const quantity = ref(1);

const selectedProduct = computed(() =>
  info.value?.products.find((p) => p.typeKey === selectedTypeKey.value) || null,
);

const lineTotal = computed(() => {
  if (!selectedProduct.value) return 0;
  return +(selectedProduct.value.displayPrice * quantity.value).toFixed(2);
});

const canPlace = computed(() => {
  if (!info.value || !selectedProduct.value) return false;
  if (info.value.status !== 'ACTIVE') return false;
  if (info.value.remaining + 0.001 < lineTotal.value) return false;
  return quantity.value >= 1 && quantity.value <= 10;
});

function statusBadge(s: string) {
  return {
    ACTIVE: { text: '可用', cls: 'bg-emerald-100 text-emerald-700' },
    DISABLED: { text: '已禁用', cls: 'bg-rose-100 text-rose-700' },
    EXHAUSTED: { text: '已用完', cls: 'bg-gray-100 text-gray-600' },
    EXPIRED: { text: '已过期', cls: 'bg-gray-100 text-gray-600' },
  }[s] || { text: s, cls: 'bg-gray-100 text-gray-600' };
}

function orderStatusBadge(s: string) {
  return {
    PENDING: { text: '处理中', cls: 'bg-amber-100 text-amber-700' },
    DELIVERED: { text: '已发货', cls: 'bg-emerald-100 text-emerald-700' },
    FAILED: { text: '失败', cls: 'bg-rose-100 text-rose-700' },
  }[s] || { text: s, cls: 'bg-gray-100 text-gray-600' };
}

async function check() {
  const c = code.value.trim();
  if (!c) {
    ElMessage.warning('请输入兑换码');
    return;
  }
  errorMsg.value = '';
  info.value = null;
  selectedTypeKey.value = '';
  quantity.value = 1;
  querying.value = true;
  try {
    const r = await api.forge.check(c);
    info.value = r;
    // 默认选第一款可用商品
    if (r.products.length) selectedTypeKey.value = r.products[0].typeKey;
  } catch (e: any) {
    const resp = e?.response?.data;
    errorMsg.value = resp?.error?.message || resp?.message || e?.message || '查询失败';
  } finally {
    querying.value = false;
  }
}

async function place() {
  if (!info.value || !selectedProduct.value) return;
  if (!canPlace.value) {
    ElMessage.warning('余额不足或参数不合法');
    return;
  }
  placing.value = true;
  try {
    const order = await api.forge.order({
      code: info.value.code,
      typeKey: selectedTypeKey.value,
      quantity: quantity.value,
    });
    router.push(`/forge-order/${encodeURIComponent(order.orderNo)}`);
  } catch (e: any) {
    const resp = e?.response?.data;
    const msg = resp?.error?.message || resp?.message || e?.message || '下单失败';
    ElMessage.error(msg);
  } finally {
    placing.value = false;
  }
}
</script>

<template>
  <section class="min-h-[calc(100vh-4rem-5rem)] px-4 py-8">
    <div class="max-w-2xl mx-auto">
      <div class="text-center mb-6">
        <h1 class="text-2xl md:text-3xl font-semibold text-ink-900">兑换码下单</h1>
        <p class="mt-2 text-sm text-ink-500">输入兑换码 → 选择商品 → 即时发货</p>
      </div>

      <!-- 输入兑换码 -->
      <div class="card p-6 bg-white border border-ink-100 rounded-2xl">
        <label class="block text-sm font-medium text-ink-700 mb-2">兑换码</label>
        <div class="flex gap-2">
          <input
            v-model="code"
            placeholder="FK-XXXX-XXXX-XXXX-XXXX"
            class="flex-1 px-3.5 py-2.5 rounded-lg border border-ink-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none text-sm font-mono tracking-wider"
            @keydown.enter="check"
          />
          <button
            class="px-5 py-2.5 rounded-lg brand-gradient text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            :disabled="querying"
            @click="check"
          >
            {{ querying ? '查询中…' : '查询' }}
          </button>
        </div>
        <div v-if="errorMsg" class="mt-3 text-sm text-rose-600">{{ errorMsg }}</div>
      </div>

      <!-- 兑换码信息 + 商品选择 -->
      <template v-if="info">
        <div class="card p-6 mt-5 bg-white border border-ink-100 rounded-2xl">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div class="text-xs text-ink-500">兑换码</div>
              <div class="font-mono text-sm break-all">{{ info.code }}</div>
            </div>
            <span :class="['px-2.5 py-1 text-xs rounded-full', statusBadge(info.status).cls]">
              {{ statusBadge(info.status).text }}
            </span>
          </div>

          <div class="grid grid-cols-3 gap-3 mt-4 text-center">
            <div class="p-3 bg-ink-50 rounded-lg">
              <div class="text-xs text-ink-500">面额</div>
              <div class="text-lg font-semibold text-ink-900 mt-1">¥{{ info.totalAmount.toFixed(2) }}</div>
            </div>
            <div class="p-3 bg-ink-50 rounded-lg">
              <div class="text-xs text-ink-500">已使用</div>
              <div class="text-lg font-semibold text-ink-700 mt-1">¥{{ info.usedAmount.toFixed(2) }}</div>
            </div>
            <div class="p-3 bg-emerald-50 rounded-lg">
              <div class="text-xs text-emerald-700">剩余</div>
              <div class="text-lg font-semibold text-emerald-700 mt-1">¥{{ info.remaining.toFixed(2) }}</div>
            </div>
          </div>

          <div v-if="info.expireAt" class="mt-2 text-xs text-ink-400">
            有效期至：{{ new Date(info.expireAt).toLocaleString() }}
          </div>
        </div>

        <!-- 历史订单（已兑过的码可回看） -->
        <div v-if="info.orders?.length" class="card p-6 mt-5 bg-white border border-ink-100 rounded-2xl">
          <div class="text-sm font-medium text-ink-800 mb-3">历史订单</div>
          <ul class="space-y-2">
            <li
              v-for="o in info.orders"
              :key="o.orderNo"
              class="flex items-center justify-between gap-3 p-3 bg-ink-50/60 rounded-lg cursor-pointer hover:bg-ink-100 transition"
              @click="router.push(`/forge-order/${encodeURIComponent(o.orderNo)}`)"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm text-ink-900 truncate">{{ o.typeName }} × {{ o.quantity }}</div>
                <div class="text-xs text-ink-500 mt-0.5">
                  {{ o.orderNo }} · {{ new Date(o.createdAt).toLocaleString() }}
                </div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-sm font-semibold text-ink-900">¥{{ o.totalAmount.toFixed(2) }}</div>
                <span :class="['inline-block mt-0.5 px-1.5 py-0.5 text-[10px] rounded-full', orderStatusBadge(o.status).cls]">
                  {{ orderStatusBadge(o.status).text }}
                </span>
              </div>
            </li>
          </ul>
        </div>

        <!-- 选择商品下单 -->
        <div v-if="info.status === 'ACTIVE'" class="card p-6 mt-5 bg-white border border-ink-100 rounded-2xl">
          <div class="text-sm font-medium text-ink-800 mb-3">选择商品下单</div>

          <div v-if="!info.products.length" class="text-sm text-ink-400 text-center py-6">
            暂无可下单商品，请联系客服。
          </div>

          <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              v-for="p in info.products"
              :key="p.typeKey"
              :class="[
                'text-left p-4 rounded-xl border-2 transition',
                selectedTypeKey === p.typeKey
                  ? 'border-brand-500 bg-brand-50/30'
                  : 'border-ink-100 hover:border-ink-300 bg-white',
              ]"
              @click="selectedTypeKey = p.typeKey"
            >
              <div class="flex items-center justify-between">
                <div class="font-medium text-ink-900 text-sm">{{ p.typeName }}</div>
                <div class="text-rose-600 font-semibold text-sm">¥{{ p.displayPrice.toFixed(2) }}</div>
              </div>
              <div class="text-xs text-ink-500 mt-1 flex items-center gap-2 flex-wrap">
                <span>{{ p.categoryName }}</span>
                <span v-if="p.warrantyHours">· 质保 {{ p.warrantyHours }}h</span>
                <span v-if="p.emailCodeEnabled" class="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">可接码</span>
                <span :class="['ml-auto', p.stock <= 5 ? 'text-rose-600' : 'text-ink-400']">库存 {{ p.stock }}</span>
              </div>
            </button>
          </div>

          <!-- 数量 + 总价 + 下单 -->
          <div v-if="selectedProduct" class="mt-5 pt-5 border-t border-ink-100">
            <div class="flex items-center justify-between gap-3 mb-3">
              <label class="text-sm text-ink-700">数量</label>
              <div class="flex items-center gap-2">
                <button
                  class="w-8 h-8 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-50"
                  :disabled="quantity <= 1"
                  @click="quantity = Math.max(1, quantity - 1)"
                >−</button>
                <input
                  v-model.number="quantity"
                  type="number"
                  min="1"
                  max="10"
                  class="w-16 text-center px-2 py-1 border border-ink-200 rounded-md text-sm"
                />
                <button
                  class="w-8 h-8 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-50"
                  :disabled="quantity >= 10"
                  @click="quantity = Math.min(10, quantity + 1)"
                >+</button>
              </div>
            </div>

            <div class="flex items-center justify-between text-sm mb-3">
              <span class="text-ink-500">小计</span>
              <span class="text-rose-600 font-semibold text-lg">¥{{ lineTotal.toFixed(2) }}</span>
            </div>

            <div v-if="info.remaining + 0.001 < lineTotal" class="text-xs text-rose-600 mb-3">
              ⚠ 兑换码剩余 ¥{{ info.remaining.toFixed(2) }}，不够支付本次 ¥{{ lineTotal.toFixed(2) }}。
            </div>

            <button
              class="w-full px-4 py-2.5 rounded-lg brand-gradient text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
              :disabled="!canPlace || placing"
              @click="place"
            >
              {{ placing ? '下单中（请勿刷新）…' : '确认下单' }}
            </button>
            <p class="text-xs text-ink-400 mt-2 text-center">
              下单成功后会自动跳转订单详情页，可查看账号信息并接收验证码。
            </p>
          </div>
        </div>

        <div v-else class="card p-4 mt-5 bg-amber-50/60 border border-amber-200 text-amber-800 text-sm rounded-lg">
          该兑换码当前状态为 <b>{{ statusBadge(info.status).text }}</b>，无法再用于下单。
        </div>
      </template>
    </div>
  </section>
</template>
