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
  (e: 'edit', row: any): void;
}>();

const acc = ref<any>(null);
const loading = ref(false);
const open = ref(false);
const acting = ref('');
const usage = ref<any>(null);

watch(
  () => props.id,
  async (id) => {
    if (id) {
      open.value = true;
      usage.value = null;
      await load();
    } else {
      open.value = false;
      acc.value = null;
    }
  },
  { immediate: true },
);

async function load() {
  if (!props.id) return;
  loading.value = true;
  try {
    acc.value = await api.admin.cursorSubGet(props.id);
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
  unsubscribed: { text: '未订阅', cls: 'bg-ink-100 text-ink-600' },
  subscribed: { text: '已订阅', cls: 'bg-emerald-100 text-emerald-700' },
  expired: { text: '已过期', cls: 'bg-rose-100 text-rose-700' },
  unlisted: { text: '已下架', cls: 'bg-amber-100 text-amber-700' },
};
const saleMeta: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '待分配', cls: 'text-amber-600' },
  ASSIGNED: { text: '已上架', cls: 'text-sky-600' },
  SOLD: { text: '已售出', cls: 'text-emerald-600' },
  UNLISTED: { text: '已下架', cls: 'text-ink-400' },
};

const membership = computed(() => membershipLabel(acc.value?.membershipType));

const remainText = computed(() => {
  if (!acc.value?.expiresAt) return '—';
  const ms = new Date(acc.value.expiresAt).getTime() - Date.now();
  if (ms <= 0) return '已过期';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `剩 ${d} 天 ${h} 小时` : `剩 ${h} 小时`;
});

async function run(name: string, fn: () => Promise<any>, okMsg?: string) {
  if (acting.value) return;
  acting.value = name;
  try {
    const r = await fn();
    if (okMsg) ElMessage.success(okMsg);
    await load();
    emit('changed');
    return r;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.response?.data?.message || '操作失败');
  } finally {
    acting.value = '';
  }
}

