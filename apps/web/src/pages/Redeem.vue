<script setup lang="ts">
/**
 * 统一兑换码入口（前缀自动路由）：
 *   - 普通兑换码：直接发对应卡密商品（一码一商品）
 *   - 余额型兑换码：码内是一笔余额，可在码内挑选商品下单（多商品共享一笔余额）
 * 对终端用户呈现完全一致的文案，不区分内部来源。
 */
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import { formatCardKeyContent, formatCardKeysForCopy } from '@/utils/card-key';

type CodeKind = 'card' | 'balance';

const router = useRouter();
const route = useRoute();

const code = ref<string>((route.query.code as string) || '');
const contact = ref('');
const loading = ref(false);
const checking = ref(false);

// 模式 1：直发卡密（一码一商品）
const cardInfo = ref<any>(null);
const cardResult = ref<any>(null);

// 模式 2：余额型（选商品下单）
const balanceInfo = ref<Awaited<ReturnType<typeof api.forge.check>> | null>(null);
const selectedTypeKey = ref<string>('');
const quantity = ref(1);

const detectedKind = computed<CodeKind | null>(() => {
  const v = code.value.trim().toUpperCase();
  if (!v) return null;
  if (v.startsWith('FK')) return 'balance';
  return 'card';
});

const selectedProduct = computed(() =>
  balanceInfo.value?.products.find((p) => p.typeKey === selectedTypeKey.value) || null,
);

const lineTotal = computed(() => {
  if (!selectedProduct.value) return 0;
  return +(selectedProduct.value.displayPrice * quantity.value).toFixed(2);
});

const canPlace = computed(() => {
  if (!balanceInfo.value || !selectedProduct.value) return false;
  if (balanceInfo.value.status !== 'ACTIVE') return false;
  if (balanceInfo.value.remaining + 0.001 < lineTotal.value) return false;
  return quantity.value >= 1 && quantity.value <= 10;
});

const statusLabels: Record<string, string> = {
  ACTIVE: '可用',
  DISABLED: '已禁用',
  EXHAUSTED: '已用完',
  EXPIRED: '已过期',
};

