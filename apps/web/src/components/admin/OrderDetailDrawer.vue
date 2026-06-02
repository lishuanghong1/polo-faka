<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElDrawer, ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import StatusTag from '@/components/admin/StatusTag.vue';

const props = defineProps<{ orderNo: string | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed'): void;
}>();

const order = ref<any>(null);
const loading = ref(false);
const manualOpen = ref(false);
const manualContent = ref('');

const open = ref(false);

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
    order.value = await api.admin.orderDetail(props.orderNo);
  } finally {
    loading.value = false;
  }
}

const payMethodLabel: Record<string, string> = {
  ALIPAY: '支付宝', WECHAT: '微信', BALANCE: '余额', USDT: 'USDT', MOCK: 'Mock 支付',
};

async function markPaid() {
  await ElMessageBox.confirm('确认将此订单标记为已支付并尝试发货？', '提示', { type: 'warning' });
  await api.admin.orderMarkPaid(order.value.orderNo);
  ElMessage.success('已标记并发货');
  await load();
  emit('changed');
}

async function redeliver() {
  await ElMessageBox.confirm('从库内可用卡密重试发货？', '提示');
  await api.admin.orderRedeliver(order.value.orderNo);
  ElMessage.success('补发已执行');
  await load();
  emit('changed');
}

async function refund() {
  const isAlipay = order.value?.payMethod === 'ALIPAY';
  await ElMessageBox.confirm(
    isAlipay
      ? '账面退款仅会把订单状态改为「已退款」并回收卡密，不会真的把钱退给买家。如需把支付宝款项退回买家，请使用「支付宝原路退款」。是否继续仅做账面退款？'
      : '账面退款会把订单状态改为「已退款」并回收卡密，不涉及真实款项。是否继续？',
    isAlipay ? '账面退款（不退实际款项）' : '账面退款',
    {
      type: 'warning',
      confirmButtonText: '继续账面退款',
      cancelButtonText: '取消',
    },
  );
  const { value } = await ElMessageBox.prompt('退款原因（可选）', '账面退款原因', {
    inputType: 'text',
    inputPlaceholder: '如：协商退款 / 库存补不上',
    confirmButtonText: '确认退款',
  });
  await api.admin.orderRefund(order.value.orderNo, value);
  ElMessage.success('已账面退款');
  await load();
  emit('changed');
}

async function alipayQuery() {
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
}

async function alipayRefund() {
  const { value } = await ElMessageBox.prompt(
    '支付宝原路退款（不可撤销，会立即退款到买家账户）',
    '确认原路退款',
    {
      inputType: 'text',
      inputPlaceholder: '退款原因，会写入支付宝账单',
      confirmButtonText: '确认退款',
      confirmButtonClass: 'el-button--danger',
      inputValidator: (v) => (v && v.trim().length >= 2 ? true : '原因至少 2 个字'),
    },
  );
  const r = await api.admin.alipayRefund(order.value.orderNo, value);
  ElMessage.success(`支付宝退款成功 ¥${r.amount}`);
  await load();
  emit('changed');
}

async function cancel() {
  await ElMessageBox.confirm('确认取消此未支付订单？', '提示', { type: 'warning' });
  await api.admin.orderCancel(order.value.orderNo);
  ElMessage.success('已取消');
  await load();
  emit('changed');
}

async function deleteOrder() {
  try {
    await ElMessageBox.confirm(
      '将永久删除此订单，订单上锁定的可用卡密会回滚到库存。确定继续？',
      '危险操作',
      {
        type: 'warning',
        confirmButtonText: '删除订单',
        confirmButtonClass: 'el-button--danger',
      },
    );
  } catch {
    return;
  }
  try {
    await api.admin.orderDelete(order.value.orderNo);
    ElMessage.success('已删除');
    emit('changed');
    close();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败');
  }
}

function openManual() {
  manualContent.value = '';
  manualOpen.value = true;
}

