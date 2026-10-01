<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import {
  formatCardKeyContent,
  formatCardKeysForCopy,
  formatDeliveryAccountForCopy,
  parseWarehouseDeliveryAccount,
  type ParsedDeliveryAccount,
} from '@/utils/card-key';

const router = useRouter();
const route = useRoute();

const code = ref<string>((route.query.code as string) || '');
const contact = ref('');
const loading = ref(false);
const checking = ref(false);

// 模式 1：直发卡密（一码一商品）
const cardInfo = ref<any>(null);
const cardResult = ref<any>(null);

const cardResultAccounts = computed<Array<ParsedDeliveryAccount & { id?: number; soldAt?: string }>>(() => {
  return (cardResult.value?.cardKeys || [])
    .map((item: any) => {
      const account = parseWarehouseDeliveryAccount(item);
      return account ? { ...account, id: item.id, soldAt: item.soldAt } : null;
    })
    .filter(Boolean) as Array<ParsedDeliveryAccount & { id?: number; soldAt?: string }>;
});

const cardResultPlainKeys = computed(() => {
  return (cardResult.value?.cardKeys || []).filter(
    (item: any) => !parseWarehouseDeliveryAccount(item),
  );
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
}

async function checkInfo() {
  const c = code.value.trim();
  if (!c) return;
  checking.value = true;
  reset();
  try {
    cardInfo.value = await api.redeem.info(c.toUpperCase());
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || '兑换码不存在';
    ElMessage.error(msg);
  } finally {
    checking.value = false;
  }
}

async function doRedeemCard() {
  if (cardInfo.value?.redeemable === false) return;
  if (!code.value.trim()) {
    ElMessage.warning('请填写兑换码');
    return;
  }
  loading.value = true;
  try {
    const order = await api.redeem.use({
      code: code.value.trim().toUpperCase(),
      contact: contact.value?.trim() || undefined,
    });
    cardResult.value = order;
    ElMessage.success('兑换成功');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || '兑换失败');
  } finally {
    loading.value = false;
  }
}

function copyAllCardKeys() {
  if (!cardResult.value) return;
  const text = formatCardKeysForCopy(cardResult.value.cardKeys || []);
  copyTextContent(text, '已复制全部交付内容');
}

async function copyTextContent(text: string, label = '已复制') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(label);
  } catch {
    ElMessage.error('复制失败，请手动选中复制');
  }
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

      <template v-if="cardResult.cardKeys?.length">
        <div v-if="cardResultAccounts.length" class="border-t border-ink-100 pt-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm font-semibold text-ink-800">账号交付</div>
            <button class="text-xs text-brand-600 hover:underline" @click="copyAllCardKeys">复制全部</button>
          </div>
          <div class="space-y-2.5">
            <div
              v-for="(a, i) in cardResultAccounts"
              :key="a.id || a.email || i"
              class="bg-ink-50 border border-ink-200 rounded-lg p-3 space-y-2"
            >
              <div class="flex items-center justify-between gap-3 text-xs text-ink-500">
                <span>账号 #{{ i + 1 }}</span>
                <button class="text-brand-600 hover:underline" @click="copyTextContent(formatDeliveryAccountForCopy(a), '账号已复制')">复制该账号</button>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-ink-500 w-12 shrink-0">邮箱</span>
                <code class="font-mono text-sm text-ink-800 break-all flex-1">{{ a.email }}</code>
                <button class="text-xs text-brand-600 hover:underline shrink-0" @click="copyTextContent(a.email, '邮箱已复制')">复制</button>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-xs text-ink-500 w-12 shrink-0 mt-1">Token</span>
                <code class="font-mono text-xs text-ink-700 break-all flex-1 leading-relaxed">{{ a.token }}</code>
                <button class="text-xs text-brand-600 hover:underline shrink-0 mt-0.5" @click="copyTextContent(a.token, 'Token 已复制')">复制</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="cardResultPlainKeys.length" class="border-t border-ink-100 pt-4 mt-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm font-semibold text-ink-800">卡密内容</div>
            <button class="text-xs text-brand-600 hover:underline" @click="copyAllCardKeys">复制全部</button>
          </div>
          <div class="space-y-2">
            <div
              v-for="c in cardResultPlainKeys"
              :key="c.id"
              class="font-mono text-sm bg-ink-50 border border-ink-200 rounded-lg p-3 break-all whitespace-pre-wrap"
            >
              {{ formatCardKeyContent(c.content) }}
            </div>
          </div>
        </div>
      </template>
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
            @keydown.enter.prevent="checkInfo"
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
          <p v-if="cardInfo.remaining > 0 && cardInfo.redeemable !== false" class="mt-2 text-[11px] text-ink-400">
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
          :disabled="loading || !code.trim() || cardInfo.redeemable === false"
          @click="doRedeemCard"
        >
          {{ loading ? '兑换中…' : cardInfo.redeemable === false ? '商品已停用' : '立即兑换' }}
        </button>
        <p v-if="cardInfo.redeemable === false" class="text-xs text-amber-700 text-center">
          此商品已停售，兑换记录仍可查看；如需处理未使用的兑换码，请联系客服。
        </p>
        <div
          v-else-if="cardInfo.status !== 'ACTIVE' && cardInfo.orders?.length"
          class="text-xs text-ink-500 bg-ink-50 border border-ink-100 rounded-lg p-3 text-center"
        >
          该兑换码已 <b>{{ statusLabels[cardInfo.status] }}</b>，点击上方记录可查看已兑换订单。
        </div>
        <div
          v-else-if="cardInfo.status !== 'ACTIVE'"
          class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 text-center"
        >
          该兑换码当前状态为 <b>{{ statusLabels[cardInfo.status] }}</b>，无法继续兑换。
        </div>
      </template>

      <div v-if="!cardInfo" class="text-xs text-ink-400 text-center pt-2">
        兑换成功后会立即生成订单并自动发货，建议截图保存兑换结果。
      </div>
    </div>
  </div>
</template>
