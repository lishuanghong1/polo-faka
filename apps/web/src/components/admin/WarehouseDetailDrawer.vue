<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElDrawer, ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import BrandButton from '@/components/BrandButton.vue';
import { formatDateTime, copyText } from '@/utils/format';
import { membershipLabel } from '@/utils/cursor-membership';

const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024);
const onResize = () => { viewportWidth.value = window.innerWidth; };
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));
const drawerSize = computed(() => (viewportWidth.value < 768 ? '100%' : '560px'));

const props = defineProps<{ id: number | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed'): void;
  (e: 'assign', row: any): void;
  (e: 'set-refund-time', row: any): void;
}>();

const wa = ref<any>(null);
const loading = ref(false);
const open = ref(false);
const acting = ref('');
const cursorInfo = ref<any>(null);
const cursorLoading = ref(false);

watch(
  () => props.id,
  async (id) => {
    if (id) {
      open.value = true;
      cursorInfo.value = null;
      await load();
      // 有 token 的号自动拉一次订阅/用量
      fetchCursorInfo();
    } else {
      open.value = false;
      wa.value = null;
    }
  },
  { immediate: true },
);

async function load() {
  if (!props.id) return;
  loading.value = true;
  try {
    wa.value = await api.admin.warehouseGet(props.id);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载失败');
    close();
  } finally {
    loading.value = false;
  }
}

function close() {
  open.value = false;
  emit('close');
}

const statusMeta: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '未分配', cls: 'bg-amber-100 text-amber-700' },
  ASSIGNED: { text: '已上架', cls: 'bg-sky-100 text-sky-700' },
  SOLD: { text: '已售出', cls: 'bg-emerald-100 text-emerald-700' },
  UNLISTED: { text: '已下架', cls: 'bg-ink-200 text-ink-600' },
};

const refundMeta = computed(() => {
  const r = wa.value;
  if (!r || r.status !== 'SOLD') return { text: '—', cls: 'text-ink-400' };
  if (r.refundStatus === 'DONE') {
    const amt = r.refundAmount ? `（$${Number(r.refundAmount).toFixed(2)}）` : '';
    return { text: `已退款${amt}`, cls: 'text-emerald-600' };
  }
  if (r.refundStatus === 'FAILED') return { text: '退款失败', cls: 'text-rose-600' };
  if (r.refundNotifiedAt) return { text: '已通知', cls: 'text-emerald-600' };
  if (!r.refundAt) return { text: '未设置退款时间', cls: 'text-ink-400' };
  return new Date(r.refundAt).getTime() <= Date.now()
    ? { text: '待处理', cls: 'text-amber-600' }
    : { text: '等待到点：' + new Date(r.refundAt).toLocaleString(), cls: 'text-ink-600' };
});

const membership = computed(() => membershipLabel(cursorInfo.value?.membershipType));

async function fetchCursorInfo() {
  if (!wa.value) return;
  cursorLoading.value = true;
  cursorInfo.value = null;
  try {
    cursorInfo.value = await api.admin.warehouseCursorInfo(wa.value.id);
  } catch (e: any) {
    cursorInfo.value = { ok: false, error: e?.response?.data?.error?.message || '查询失败' };
  } finally {
    cursorLoading.value = false;
  }
}

async function run(name: string, fn: () => Promise<any>, okMsg?: string) {
  if (acting.value) return;
  acting.value = name;
  try {
    await fn();
    if (okMsg) ElMessage.success(okMsg);
    await load();
    emit('changed');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.response?.data?.message || '操作失败');
    await load();
    emit('changed');
  } finally {
    acting.value = '';
  }
}