async function doManualDeliver() {
  const lines = manualContent.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) {
    ElMessage.warning('请输入至少一条卡密');
    return;
  }
  await api.admin.orderManualDeliver(order.value.orderNo, lines);
  ElMessage.success('已手动发货');
  manualOpen.value = false;
  await load();
  emit('changed');
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => ElMessage.success('已复制'));
}

function close() {
  open.value = false;
  emit('close');
}
</script>

<template>
  <el-drawer
    :model-value="open"
    :show-close="true"
    direction="rtl"
    size="540px"
    :with-header="false"
    @update:model-value="(v: boolean) => !v && close()"
  >
    <div v-if="loading" class="p-10 text-center text-ink-400 text-sm">加载中...</div>

    <div v-else-if="order" class="flex flex-col h-full">
      <!-- Header -->
      <div class="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm text-ink-500">订单</span>
            <StatusTag :status="order.status" />
          </div>
          <div class="font-mono text-sm text-ink-900 break-all">{{ order.orderNo }}</div>
        </div>
        <button class="text-ink-400 hover:text-ink-900" @click="close">×</button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- Product info -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">商品</div>
          <div class="card p-3 bg-ink-50/40">
            <div class="font-medium text-ink-900">{{ order.productTitle }}</div>
            <div class="text-sm text-ink-500 mt-0.5">{{ order.skuName }}</div>
            <div class="flex items-center gap-4 mt-2 text-xs text-ink-600">
              <span>单价 ¥{{ order.unitPrice }}</span>
              <span>×{{ order.quantity }}</span>
              <span class="text-price font-semibold ml-auto text-base">¥{{ order.totalAmount }}</span>
            </div>
          </div>
        </div>

        <!-- Meta -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">支付与时间</div>
          <dl class="text-sm space-y-1.5">
            <div class="flex justify-between"><dt class="text-ink-500">支付方式</dt><dd>{{ payMethodLabel[order.payMethod] }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-500">实付</dt><dd>¥{{ order.payAmount }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-500">下单时间</dt><dd class="text-xs">{{ new Date(order.createdAt).toLocaleString() }}</dd></div>
            <div v-if="order.paidAt" class="flex justify-between"><dt class="text-ink-500">支付时间</dt><dd class="text-xs">{{ new Date(order.paidAt).toLocaleString() }}</dd></div>
            <div v-if="order.deliveredAt" class="flex justify-between"><dt class="text-ink-500">发货时间</dt><dd class="text-xs">{{ new Date(order.deliveredAt).toLocaleString() }}</dd></div>
            <div v-if="order.contact" class="flex justify-between"><dt class="text-ink-500">联系方式</dt><dd>{{ order.contact }}</dd></div>
            <div v-if="order.userId" class="flex justify-between"><dt class="text-ink-500">用户 ID</dt><dd>#{{ order.userId }}</dd></div>
            <div v-else class="flex justify-between"><dt class="text-ink-500">用户</dt><dd class="text-ink-400">游客订单</dd></div>
            <div v-if="order.ip" class="flex justify-between"><dt class="text-ink-500">IP</dt><dd class="font-mono text-xs">{{ order.ip }}</dd></div>
            <div v-if="order.thirdTradeNo" class="flex justify-between"><dt class="text-ink-500">支付宝单号</dt><dd class="font-mono text-xs">{{ order.thirdTradeNo }}</dd></div>
            <div v-if="order.redeemCode" class="flex justify-between"><dt class="text-ink-500">兑换码</dt><dd class="font-mono text-xs">{{ order.redeemCode }}</dd></div>
            <div v-if="order.buyerLogonId" class="flex justify-between"><dt class="text-ink-500">买家</dt><dd class="text-xs">{{ order.buyerLogonId }}</dd></div>
            <div v-if="order.refundedAt" class="flex justify-between"><dt class="text-ink-500">退款时间</dt><dd class="text-xs">{{ new Date(order.refundedAt).toLocaleString() }}</dd></div>
            <div v-if="order.refundReason" class="flex justify-between"><dt class="text-ink-500">退款原因</dt><dd class="text-xs">{{ order.refundReason }}</dd></div>
            <div v-if="order.remark" class="flex justify-between"><dt class="text-ink-500">备注</dt><dd class="text-xs">{{ order.remark }}</dd></div>
          </dl>
        </div>

        <!-- Card keys -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs text-ink-400 uppercase tracking-wider font-medium">卡密 ({{ order.cardKeys?.length || 0 }} / {{ order.quantity }})</div>
            <button
              v-if="order.cardKeys?.length"
              class="text-xs text-brand-700 hover:underline"
              @click="copy(order.cardKeys.map((c: any) => c.content).join('\n'))"
            >一键复制全部</button>
          </div>
          <div v-if="!order.cardKeys?.length" class="text-sm text-ink-400 py-3 text-center bg-ink-50/40 rounded-lg">
            暂无卡密
          </div>
          <ul v-else class="space-y-1.5">
            <li
              v-for="c in order.cardKeys"
              :key="c.id"
              class="p-2.5 bg-ink-50/60 rounded-lg flex items-center justify-between gap-2"
            >
              <code class="text-xs text-ink-700 font-mono break-all">{{ c.content }}</code>
              <button class="text-xs text-brand-700 hover:underline shrink-0" @click="copy(c.content)">复制</button>
            </li>
          </ul>
        </div>
      </div>

      <!-- Footer actions -->
      <div class="px-5 py-3 border-t border-ink-100 flex items-center gap-2 flex-wrap">
        <button
          v-if="order.status === 'PENDING'"
          class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm"
          @click="markPaid"
        >标记已支付并发货</button>
        <button
          v-if="order.status === 'PENDING'"
          class="px-3 py-1.5 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 text-sm"
          @click="cancel"
        >取消订单</button>

        <button
          v-if="['PAID', 'DELIVERED'].includes(order.status) && order.cardKeys?.length < order.quantity"
          class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm"
          @click="redeliver"
        >从库内补发</button>
        <button
          v-if="['PAID', 'DELIVERED'].includes(order.status) && order.cardKeys?.length < order.quantity"
          class="px-3 py-1.5 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 text-sm"
          @click="openManual"
        >手动输入卡密发货</button>

        <button
          v-if="order.payMethod === 'ALIPAY' && ['PENDING','PAID','DELIVERED'].includes(order.status)"
          class="px-3 py-1.5 rounded-lg border border-sky-200 text-sky-700 hover:bg-sky-50 text-sm"
          @click="alipayQuery"
        >查询支付宝状态</button>

        <button
          v-if="order.payMethod === 'ALIPAY' && ['PAID', 'DELIVERED'].includes(order.status)"
          class="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium shadow-sm"
          title="真实退款：会把钱原路退回买家支付宝"
          @click="alipayRefund"
        >支付宝原路退款</button>

        <button
          v-if="['PAID', 'DELIVERED'].includes(order.status)"
          class="ml-auto px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 text-sm"
          title="仅改账面状态，不退实际款项"
          @click="refund"
        >账面退款</button>

        <button
          v-if="!['PAID', 'DELIVERED'].includes(order.status)"
          class="ml-auto px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 text-sm"
          @click="deleteOrder"
        >删除订单</button>
      </div>
    </div>
  </el-drawer>

  <!-- 手动发货 dialog -->
  <el-dialog
    :model-value="manualOpen"
    width="520px"
    title="手动输入卡密发货"
    @update:model-value="(v: boolean) => !v && (manualOpen = false)"
  >
    <div class="text-sm space-y-2">
      <p class="text-xs text-ink-500">
        每行一条卡密，至少 {{ order ? (order.quantity - (order.cardKeys?.length || 0)) : 1 }} 条。
        手动发出的卡密不会进入库存，退款时直接标记为已退款。
      </p>
      <textarea
        v-model="manualContent"
        rows="8"
        class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs"
        placeholder="一行一条"
      />
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm" @click="manualOpen = false">取消</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="doManualDeliver">发货</button>
    </template>
  </el-dialog>
</template>
