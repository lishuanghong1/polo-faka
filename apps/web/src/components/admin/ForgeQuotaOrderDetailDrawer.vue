<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, computed } from 'vue';
import { ElDrawer, ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import StatusTag from '@/components/admin/StatusTag.vue';
import BrandButton from '@/components/BrandButton.vue';
import { formatDateTime, formatMoneyRaw, copyText } from '@/utils/format';

const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024);
const onResize = () => { viewportWidth.value = window.innerWidth; };
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));
const drawerSize = computed(() => (viewportWidth.value < 768 ? '100%' : '640px'));

const props = defineProps<{ orderNo: string | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed'): void;
}>();

const order = ref<any>(null);
const loading = ref(false);
const open = ref(false);
const acting = ref<string>('');
/** 勾选待作废的码 */
const selectedCodes = ref<Set<string>>(new Set());

watch(
  () => props.orderNo,
  async (no) => {
    if (no) {
      open.value = true;
      selectedCodes.value = new Set();
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
    order.value = await api.forge.quota.admin.orderDetail(props.orderNo);
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
  if (m === 'POINTS') return '积分';
  if (m === 'REDEEM') return '兑换码';
  return order.value?.paymentMethod || '-';
});

const vipName: Record<string, string> = { GOLD: '黄金', DIAMOND: '钻石', SUPREME: '超级' };

const payMethodChipCls = computed(() => {
  const m = (order.value?.paymentMethod || '').toUpperCase();
  if (m === 'ALIPAY')  return 'bg-sky-50 text-sky-700 border-sky-200';
  if (m === 'BALANCE') return 'bg-brand-50 text-brand-700 border-brand-200';
  if (m === 'POINTS')  return 'bg-amber-50 text-amber-700 border-amber-200';
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

const codeStatusMeta: Record<string, { text: string; cls: string }> = {
  unused: { text: '未核销', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  used: { text: '已核销', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  voided: { text: '已作废', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
};

function toggleSelect(code: string) {
  const s = new Set(selectedCodes.value);
  if (s.has(code)) s.delete(code);
  else s.add(code);
  selectedCodes.value = s;
}

const unusedCodes = computed(
  () => (order.value?.codes || []).filter((c: any) => c.status === 'unused'),
);

function selectAllUnused() {
  const s = new Set<string>();
  for (const c of unusedCodes.value) s.add(c.code);
  selectedCodes.value = s;
}

async function retry() {
  if (acting.value) return;
  acting.value = 'retry';
  try {
    await api.forge.quota.admin.retryFulfill(order.value.orderNo);
    ElMessage.success('已重发');
    await load();
    emit('changed');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '重发失败');
  } finally {
    acting.value = '';
  }
}

async function refreshCodes() {
  if (acting.value) return;
  acting.value = 'refresh';
  try {
    order.value = await api.forge.quota.admin.refreshCodes(order.value.orderNo);
    ElMessage.success('已从三方刷新核销状态');
    emit('changed');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '刷新失败');
  } finally {
    acting.value = '';
  }
}

async function voidSelected() {
  const codes = Array.from(selectedCodes.value);
  if (!codes.length) return ElMessage.warning('请先勾选要作废的兑换码（仅未核销的码可作废）');
  let reason = '';
  try {
    const { value } = await ElMessageBox.prompt(
      `将作废 ${codes.length} 个未核销的兑换码，作废后码不可再被兑换，出库款按单价退回代理余额。此操作不可撤销。`,
      '确认作废兑换码',
      {
        inputPlaceholder: '作废原因（建议填你侧退款单号，会记入三方备注）',
        confirmButtonText: '确认作废',
        confirmButtonClass: 'el-button--danger',
      },
    );
    reason = (value || '').trim();
  } catch {
    return;
  }
  acting.value = 'void';
  try {
    const r = await api.forge.quota.admin.voidCodes(codes, reason || undefined);
    if (r.voidedCount > 0) {
      ElMessage.success(r.message || `已作废 ${r.voidedCount} 个码，退回 ¥${r.refundTotal}`);
    } else {
      ElMessage.warning(r.message || '没有可作废的码');
    }
    if (r.skipped?.length) {
      ElMessage.info(`${r.skipped.length} 个码被跳过：${r.skipped.map((s: any) => `${s.code}(${s.reason})`).join('；')}`);
    }
    selectedCodes.value = new Set();
    await load();
    emit('changed');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '作废失败');
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
      '支付宝原路退款（不可撤销，立即退款到买家账户）。提示：如码未核销，请先在上方作废对应兑换码，避免退款后码仍被兑换。',
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
      `将永久删除额度包订单 ${order.value.orderNo}，已支付/已发货订单需先退款。是否继续？`,
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
    await api.forge.quota.admin.deleteOrder(order.value.orderNo);
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

function copyAllCodes() {
  const lines: string[] = [];
  for (const c of order.value?.codes || []) {
    lines.push(`兑换码: ${c.code}`);
    if (c.redeem_url) lines.push(`兑换链接: ${c.redeem_url}`);
    lines.push('---');
  }
  copy(lines.join('\n'), '已复制全部兑换码');
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
    :size="drawerSize"
    :with-header="false"
    @update:model-value="(v: boolean) => !v && close()"
  >
    <div v-if="loading" class="p-10 text-center text-ink-400 text-sm">加载中…</div>

    <div v-else-if="order" class="flex flex-col h-full">
      <!-- ────── Header ────── -->
      <div class="px-5 py-4 border-b border-ink-100 flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs text-ink-400 uppercase tracking-wider font-medium">额度包订单</span>
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

        <!-- 额度包信息 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">额度包</div>
          <div class="card p-3.5 bg-ink-50/40">
            <div class="font-medium text-ink-900">{{ order.packageName }}</div>
            <div class="text-xs text-ink-500 font-mono mt-0.5">{{ order.packageKey }} · 线路 {{ order.lineKey }}</div>
            <div class="flex items-center gap-3 mt-2.5 text-xs text-ink-600">
              <span>面值 ${{ order.quotaUsd }}</span>
              <span class="w-1 h-1 rounded-full bg-ink-300" />
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
              <div class="font-medium">出码失败</div>
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
            <div v-if="order.upstreamBatchNo" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">上游批次</dt>
              <dd class="font-mono text-xs text-ink-700 truncate">{{ order.upstreamBatchNo }}</dd>
            </div>
            <div v-if="order.thirdTradeNo" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">支付单号</dt>
              <dd class="font-mono text-xs text-ink-700 truncate">{{ order.thirdTradeNo }}</dd>
            </div>
            <div v-if="order.redeemCode" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">下单兑换码</dt>
              <dd class="font-mono text-xs text-ink-700 truncate">{{ order.redeemCode }}</dd>
            </div>
            <div v-if="order.contact" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">联系方式</dt>
              <dd class="text-ink-700 truncate">{{ order.contact }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">下单用户</dt>
              <dd v-if="order.user" class="text-right min-w-0">
                <div class="text-ink-900 truncate">
                  {{ order.user.nickname || order.user.username }}
                  <span class="text-ink-400 text-xs font-mono">#{{ order.user.id }}</span>
                  <span
                    v-if="order.user.vipTier && order.user.vipTier !== 'NONE'"
                    class="ml-1 inline-flex px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] align-middle"
                  >{{ vipName[order.user.vipTier] }}VIP</span>
                </div>
                <div v-if="order.user.email" class="text-[11px] text-ink-400 truncate">{{ order.user.email }}</div>
              </dd>
              <dd v-else-if="order.userId" class="text-ink-700">#{{ order.userId }}</dd>
              <dd v-else class="text-ink-400">游客下单（未登录）</dd>
            </div>
            <div v-if="order.buyerLogonId" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">支付宝账号</dt>
              <dd class="text-ink-700 text-xs text-right break-all">{{ order.buyerLogonId }}</dd>
            </div>
            <div v-if="order.ip" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">IP</dt>
              <dd class="text-ink-700 font-mono text-xs">{{ order.ip }}</dd>
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
              <dt class="text-ink-500 shrink-0">发码时间</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(order.deliveredAt) }}</dd>
            </div>
            <div v-if="order.codesSyncedAt" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">码状态同步于</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(order.codesSyncedAt) }}</dd>
            </div>
            <div v-if="order.refundedAt" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">退款</dt>
              <dd class="text-xs text-rose-600 text-right">
                ¥{{ order.refundAmount != null ? formatMoneyRaw(order.refundAmount) : '-' }}
                · {{ formatDateTime(order.refundedAt) }}
                <div v-if="order.refundReason" class="text-ink-400">{{ order.refundReason }}</div>
              </dd>
            </div>
          </dl>
        </div>

        <!-- 兑换码列表 -->
        <div v-if="order.codes?.length">
          <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <div class="text-xs text-ink-400 uppercase tracking-wider font-medium">
              兑换码 ({{ order.codes.length }})
              <span class="normal-case text-ink-500">
                · 已核销 {{ order.usedCount }} · 已作废 {{ order.voidedCount }}
              </span>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <button class="text-brand-700 hover:underline" @click="copyAllCodes">复制全部</button>
              <button
                v-if="unusedCodes.length"
                class="text-ink-500 hover:underline"
                @click="selectAllUnused"
              >全选未核销</button>
            </div>
          </div>
          <ul class="space-y-2">
            <li
              v-for="(c, i) in order.codes"
              :key="c.code"
              class="p-3 bg-ink-50/60 rounded-lg space-y-1.5"
            >
              <div class="flex items-center justify-between text-xs gap-2">
                <label class="flex items-center gap-1.5 text-ink-500 select-none" :class="c.status === 'unused' ? 'cursor-pointer' : 'opacity-40'">
                  <input
                    type="checkbox"
                    :disabled="c.status !== 'unused'"
                    :checked="selectedCodes.has(c.code)"
                    @change="toggleSelect(c.code)"
                  />
                  #{{ i + 1 }}
                </label>
                <span
                  class="inline-flex px-2 py-0.5 rounded-md text-[11px] border whitespace-nowrap"
                  :class="(codeStatusMeta[c.status] || codeStatusMeta.unused).cls"
                >
                  {{ (codeStatusMeta[c.status] || codeStatusMeta.unused).text }}
                  <template v-if="c.status === 'used' && c.used_at">&nbsp;· {{ formatDateTime(c.used_at) }}</template>
                </span>
              </div>
              <div class="flex items-center gap-2">
                <code
                  class="text-xs break-all flex-1 font-mono tracking-wide"
                  :class="c.status === 'voided' ? 'text-ink-400 line-through' : 'text-ink-800'"
                >{{ c.code }}</code>
                <button class="text-xs text-brand-700 hover:underline shrink-0" @click="copy(c.code, '兑换码已复制')">复制</button>
              </div>
              <div v-if="c.redeem_url" class="flex items-center gap-2">
                <a
                  :href="c.redeem_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[11px] break-all flex-1 font-mono text-brand-600 hover:underline"
                >{{ c.redeem_url }}</a>
                <button class="text-xs text-brand-700 hover:underline shrink-0" @click="copy(c.redeem_url, '兑换链接已复制')">复制</button>
              </div>
              <div v-if="c.status === 'voided' && c.void_reason" class="text-[11px] text-rose-600">
                作废原因：{{ c.void_reason }}
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
          重新出码
        </BrandButton>

        <BrandButton
          v-if="order.status === 'DELIVERED'"
          variant="secondary"
          size="sm"
          :loading="acting === 'refresh'"
          @click="refreshCodes"
        >
          刷新核销状态
        </BrandButton>

        <BrandButton
          v-if="order.status === 'DELIVERED' && unusedCodes.length"
          variant="danger"
          size="sm"
          :loading="acting === 'void'"
          @click="voidSelected"
        >
          作废勾选的码{{ selectedCodes.size ? `（${selectedCodes.size}）` : '' }}
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