async function genLink() {
  if (!acc.value?.hasCursorToken) return ElMessage.warning('该账号没有 token，无法生成');
  acting.value = 'gen';
  try {
    const r: any = await api.admin.cursorSubCheckoutLink(acc.value.id);
    const ok = await copyText(r.url);
    ElMessage.success(ok ? '订阅链接已生成并复制' : '订阅链接已生成');
    await load();
    emit('changed');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.response?.data?.message || '生成失败');
  } finally {
    acting.value = '';
  }
}
async function copyLink() {
  if (!acc.value?.lastCheckoutUrl) return;
  const ok = await copyText(acc.value.lastCheckoutUrl);
  if (ok) ElMessage.success('已复制订阅链接');
}
function sync() {
  return run('sync', () => api.admin.cursorSubSync(acc.value.id), '已同步订阅状态');
}
function markPaid() {
  return run('paid', () => api.admin.cursorSubMarkPaid(acc.value.id), '已标记已付款');
}
async function fetchUsage() {
  if (acting.value) return;
  acting.value = 'usage';
  try {
    const r: any = await api.admin.cursorSubUsage(acc.value.id);
    if (!r?.ok) ElMessage.warning(r?.error || '查询失败');
    usage.value = r;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '查询失败');
  } finally {
    acting.value = '';
  }
}
async function pushWarehouse() {
  await ElMessageBox.confirm(`把账号 ${acc.value.email} 推送到仓库（待分配）？`, '推送到仓库', {
    type: 'info',
    confirmButtonText: '推送',
  });
  return run('push', () => api.admin.cursorSubPush(acc.value.id), '已推送到仓库');
}
async function exportOne() {
  try {
    const r: any = await api.admin.cursorSubExport(acc.value.id);
    const ok = await copyText(r.formatted);
    if (ok) ElMessage.success('已复制账号完整信息');
    else ElMessageBox.alert(r.formatted, `账号 · ${acc.value.email}`, { confirmButtonText: '关闭' });
  } catch { /* ignore */ }
}
async function del() {
  await ElMessageBox.confirm(`删除账号 ${acc.value.email}？（仓库记录也会移除，保留订单/卡密）`, '删除', {
    type: 'warning',
  });
  try {
    await api.admin.cursorSubRemove(acc.value.id);
    ElMessage.success('已删除');
    emit('changed');
    close();
  } catch { /* ignore */ }
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

    <div v-else-if="acc" class="flex flex-col h-full">
      <!-- Header -->
      <div class="px-5 py-4 border-b border-ink-100 flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs text-ink-400 uppercase tracking-wider font-medium">订阅账号</span>
            <span class="px-2 py-0.5 rounded text-xs font-medium" :class="membership.cls">{{ membership.text }}</span>
          </div>
          <div class="text-sm text-ink-900 break-all">{{ acc.email }}</div>
          <div class="text-[11px] text-ink-400 font-mono mt-0.5">#{{ acc.id }}</div>
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
        <!-- 订阅信息 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">订阅信息</div>
          <dl class="text-sm space-y-1.5">
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500">Cursor 订阅</dt>
              <dd><span class="px-2 py-0.5 rounded text-xs font-medium" :class="membership.cls">{{ membership.text }}</span></dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500">本地状态</dt>
              <dd>
                <span class="px-2 py-0.5 rounded text-xs font-medium" :class="(statusMeta[acc.status] || {}).cls">
                  {{ (statusMeta[acc.status] || { text: acc.status }).text }}
                </span>
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500">到期</dt>
              <dd class="text-ink-700">{{ remainText }}</dd>
            </div>
            <div v-if="acc.paidAt" class="flex justify-between gap-3">
              <dt class="text-ink-500">开始</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(acc.paidAt) }}</dd>
            </div>
            <div v-if="acc.expiresAt" class="flex justify-between gap-3">
              <dt class="text-ink-500">到期时间</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(acc.expiresAt) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500">订阅周期</dt>
              <dd class="text-ink-700">{{ acc.subscriptionDays }} 天</dd>
            </div>
            <div v-if="acc.lastSyncedAt" class="flex justify-between gap-3">
              <dt class="text-ink-500">最近同步</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(acc.lastSyncedAt) }}</dd>
            </div>
          </dl>
        </div>

        <!-- 凭据 / 销售 -->
        <div>
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">凭据 / 销售</div>
          <dl class="text-sm space-y-1.5">
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500">凭据</dt>
              <dd class="text-xs">
                <span :class="acc.hasCursorToken ? 'text-emerald-600' : 'text-ink-300'">Token</span>
                <span class="mx-1 text-ink-200">·</span>
                <span :class="acc.hasPassword ? 'text-emerald-600' : 'text-ink-300'">Cursor密码</span>
                <span class="mx-1 text-ink-200">·</span>
                <span :class="acc.hasEmailPassword ? 'text-emerald-600' : 'text-ink-300'">邮箱密码</span>
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-500">销售状态</dt>
              <dd>
                <span v-if="acc.saleStatus" :class="(saleMeta[acc.saleStatus] || {}).cls" class="text-xs">
                  {{ (saleMeta[acc.saleStatus] || { text: acc.saleStatus }).text }}
                </span>
                <span v-else class="text-ink-300 text-xs">未推送仓库</span>
              </dd>
            </div>
            <div v-if="acc.soldAt" class="flex justify-between gap-3">
              <dt class="text-ink-500">售出时间</dt>
              <dd class="text-xs text-ink-700">{{ formatDateTime(acc.soldAt) }}</dd>
            </div>
            <div v-if="acc.orderNo" class="flex justify-between gap-3">
              <dt class="text-ink-500">订单号</dt>
              <dd class="text-xs font-mono text-ink-700">{{ acc.orderNo }}</dd>
            </div>
            <div v-if="acc.note" class="flex justify-between gap-3">
              <dt class="text-ink-500">备注</dt>
              <dd class="text-ink-700 text-right">{{ acc.note }}</dd>
            </div>
          </dl>
        </div>

        <!-- 订阅链接 -->
        <div v-if="acc.lastCheckoutUrl">
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">最近生成的订阅链接</div>
          <div class="flex items-center gap-2">
            <a :href="acc.lastCheckoutUrl" target="_blank" class="text-xs break-all flex-1 font-mono text-brand-600 hover:underline">{{ acc.lastCheckoutUrl }}</a>
            <button class="text-xs text-brand-700 hover:underline shrink-0" @click="copyLink">复制</button>
          </div>
          <div v-if="acc.lastCheckoutAt" class="text-[11px] text-ink-400 mt-1">生成于 {{ formatDateTime(acc.lastCheckoutAt) }}（Stripe 会话有有效期）</div>
        </div>

        <!-- 用量 -->
        <div v-if="usage">
          <div class="text-xs text-ink-400 uppercase tracking-wider font-medium mb-2">用量</div>
          <div v-if="usage.ok" class="text-sm text-ink-700 space-y-1">
            <div>会员：{{ membershipLabel(usage.membershipType).text }}</div>
            <div>已用：{{ usage.planPercentUsed != null ? usage.planPercentUsed + '%' : '-' }}（{{ usage.planUsed ?? '-' }} / {{ usage.planLimit ?? '-' }}）</div>
            <div class="text-xs text-ink-500">账期：{{ formatDateTime(usage.billingCycleStart) || '-' }} ~ {{ formatDateTime(usage.billingCycleEnd) || '-' }}</div>
          </div>
          <div v-else class="text-xs text-rose-500">{{ usage.error || '查询失败' }}</div>
        </div>
      </div>

      <!-- Footer 操作 -->
      <div class="px-5 py-3 border-t border-ink-100 bg-ink-50/30">
        <div class="grid grid-cols-2 gap-2">
          <BrandButton variant="primary" size="sm" :loading="acting === 'gen'" :disabled="!acc.hasCursorToken" @click="genLink">
            生成订阅链接
          </BrandButton>
          <BrandButton variant="secondary" size="sm" :loading="acting === 'sync'" @click="sync">同步订阅</BrandButton>
          <BrandButton variant="secondary" size="sm" :loading="acting === 'usage'" @click="fetchUsage">查用量</BrandButton>
          <BrandButton variant="secondary" size="sm" :loading="acting === 'paid'" @click="markPaid">标记已付</BrandButton>
          <BrandButton v-if="!acc.saleStatus" variant="secondary" size="sm" :loading="acting === 'push'" @click="pushWarehouse">推送仓库</BrandButton>
          <BrandButton variant="secondary" size="sm" @click="exportOne">导出账号</BrandButton>
          <BrandButton variant="secondary" size="sm" @click="emit('edit', acc)">编辑</BrandButton>
          <BrandButton variant="ghost" size="sm" class="!text-rose-600 hover:!bg-rose-50" @click="del">删除</BrandButton>
        </div>
      </div>
    </div>
  </el-drawer>
</template>
