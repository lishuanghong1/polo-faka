<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElDrawer, ElMessage, ElMessageBox } from 'element-plus';
import api, { type AdminUserDetail } from '@/api';
import StatusTag from '@/components/admin/StatusTag.vue';

// 响应式抽屉宽度：移动端全屏、桌面端定宽
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024);
const onResize = () => { viewportWidth.value = window.innerWidth; };
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));
const drawerSize = computed(() => (viewportWidth.value < 768 ? '100%' : '640px'));

const props = defineProps<{ userId: number | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed'): void;
}>();

const data = ref<AdminUserDetail | null>(null);
const loading = ref(false);
const open = ref(false);

watch(
  () => props.userId,
  async (id) => {
    if (id) {
      open.value = true;
      await load();
    } else {
      open.value = false;
      data.value = null;
    }
  },
  { immediate: true },
);

async function load() {
  if (!props.userId) return;
  loading.value = true;
  try {
    data.value = await api.admin.userDetail(props.userId);
  } finally {
    loading.value = false;
  }
}

function close() {
  open.value = false;
  emit('close');
}

const vipLabel: Record<string, { text: string; cls: string }> = {
  NONE: { text: '普通', cls: 'bg-ink-100 text-ink-600 border-ink-200' },
  GOLD: { text: '黄金 VIP', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  DIAMOND: { text: '钻石 VIP', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  SUPREME: { text: '至尊 VIP', cls: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
};

const balanceLogTypeLabel: Record<string, { text: string; cls: string }> = {
  RECHARGE: { text: '充值', cls: 'text-emerald-700' },
  CONSUME: { text: '消费', cls: 'text-rose-600' },
  REFUND: { text: '退款', cls: 'text-sky-700' },
  ADJUST: { text: '调整', cls: 'text-amber-700' },
};

const rechargeStatusLabel: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '待支付', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PAID: { text: '已入账', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELLED: { text: '已取消', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  EXPIRED: { text: '已过期', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  REFUNDED: { text: '已退款', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
};

const balanceConsistent = computed(() => {
  if (!data.value) return true;
  // 实付入账金额累计应该 ≈ totalRecharged
  // 这是一个简单的交叉验证：管理员可以一眼看出"入账 vs 累计"是否对得上
  return Math.abs(data.value.wallet.paidRechargeSum - data.value.wallet.totalRecharged) < 0.01;
});

async function adjust() {
  if (!data.value) return;
  const u = data.value.user;
  const { value } = await ElMessageBox.prompt(
    `调整 ${u.username} (#${u.id}) 余额（正数为充值，负数为扣除）`,
    '调整余额',
    {
      inputPattern: /^-?\d+(\.\d+)?$/,
      inputErrorMessage: '请输入有效金额',
      inputPlaceholder: '例如 10 或 -5.5',
    },
  );
  await api.admin.userAdjust(u.id, { amount: Number(value), note: '管理员调整' });
  ElMessage.success('已调整');
  await load();
  emit('changed');
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => ElMessage.success('已复制'));
}

function fmt(n: number) {
  return n.toFixed(2);
}
</script>

<template>
  <el-drawer
    :model-value="open"
    :show-close="true"
    direction="rtl"
    :size="drawerSize"
    :with-header="false"
    @update:model-value="(v: boolean) => !v && close()"
  >
    <div v-if="loading" class="p-10 text-center text-ink-400 text-sm">加载中...</div>

    <div v-else-if="data" class="flex flex-col h-full">
      <!-- Header -->
      <div class="px-5 py-4 border-b border-ink-100 flex items-start justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-full bg-ink-100 text-ink-700 flex items-center justify-center text-base font-semibold shrink-0">
            {{ data.user.username[0]?.toUpperCase() }}
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-ink-900 truncate">{{ data.user.username }}</span>
              <StatusTag :status="data.user.status" />
              <StatusTag :status="data.user.role" />
              <span
                class="inline-flex px-2 py-0.5 rounded-md text-[11px] border whitespace-nowrap"
                :class="vipLabel[data.user.vipTier]?.cls"
              >{{ vipLabel[data.user.vipTier]?.text }}</span>
            </div>
            <div class="text-xs text-ink-500 mt-0.5">
              #{{ data.user.id }}
              <template v-if="data.user.email"> · {{ data.user.email }}</template>
              <template v-if="data.user.nickname"> · {{ data.user.nickname }}</template>
            </div>
          </div>
        </div>
        <button class="text-ink-400 hover:text-ink-900 text-xl leading-none shrink-0" @click="close">×</button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- 钱包 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">钱包</div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div class="card p-3 bg-ink-50/40">
              <div class="text-xs text-ink-500">当前余额</div>
              <div class="text-lg font-semibold text-ink-900 mt-1">¥{{ fmt(data.wallet.balance) }}</div>
            </div>
            <div class="card p-3 bg-ink-50/40">
              <div class="text-xs text-ink-500">累计充值</div>
              <div class="text-lg font-semibold text-ink-900 mt-1">¥{{ fmt(data.wallet.totalRecharged) }}</div>
            </div>
            <div class="card p-3 bg-ink-50/40">
              <div class="text-xs text-ink-500">入账次数</div>
              <div class="text-lg font-semibold text-ink-900 mt-1">{{ data.wallet.paidRechargeCount }}</div>
            </div>
            <div class="card p-3 bg-ink-50/40">
              <div class="text-xs text-ink-500">入账总和</div>
              <div class="text-lg font-semibold text-ink-900 mt-1">¥{{ fmt(data.wallet.paidRechargeSum) }}</div>
            </div>
          </div>
          <div
            v-if="!balanceConsistent"
            class="mt-2 text-xs px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700"
          >
            <strong>注意：</strong>「入账总和」与「累计充值」不一致（差额 ¥{{ fmt(Math.abs(data.wallet.paidRechargeSum - data.wallet.totalRecharged)) }}）。
            可能是历史数据迁移或事务异常导致，建议复核流水。
          </div>
        </div>

        <!-- 账户元数据 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">账户</div>
          <dl class="text-sm space-y-1.5">
            <div class="flex justify-between"><dt class="text-ink-500">用户 ID</dt><dd class="font-mono">#{{ data.user.id }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-500">用户名</dt><dd>{{ data.user.username }}</dd></div>
            <div v-if="data.user.email" class="flex justify-between"><dt class="text-ink-500">邮箱</dt><dd>{{ data.user.email }}</dd></div>
            <div v-if="data.user.nickname" class="flex justify-between"><dt class="text-ink-500">昵称</dt><dd>{{ data.user.nickname }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-500">注册时间</dt><dd class="text-xs">{{ new Date(data.user.createdAt).toLocaleString() }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-500">最后登录</dt><dd class="text-xs">{{ data.user.lastLogin ? new Date(data.user.lastLogin).toLocaleString() : '从未登录' }}</dd></div>
            <div v-if="data.wallet.vipUpgradedAt" class="flex justify-between"><dt class="text-ink-500">VIP 升级时间</dt><dd class="text-xs">{{ new Date(data.wallet.vipUpgradedAt).toLocaleString() }}</dd></div>
          </dl>
        </div>

        <!-- 充值订单 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">
            充值订单（最近 30 笔）
          </div>
          <div v-if="!data.rechargeOrders.length" class="text-sm text-ink-400 py-3 text-center bg-ink-50/40 rounded-lg">
            没有充值记录
          </div>
          <ul v-else class="space-y-1.5">
            <li
              v-for="o in data.rechargeOrders"
              :key="o.orderNo"
              class="p-2.5 bg-ink-50/40 rounded-lg"
            >
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <code class="text-xs text-ink-700 font-mono break-all">{{ o.orderNo }}</code>
                <span
                  class="inline-flex px-2 py-0.5 rounded-md text-[11px] border whitespace-nowrap"
                  :class="rechargeStatusLabel[o.status]?.cls || 'bg-ink-100 text-ink-500 border-ink-200'"
                >{{ rechargeStatusLabel[o.status]?.text || o.status }}</span>
              </div>
              <div class="flex items-center justify-between gap-2 mt-1 text-xs text-ink-500">
                <span>
                  ¥{{ fmt(o.amount) }} · {{ o.payMethod }}
                  <template v-if="o.buyerLogonId"> · {{ o.buyerLogonId }}</template>
                </span>
                <span>{{ o.paidAt ? new Date(o.paidAt).toLocaleString() : new Date(o.createdAt).toLocaleString() }}</span>
              </div>
              <div v-if="o.thirdTradeNo" class="mt-1 text-[11px] text-ink-400 font-mono break-all">
                支付宝单号：{{ o.thirdTradeNo }}
                <button class="ml-1 text-brand-700 hover:underline" @click="copy(o.thirdTradeNo!)">复制</button>
              </div>
            </li>
          </ul>
        </div>

        <!-- 余额流水 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">
            余额流水（最近 50 条）
          </div>
          <div v-if="!data.balanceLogs.length" class="text-sm text-ink-400 py-3 text-center bg-ink-50/40 rounded-lg">
            没有余额流水
          </div>
          <ul v-else class="space-y-1">
            <li
              v-for="l in data.balanceLogs"
              :key="l.id"
              class="p-2 bg-ink-50/40 rounded flex items-center justify-between gap-2 text-xs"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span
                    class="font-medium"
                    :class="balanceLogTypeLabel[l.type]?.cls || 'text-ink-700'"
                  >{{ balanceLogTypeLabel[l.type]?.text || l.type }}</span>
                  <span
                    class="font-mono"
                    :class="l.amount >= 0 ? 'text-emerald-700' : 'text-rose-600'"
                  >{{ l.amount >= 0 ? '+' : '' }}{{ fmt(l.amount) }}</span>
                  <span class="text-ink-400">余 ¥{{ fmt(l.balance) }}</span>
                </div>
                <div v-if="l.note || l.refOrder" class="text-ink-500 mt-0.5 truncate">
                  {{ l.note }}<template v-if="l.refOrder"> · {{ l.refOrder }}</template>
                </div>
              </div>
              <div class="text-ink-400 shrink-0">{{ new Date(l.createdAt).toLocaleString() }}</div>
            </li>
          </ul>
        </div>

        <!-- 卡密订单 -->
        <div v-if="data.orders.length">
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">
            卡密订单（最近 20 笔）
          </div>
          <ul class="space-y-1.5">
            <li
              v-for="o in data.orders"
              :key="o.orderNo"
              class="p-2.5 bg-ink-50/40 rounded-lg"
            >
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <code class="text-xs text-ink-700 font-mono break-all">{{ o.orderNo }}</code>
                <StatusTag :status="o.status" />
              </div>
              <div class="text-xs text-ink-500 mt-1">
                {{ o.productTitle }} · {{ o.skuName }} ×{{ o.quantity }} · ¥{{ fmt(o.payAmount) }} · {{ o.payMethod }}
              </div>
              <div class="text-[11px] text-ink-400 mt-0.5">{{ new Date(o.createdAt).toLocaleString() }}</div>
            </li>
          </ul>
        </div>

        <!-- 代下订单 -->
        <div v-if="data.forgeOrders.length">
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">
            代下订单（最近 20 笔）
          </div>
          <ul class="space-y-1.5">
            <li
              v-for="o in data.forgeOrders"
              :key="o.orderNo"
              class="p-2.5 bg-ink-50/40 rounded-lg"
            >
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <code class="text-xs text-ink-700 font-mono break-all">{{ o.orderNo }}</code>
                <StatusTag :status="o.status" />
              </div>
              <div class="text-xs text-ink-500 mt-1">
                {{ o.typeName }} ×{{ o.quantity }} ·
                <template v-if="o.payAmount !== null">¥{{ fmt(o.payAmount) }}</template>
                <template v-else>¥{{ fmt(o.totalAmount) }}</template>
                · {{ o.paymentMethod }}
              </div>
              <div class="text-[11px] text-ink-400 mt-0.5">{{ new Date(o.createdAt).toLocaleString() }}</div>
            </li>
          </ul>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-ink-100 flex items-center gap-2">
        <button
          class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm"
          @click="adjust"
        >调整余额</button>
        <button
          class="px-3 py-1.5 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 text-sm"
          @click="load"
        >刷新</button>
      </div>
    </div>
  </el-drawer>
</template>
