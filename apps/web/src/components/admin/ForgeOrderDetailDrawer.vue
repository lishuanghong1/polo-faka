<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { ElDrawer, ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import StatusTag from '@/components/admin/StatusTag.vue';
import BrandButton from '@/components/BrandButton.vue';
import { formatDateTime, formatMoneyRaw, copyText } from '@/utils/format';

const props = defineProps<{ orderNo: string | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed'): void;
}>();

const order = ref<any>(null);
const loading = ref(false);
const open = ref(false);
const acting = ref<string>(''); // 当前正在执行的动作 id

watch(
  () => props.orderNo,
  async (no) => {
    if (no) {
      open.value = true;
      await load();
    } else {
      open.value = false;
      order.value = null;
    }
  },
  { immediate: true },
);

async function load() {
  if (!props.orderNo) return;
  loading.value = true;
  try {
    order.value = await api.forge.admin.orderDetail(props.orderNo);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载失败');
    close();
  } finally {
    loading.value = false;
  }
}

const payMethodLabel = computed(() => {
  const m = (order.value?.paymentMethod || '').toUpperCase();
  if (m === 'ALIPAY') return '支付宝';
  if (m === 'BALANCE') return '账户余额';
  if (m === 'REDEEM') return '兑换码';
  return order.value?.paymentMethod || '-';
});

const payMethodChipCls = computed(() => {
  const m = (order.value?.paymentMethod || '').toUpperCase();
  if (m === 'ALIPAY')  return 'bg-sky-50 text-sky-700 border-sky-200';
  if (m === 'BALANCE') return 'bg-brand-50 text-brand-700 border-brand-200';
  if (m === 'REDEEM')  return 'bg-violet-50 text-violet-700 border-violet-200';
  return 'bg-ink-100 text-ink-600 border-ink-200';
});

const profitInfo = computed(() => {
  if (!order.value) return null;
  const sale = Number(order.value.totalAmount);
  const cost = order.value.upstreamAmount !== null && order.value.upstreamAmount !== undefined
    ? Number(order.value.upstreamAmount)
    : null;
  if (cost === null) return null;
  const profit = sale - cost;
  const margin = sale > 0 ? (profit / sale) * 100 : 0;
  return {
    cost: cost.toFixed(2),
    profit: profit.toFixed(2),
    margin: margin.toFixed(1),
    isPositive: profit >= 0,
  };
});

async function retry() {
  if (acting.value) return;
  acting.value = 'retry';
  try {
    await api.forge.admin.retryFulfill(order.value.orderNo);
    ElMessage.success('已重发');
    await load();
    emit('changed');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '重发失败');
  } finally {
    acting.value = '';
  }
}

async function alipayQuery() {
  if (acting.value) return;
  acting.value = 'query';
  try {
    const r = await api.admin.alipayQuery(order.value.orderNo);
    if (!r.tradeStatus) {
      ElMessage.info('支付宝侧暂无此订单（未支付或已关闭）');
    } else {
      ElMessage.success(
        `支付宝状态：${r.tradeStatus}${r.totalAmount ? ` 金额 ¥${r.totalAmount}` : ''}`,
      );
    }
    await load();
    emit('changed');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '查询失败');
  } finally {
    acting.value = '';
  }
}

async function alipayRefund() {
  try {
    const { value } = await ElMessageBox.prompt(
      '支付宝原路退款（不可撤销，立即退款到买家账户）',
      '确认原路退款',
      {
        inputType: 'text',
        inputPlaceholder: '退款原因，会写入支付宝账单',
        confirmButtonText: '确认退款',
        confirmButtonClass: 'el-button--danger',
        inputValidator: (v) => (v && v.trim().length >= 2 ? true : '原因至少 2 个字'),
      },
    );
    acting.value = 'refund';
    const r = await api.admin.alipayRefund(order.value.orderNo, value);
    ElMessage.success(`已退款 ¥${r.amount}`);
    await load();
    emit('changed');
  } catch (e: any) {
    if (e === 'cancel') return;
    ElMessage.error(e?.response?.data?.error?.message || '退款失败');
  } finally {
    acting.value = '';
  }
}

async function deleteOrder() {
  try {
    await ElMessageBox.confirm(
      `将永久删除三方订单 ${order.value.orderNo}，已支付/已发货订单需先退款。是否继续？`,
      '危险操作',
      {
        type: 'warning',
        confirmButtonText: '删除',
        confirmButtonClass: 'el-button--danger',
      },
    );
  } catch {
    return;
  }
  acting.value = 'delete';
  try {
    await api.forge.admin.deleteOrder(order.value.orderNo);
    ElMessage.success('已删除');
    emit('changed');
    close();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败');
  } finally {
    acting.value = '';
  }
}