const orderStatusLabels: Record<string, { text: string; cls: string }> = {
  PENDING:   { text: '待支付',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PAID:      { text: '已支付',  cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  DELIVERED: { text: '已发货',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  FAILED:    { text: '发货失败', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  EXPIRED:   { text: '已超时',  cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  CANCELLED: { text: '已取消',  cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  REFUNDED:  { text: '已退款',  cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

function goCardHistory(orderNo: string) {
  router.push(`/order/${encodeURIComponent(orderNo)}`);
}

function reset() {
  cardInfo.value = null;
  cardResult.value = null;
  balanceInfo.value = null;
  selectedTypeKey.value = '';
  quantity.value = 1;
}

async function checkInfo() {
  const c = code.value.trim();
  if (!c) return;
  checking.value = true;
  reset();
  try {
    if (detectedKind.value === 'balance') {
      const r = await api.forge.check(c);
      balanceInfo.value = r;
      if (r.products.length) selectedTypeKey.value = r.products[0].typeKey;
    } else {
      cardInfo.value = await api.redeem.info(c);
    }
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || '兑换码不存在';
    ElMessage.error(msg);
  } finally {
    checking.value = false;
  }
}

async function doRedeemCard() {
  if (!code.value.trim()) {
    ElMessage.warning('请填写兑换码');
    return;
  }
  loading.value = true;
  try {
    const order = await api.redeem.use({
      code: code.value.trim(),
      contact: contact.value?.trim() || undefined,
    });
    cardResult.value = order;
    ElMessage.success('兑换成功');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.message || '兑换失败');
  } finally {
    loading.value = false;
  }
}

async function doPlaceBalance() {
  if (!balanceInfo.value || !selectedProduct.value) return;
  if (!canPlace.value) {
    ElMessage.warning('余额不足或参数不合法');
    return;
  }
  loading.value = true;
  try {
    const order = await api.forge.order({
      code: balanceInfo.value.code,
      typeKey: selectedTypeKey.value,
      quantity: quantity.value,
      contact: contact.value?.trim() || undefined,
    });
    router.push(`/forge-order/${encodeURIComponent(order.orderNo)}`);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.message || '下单失败');
  } finally {
    loading.value = false;
  }
}

function copyAllCardKeys() {
  if (!cardResult.value) return;
  const text = formatCardKeysForCopy(cardResult.value.cardKeys || []);
  navigator.clipboard.writeText(text);
  ElMessage.success('已复制全部卡密');
}

function goCardOrder() {
  if (!cardResult.value) return;
  router.push(`/order/${cardResult.value.orderNo}`);
}
</script>

<template>
  <div class="max-w-2xl mx-auto py-10 px-4">
    <div class="text-center mb-8">
      <h1 class="text-2xl font-semibold text-ink-900">兑换码</h1>
      <p class="text-sm text-ink-500 mt-2">输入您的兑换码，立即获取对应商品</p>
    </div>

    <!-- 卡密模式：兑换成功结果 -->
    <div v-if="cardResult" class="card p-6">
      <div class="flex items-center gap-2 text-emerald-600 mb-4">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span class="text-lg font-semibold">兑换成功</span>
      </div>
      <div class="space-y-2 text-sm mb-4">
        <div class="flex justify-between text-ink-500">
          <span>订单号</span>
          <span class="font-mono text-ink-800">{{ cardResult.orderNo }}</span>
        </div>
        <div class="flex justify-between text-ink-500">
          <span>商品</span>
          <span class="text-ink-800">{{ cardResult.productTitle }}</span>
        </div>
        <div class="flex justify-between text-ink-500">
          <span>规格</span>
          <span class="text-ink-800">{{ cardResult.skuName }} × {{ cardResult.quantity }}</span>
        </div>
      </div>
      <div v-if="cardResult.cardKeys?.length" class="border-t border-ink-100 pt-4">
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm font-semibold text-ink-800">卡密内容</div>
          <button class="text-xs text-brand-600 hover:underline" @click="copyAllCardKeys">复制全部</button>
        </div>
        <div class="space-y-2">
          <div
            v-for="c in cardResult.cardKeys"
            :key="c.id"
            class="font-mono text-sm bg-ink-50 border border-ink-200 rounded-lg p-3 break-all whitespace-pre-wrap"
          >
            {{ formatCardKeyContent(c.content) }}
          </div>
        </div>
      </div>
      <div v-else class="border-t border-ink-100 pt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
        ⚠️ 该商品暂时没有可用卡密，已为您创建订单。客服处理后会自动发货，您可凭订单号查询。
      </div>
      <div class="mt-5 flex gap-2">
        <button class="flex-1 py-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="reset(); code = ''; contact = ''">
          再兑一个
        </button>
        <button class="flex-1 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm" @click="goCardOrder">
          查看订单
        </button>
      </div>
    </div>

    <!-- 输入兑换码 + 查询 -->
    <div v-else class="card p-6 space-y-4">
      <div>
        <label class="text-sm font-medium text-ink-700 block mb-1">兑换码</label>
        <div class="flex gap-2">
          <input
            v-model="code"
            placeholder="请输入兑换码"
            class="flex-1 px-4 py-2.5 border border-ink-200 rounded-lg text-sm font-mono uppercase tracking-wider focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
            @blur="checkInfo"
            @keydown.enter="detectedKind === 'balance' ? doPlaceBalance() : doRedeemCard()"
          />
          <button
            class="px-4 py-2.5 border border-ink-200 hover:bg-ink-50 rounded-lg text-sm"
            :disabled="checking || !code.trim()"
            @click="checkInfo"
          >
            {{ checking ? '查询中…' : '查询' }}
          </button>
        </div>
      </div>

      <!-- 模式 A：卡密直发 -->
      <template v-if="cardInfo">
        <div class="bg-ink-50 border border-ink-200 rounded-lg p-4 space-y-2 text-sm">
          <div class="flex items-center gap-2 mb-1">
            <span
              class="text-xs px-2 py-0.5 rounded border"
              :class="cardInfo.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-ink-100 text-ink-500 border-ink-200'"
            >{{ statusLabels[cardInfo.status] || cardInfo.status }}</span>
            <span class="text-ink-700 font-medium">{{ cardInfo.productTitle }}</span>
          </div>
          <div class="text-ink-600 text-xs">
            规格：<span class="text-ink-800">{{ cardInfo.skuName }}</span>
            · 每次兑换：<span class="text-ink-800">{{ cardInfo.qtyPerUse }} 件</span>
            · 剩余次数：<span class="text-ink-800">{{ cardInfo.remaining }} / {{ cardInfo.maxUses }}</span>
            <span v-if="cardInfo.expireAt"> · 过期：{{ new Date(cardInfo.expireAt).toLocaleString() }}</span>
          </div>
        </div>

        <!-- 该兑换码的历史订单（再次输入兑换码可继续查看已兑换过的订单） -->
        <div v-if="cardInfo.orders?.length" class="bg-white border border-ink-100 rounded-lg p-4">
          <div class="text-sm font-medium text-ink-800 mb-3 flex items-center justify-between">
            <span>兑换记录</span>
            <span class="text-xs text-ink-400 font-normal">共 {{ cardInfo.orders.length }} 笔</span>
          </div>
          <ul class="space-y-2">
            <li
              v-for="o in cardInfo.orders"
              :key="o.orderNo"
              class="flex items-center justify-between gap-3 p-3 bg-ink-50/60 rounded-lg cursor-pointer hover:bg-ink-100 transition"
              @click="goCardHistory(o.orderNo)"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm text-ink-900 truncate">
                  {{ o.productTitle }}<span v-if="o.skuName"> · {{ o.skuName }}</span> × {{ o.quantity }}
                </div>
                <div class="text-xs text-ink-500 mt-0.5 font-mono truncate">
                  {{ o.orderNo }}
                </div>
                <div class="text-[11px] text-ink-400 mt-0.5">
                  {{ new Date(o.redeemedAt || o.createdAt).toLocaleString() }}
                </div>
              </div>
              <div class="text-right shrink-0">
                <span
                  class="text-[11px] px-2 py-0.5 rounded border whitespace-nowrap"
                  :class="(orderStatusLabels[o.status] || { cls: 'bg-ink-100 text-ink-500 border-ink-200' }).cls"
                >
                  {{ (orderStatusLabels[o.status] || { text: o.status }).text }}
                </span>
                <div v-if="o.hasContact" class="text-[10px] text-amber-600 mt-1">需联系方式</div>
              </div>
            </li>
          </ul>
          <p v-if="cardInfo.remaining > 0" class="mt-2 text-[11px] text-ink-400">
            仍可再兑换 {{ cardInfo.remaining }} 次。
          </p>
        </div>

        <div v-if="cardInfo.status === 'ACTIVE'">
          <label class="text-sm font-medium text-ink-700 block mb-1">联系方式（可选）</label>
          <input
            v-model="contact"
            placeholder="QQ / 邮箱 / 手机，便于客服联系"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
          />
        </div>

        <button
          v-if="cardInfo.status === 'ACTIVE'"
          class="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium shadow-sm disabled:opacity-50"
          :disabled="loading || !code.trim()"
          @click="doRedeemCard"
        >
          {{ loading ? '兑换中…' : '立即兑换' }}
        </button>
        <div
          v-else-if="cardInfo.orders?.length"
          class="text-xs text-ink-500 bg-ink-50 border border-ink-100 rounded-lg p-3 text-center"
        >
          该兑换码已 <b>{{ statusLabels[cardInfo.status] }}</b>，点击上方记录可查看已兑换订单。
        </div>
        <div
          v-else
          class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 text-center"
        >
          该兑换码当前状态为 <b>{{ statusLabels[cardInfo.status] }}</b>，无法继续兑换。
        </div>
      </template>

      <!-- 模式 B：余额型兑换码 -->
      <template v-if="balanceInfo">
        <div class="bg-ink-50 border border-ink-200 rounded-lg p-4">
          <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div>
              <div class="text-xs text-ink-500">兑换码</div>
              <div class="font-mono text-sm break-all">{{ balanceInfo.code }}</div>
            </div>
            <span
              class="text-xs px-2 py-0.5 rounded border"
              :class="balanceInfo.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-ink-100 text-ink-500 border-ink-200'"
            >{{ statusLabels[balanceInfo.status] || balanceInfo.status }}</span>
          </div>
          <div class="grid grid-cols-3 gap-3 text-center">
            <div class="p-3 bg-white rounded-lg border border-ink-100">
              <div class="text-xs text-ink-500">面额</div>
              <div class="text-lg font-semibold text-ink-900 mt-1">¥{{ balanceInfo.totalAmount.toFixed(2) }}</div>
            </div>
            <div class="p-3 bg-white rounded-lg border border-ink-100">
              <div class="text-xs text-ink-500">已使用</div>
              <div class="text-lg font-semibold text-ink-700 mt-1">¥{{ balanceInfo.usedAmount.toFixed(2) }}</div>
            </div>
            <div class="p-3 bg-emerald-50 rounded-lg">
              <div class="text-xs text-emerald-700">剩余</div>
              <div class="text-lg font-semibold text-emerald-700 mt-1">¥{{ balanceInfo.remaining.toFixed(2) }}</div>
            </div>
          </div>
          <div v-if="balanceInfo.expireAt" class="mt-2 text-xs text-ink-400">
            有效期至：{{ new Date(balanceInfo.expireAt).toLocaleString() }}
          </div>
        </div>

        <!-- 历史订单 -->
        <div v-if="balanceInfo.orders?.length" class="bg-white border border-ink-100 rounded-lg p-4">
          <div class="text-sm font-medium text-ink-800 mb-3">历史订单</div>
          <ul class="space-y-2">
            <li
              v-for="o in balanceInfo.orders"
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
              </div>
            </li>
          </ul>
        </div>

        <!-- 选择商品下单 -->
        <div v-if="balanceInfo.status === 'ACTIVE'" class="bg-white border border-ink-100 rounded-lg p-4">
          <div class="text-sm font-medium text-ink-800 mb-3">选择商品下单</div>
          <div v-if="!balanceInfo.products.length" class="text-sm text-ink-400 text-center py-6">
            暂无可下单商品，请联系客服。
          </div>
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              v-for="p in balanceInfo.products"
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
            <div v-if="balanceInfo.remaining + 0.001 < lineTotal" class="text-xs text-rose-600 mb-3">
              ⚠ 兑换码剩余 ¥{{ balanceInfo.remaining.toFixed(2) }}，不够支付本次 ¥{{ lineTotal.toFixed(2) }}。
            </div>
            <div class="mb-3">
              <label class="text-xs text-ink-500 block mb-1">联系方式（可选）</label>
              <input
                v-model="contact"
                placeholder="QQ / 邮箱 / 手机，便于客服联系"
                class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
              />
            </div>
            <button
              class="w-full px-4 py-2.5 rounded-lg brand-gradient text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
              :disabled="!canPlace || loading"
              @click="doPlaceBalance"
            >
              {{ loading ? '下单中（请勿刷新）…' : '确认下单' }}
            </button>
            <p class="text-xs text-ink-400 mt-2 text-center">
              下单成功后会自动跳转订单详情页。
            </p>
          </div>
        </div>
        <div v-else class="bg-amber-50/60 border border-amber-200 text-amber-800 text-sm rounded-lg p-4">
          该兑换码当前状态为 <b>{{ statusLabels[balanceInfo.status] }}</b>，无法用于下单。
        </div>
      </template>

      <div v-if="!cardInfo && !balanceInfo" class="text-xs text-ink-400 text-center pt-2">
        兑换成功后会立即生成订单并自动发货，建议截图保存兑换结果。
      </div>
    </div>
  </div>
</template>