async function refundNow() {
  await ElMessageBox.confirm('立即对该账号执行 Cursor 退款（账号将变 Free）？', '立即退款', {
    type: 'warning', confirmButtonText: '退款',
  });
  await run('refund', () => api.admin.warehouseRefundNow(wa.value.id), '退款已执行');
}
function resetRefund() {
  return run('reset', () => api.admin.warehouseRefundReset(wa.value.id), '已重置，将重新排入自动退款');
}
function notifyRefund() {
  return run('notify', () => api.admin.warehouseNotifyRefund(wa.value.id), '已推送到企业微信');
}
async function unassign() {
  await ElMessageBox.confirm('撤回分配？关联卡密会被删除（须 AVAILABLE）', '撤回', { type: 'warning' });
  await run('unassign', () => api.admin.warehouseUnassign(wa.value.id), '已撤回');
}
async function del() {
  const tip = wa.value.status === 'SOLD'
    ? '确认删除已售出账号？订单与卡密保留，仅移除仓库记录'
    : '确认删除该仓库账号？';
  await ElMessageBox.confirm(tip, '删除', { type: 'warning' });
  acting.value = 'del';
  try {
    await api.admin.warehouseRemove(wa.value.id);
    ElMessage.success('已删除');
    emit('changed');
    close();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败');
  } finally {
    acting.value = '';
  }
}
async function revealContent() {
  await ElMessageBox({
    title: `账号 #${wa.value.id} 完整内容`,
    message: wa.value.content,
    confirmButtonText: '我已复制',
    type: 'info',
  } as any).catch(() => null);
}
async function copyContent() {
  const ok = await copyText(wa.value.content || '');
  if (ok) ElMessage.success('已复制完整内容');
}
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

    <div v-else-if="wa" class="flex flex-col h-full">
      <!-- Header -->
      <div class="px-5 py-4 border-b border-ink-100 flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs text-ink-400 uppercase tracking-wider font-medium">仓库账号</span>
            <span class="px-2 py-0.5 rounded text-xs font-medium" :class="(statusMeta[wa.status] || {}).cls">
              {{ (statusMeta[wa.status] || { text: wa.status }).text }}
            </span>
          </div>
          <div class="text-sm text-ink-900 break-all">{{ wa.email || '(无邮箱)' }}</div>
          <div class="text-[11px] text-ink-400 font-mono mt-0.5">#{{ wa.id }}<span v-if="wa.sourceRef"> · {{ wa.sourceRef }}</span></div>
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

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- 订阅 / 用量（现查） -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs text-ink-400 uppercase tracking-wider font-medium">订阅 / 用量</div>
            <button class="text-xs text-brand-600 hover:underline disabled:opacity-40" :disabled="cursorLoading" @click="fetchCursorInfo">
              {{ cursorLoading ? '查询中…' : '刷新' }}
            </button>
          </div>
          <div v-if="cursorLoading" class="text-sm text-ink-400">正在查询 Cursor…</div>
          <div v-else-if="cursorInfo && cursorInfo.ok" class="space-y-1.5 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500">订阅类型</dt>
              <dd><span class="px-2 py-0.5 rounded text-xs font-medium" :class="membership.cls">{{ membership.text }}</span></dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500">用量</dt>
              <dd class="text-ink-800 text-right">{{ cursorInfo.usageText || (cursorInfo.usagePercent != null ? cursorInfo.usagePercent.toFixed(1) + '%' : '—') }}</dd>
            </div>
            <div v-if="cursorInfo.email" class="flex justify-between gap-3">
              <dt class="text-ink-500">Cursor 邮箱</dt>
              <dd class="text-ink-700 text-xs break-all text-right">{{ cursorInfo.email }}</dd>
            </div>
          </div>
          <div v-else class="text-xs text-rose-500">{{ cursorInfo?.error || '未获取到（可能无 token 或已失效）' }}</div>
        </div>

        <!-- 退款 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">退款</div>
          <dl class="text-sm space-y-1.5">
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500">退款状态</dt>
              <dd :class="refundMeta.cls">{{ refundMeta.text }}</dd>
            </div>
            <div v-if="wa.refundAt" class="flex justify-between gap-3">
              <dt class="text-ink-500">退款时间</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(wa.refundAt) }}</dd>
            </div>
            <div v-if="wa.refundedAt" class="flex justify-between gap-3">
              <dt class="text-ink-500">已退款于</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(wa.refundedAt) }}</dd>
            </div>
            <div v-if="wa.refundError" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">失败原因</dt>
              <dd class="text-xs text-rose-600 text-right">{{ wa.refundError }}</dd>
            </div>
            <div v-if="wa.refundNote" class="flex justify-between gap-3">
              <dt class="text-ink-500 shrink-0">备注</dt>
              <dd class="text-ink-700 text-right">{{ wa.refundNote }}</dd>
            </div>
          </dl>
        </div>

        <!-- 基本信息 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">基本信息</div>
          <dl class="text-sm space-y-1.5">
            <div v-if="wa.productTitle" class="flex justify-between gap-3">
              <dt class="text-ink-500">分配到</dt>
              <dd class="text-ink-800 text-right">{{ wa.productTitle }}<span v-if="wa.skuName" class="text-ink-400"> / {{ wa.skuName }}</span></dd>
            </div>
            <div v-if="wa.soldAt" class="flex justify-between gap-3">
              <dt class="text-ink-500">售出时间</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(wa.soldAt) }}</dd>
            </div>
            <div v-if="wa.orderNo" class="flex justify-between gap-3">
              <dt class="text-ink-500">订单号</dt>
              <dd class="text-xs font-mono text-ink-700">{{ wa.orderNo }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500">入库时间</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(wa.createdAt) }}</dd>
            </div>
            <div class="pt-1">
              <button class="text-xs text-brand-600 hover:underline mr-3" @click="revealContent">查看完整内容</button>
              <button class="text-xs text-brand-600 hover:underline" @click="copyContent">复制完整内容</button>
            </div>
          </dl>
        </div>
      </div>

      <!-- Footer 操作 -->
      <div class="px-5 py-3 border-t border-ink-100 bg-ink-50/30">
        <div class="grid grid-cols-2 gap-2">
          <BrandButton v-if="wa.status === 'PENDING'" variant="primary" size="sm" @click="emit('assign', wa)">分配到商品</BrandButton>
          <BrandButton v-if="wa.status === 'ASSIGNED'" variant="secondary" size="sm" :loading="acting === 'unassign'" @click="unassign">撤回分配</BrandButton>

          <BrandButton v-if="wa.status === 'SOLD'" variant="secondary" size="sm" @click="emit('set-refund-time', wa)">设置退款时间</BrandButton>
          <BrandButton v-if="wa.status === 'SOLD' && wa.refundStatus !== 'DONE'" variant="danger" size="sm" :loading="acting === 'refund'" @click="refundNow">立即退款</BrandButton>
          <BrandButton v-if="wa.status === 'SOLD' && wa.refundStatus === 'FAILED'" variant="secondary" size="sm" :loading="acting === 'reset'" @click="resetRefund">重置重试</BrandButton>
          <BrandButton v-if="wa.status === 'SOLD'" variant="secondary" size="sm" :loading="acting === 'notify'" @click="notifyRefund">推企业微信</BrandButton>

          <BrandButton variant="ghost" size="sm" class="!text-rose-600 hover:!bg-rose-50" :loading="acting === 'del'" @click="del">删除</BrandButton>
        </div>
      </div>
    </div>
  </el-drawer>
</template>