async function copy(text: string, label = '已复制') {
  if (!text) return;
  const ok = await copyText(text);
  if (ok) ElMessage.success(label);
  else ElMessage.error('复制失败');
}

function copyAllAccounts() {
  const lines: string[] = [];
  for (const a of order.value?.accounts || []) {
    const email = a.account_json?.email || a.email;
    const token = a.account_json?.access_token;
    if (email) lines.push(`邮箱: ${email}`);
    if (token) lines.push(`Token: ${token}`);
    lines.push('---');
  }
  copy(lines.join('\n'), '已复制全部账号');
}

function close() {
  open.value = false;
  emit('close');
}

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
  <el-drawer
    :model-value="open"
    :show-close="false"
    direction="rtl"
    size="600px"
    :with-header="false"
    @update:model-value="(v: boolean) => !v && close()"
  >
    <div v-if="loading" class="p-10 text-center text-ink-400 text-sm">加载中…</div>

    <div v-else-if="order" class="flex flex-col h-full">
      <!-- ────── Header ────── -->
      <div class="px-5 py-4 border-b border-ink-100 flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs text-ink-400 uppercase tracking-wider font-medium">三方订单</span>
            <StatusTag :status="order.status" />
          </div>
          <div class="font-mono text-sm text-ink-900 break-all">{{ order.orderNo }}</div>
        </div>
        <button
          class="w-8 h-8 rounded-lg text-ink-400 hover:text-ink-900 hover:bg-ink-50 flex items-center justify-center transition shrink-0"
          @click="close"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- ────── Body ────── -->
      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- Hero：金额 + 支付方式 -->
        <div
          class="rounded-2xl border bg-gradient-to-br p-4"
          :class="statusHeroClass"
        >
          <div class="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div class="text-xs text-ink-500 mb-1">订单金额</div>
              <div class="text-3xl font-bold tracking-tight text-ink-900 leading-none">
                <span class="text-base font-normal text-ink-400 mr-0.5">¥</span>{{ formatMoneyRaw(order.totalAmount) }}
              </div>
            </div>
            <span
              class="inline-flex h-7 px-2.5 items-center text-xs rounded-md border whitespace-nowrap"
              :class="payMethodChipCls"
            >
              {{ payMethodLabel }}
            </span>
          </div>

          <!-- 三方成本 / 利润 -->
          <div v-if="profitInfo" class="mt-3 pt-3 border-t border-white/60 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div class="text-ink-500">三方成本</div>
              <div class="text-ink-900 font-medium mt-0.5">¥{{ profitInfo.cost }}</div>
            </div>
            <div>
              <div class="text-ink-500">利润</div>
              <div class="font-medium mt-0.5" :class="profitInfo.isPositive ? 'text-emerald-700' : 'text-rose-600'">
                {{ profitInfo.isPositive ? '+' : '' }}¥{{ profitInfo.profit }}
              </div>
            </div>
            <div>
              <div class="text-ink-500">毛利率</div>
              <div class="font-medium mt-0.5" :class="profitInfo.isPositive ? 'text-emerald-700' : 'text-rose-600'">
                {{ profitInfo.margin }}%
              </div>
            </div>
          </div>
        </div>

        <!-- 商品信息 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">商品</div>
          <div class="card p-3.5 bg-ink-50/40">
            <div class="font-medium text-ink-900">{{ order.typeName }}</div>
            <div class="text-xs text-ink-500 font-mono mt-0.5">{{ order.typeKey }}</div>
            <div class="flex items-center gap-3 mt-2.5 text-xs text-ink-600">
              <span>单价 ¥{{ formatMoneyRaw(order.displayPrice) }}</span>
              <span class="w-1 h-1 rounded-full bg-ink-300" />
              <span>×{{ order.quantity }}</span>
            </div>
          </div>
        </div>

        <!-- 失败原因 -->
        <div v-if="order.failReason" class="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800">
          <div class="flex items-start gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 mt-0.5 shrink-0">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <div class="font-medium">发货失败</div>
              <div class="text-xs text-rose-700 mt-0.5">{{ order.failReason }}</div>
            </div>
          </div>
        </div>

        <!-- 元信息 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">元信息</div>
          <dl class="text-sm space-y-1.5">
            <div v-if="order.upstreamOrderNo" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">上游单号</dt>
              <dd class="font-mono text-xs text-ink-700 truncate">{{ order.upstreamOrderNo }}</dd>
            </div>
            <div v-if="order.thirdTradeNo" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">支付单号</dt>
              <dd class="font-mono text-xs text-ink-700 truncate">{{ order.thirdTradeNo }}</dd>
            </div>
            <div v-if="order.redeemCode" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">兑换码</dt>
              <dd class="font-mono text-xs text-ink-700 truncate">{{ order.redeemCode }}</dd>
            </div>
            <div v-if="order.contact" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">联系方式</dt>
              <dd class="text-ink-700 truncate">{{ order.contact }}</dd>
            </div>
            <div v-if="order.userId" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">用户 ID</dt>
              <dd class="text-ink-700">#{{ order.userId }}</dd>
            </div>
            <div v-else class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">用户</dt>
              <dd class="text-ink-400">游客订单</dd>
            </div>
            <div v-if="order.buyerLogonId" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">买家账号</dt>
              <dd class="text-ink-700 text-xs">{{ order.buyerLogonId }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">下单时间</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(order.createdAt) }}</dd>
            </div>
            <div v-if="order.paidAt" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">付款时间</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(order.paidAt) }}</dd>
            </div>
            <div v-if="order.deliveredAt" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">发货时间</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(order.deliveredAt) }}</dd>
            </div>
            <div v-if="order.expireAt && order.status === 'PENDING'" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">过期时间</dt>
              <dd class="text-xs text-amber-700">{{ formatDateTime(order.expireAt) }}</dd>
            </div>
          </dl>
        </div>

        <!-- 账号列表 -->
        <div v-if="order.accounts?.length">
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs text-ink-400 uppercase tracking-wider font-medium">
              账号交付 ({{ order.accounts.length }})
            </div>
            <button class="text-xs text-brand-700 hover:underline" @click="copyAllAccounts">
              一键复制全部
            </button>
          </div>
          <ul class="space-y-2">
            <li
              v-for="(a, i) in order.accounts"
              :key="i"
              class="p-3 bg-ink-50/60 rounded-lg space-y-2"
            >
              <div class="flex items-center justify-between text-xs">
                <span class="text-ink-500">#{{ i + 1 }}</span>
                <span v-if="a.id" class="text-ink-400 font-mono">ID: {{ a.id }}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-ink-500 w-12 shrink-0">邮箱</span>
                <code class="text-xs text-ink-800 break-all flex-1 font-mono">{{ a.account_json?.email || a.email }}</code>
                <button class="text-xs text-brand-700 hover:underline shrink-0" @click="copy(a.account_json?.email || a.email, '邮箱已复制')">复制</button>
              </div>
              <div v-if="a.account_json?.access_token" class="flex items-start gap-2">
                <span class="text-xs text-ink-500 w-12 shrink-0 mt-0.5">Token</span>
                <code class="text-[11px] text-ink-700 break-all flex-1 font-mono leading-relaxed">{{ a.account_json.access_token }}</code>
                <button class="text-xs text-brand-700 hover:underline shrink-0 mt-0.5" @click="copy(a.account_json!.access_token as string, 'Token 已复制')">复制</button>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <!-- ────── Footer ────── -->
      <div class="px-5 py-3 border-t border-ink-100 flex items-center gap-2 flex-wrap bg-ink-50/30">
        <BrandButton
          v-if="['FAILED', 'PAID'].includes(order.status)"
          variant="primary"
          size="sm"
          :loading="acting === 'retry'"
          @click="retry"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          重新发货
        </BrandButton>

        <BrandButton
          v-if="order.paymentMethod === 'ALIPAY' && ['PENDING','PAID','DELIVERED'].includes(order.status)"
          variant="secondary"
          size="sm"
          :loading="acting === 'query'"
          @click="alipayQuery"
        >
          查询支付宝
        </BrandButton>

        <BrandButton
          v-if="order.paymentMethod === 'ALIPAY' && ['PAID','DELIVERED'].includes(order.status)"
          variant="danger"
          size="sm"
          :loading="acting === 'refund'"
          @click="alipayRefund"
        >
          支付宝原路退款
        </BrandButton>

        <BrandButton
          v-if="!['PAID','DELIVERED'].includes(order.status)"
          variant="ghost"
          size="sm"
          class="ml-auto !text-rose-600 hover:!bg-rose-50"
          :loading="acting === 'delete'"
          @click="deleteOrder"
        >
          删除订单
        </BrandButton>
      </div>
    </div>
  </el-drawer>
</template>
