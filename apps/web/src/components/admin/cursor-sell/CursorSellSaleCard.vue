<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { type CursorSellSale } from '@/api';
import BrandButton from '@/components/BrandButton.vue';

const props = defineProps<{
  sale: CursorSellSale;
  /** 本站规格列表（入卡密池用） */
  skuOptions: Array<{ id: number; label: string }>;
}>();
const emit = defineEmits<{ (e: 'changed', sale: CursorSellSale): void }>();

const busy = ref<'' | 'refresh' | 'usage' | 'push' | 'approve'>('');
const usage = ref<Record<string, unknown> | null>((props.sale.usage as any) || null);
const loginUrl = ref('');
const pushDest = ref<'CARD_POOL' | 'WAREHOUSE'>('CARD_POOL');
const pushSkuId = ref<number | null>(props.skuOptions[0]?.id ?? null);
const showToken = ref(false);

const kindLabel: Record<string, { text: string; cls: string }> = {
  account: { text: '凭据直发', cls: 'bg-emerald-50 text-emerald-700' },
  login: { text: '授权登录', cls: 'bg-sky-50 text-sky-700' },
  card: { text: '池卡密', cls: 'bg-violet-50 text-violet-700' },
  extract: { text: '次数票', cls: 'bg-amber-50 text-amber-700' },
};

const fieldLabels: Record<string, string> = {
  email: '邮箱',
  password: '密码',
  token: 'Token',
  rawLine: '原始行',
  card: '卡密',
  cardNote: '卡密说明',
  extractCode: '提取码',
  masked: '脱敏码',
  totalCredits: '总次数',
  remainingCredits: '剩余次数',
};

const credentialRows = computed(() =>
  Object.entries(props.sale.credentials || {}).map(([k, v]) => ({
    key: k,
    label: fieldLabels[k] || k,
    value: v,
    secret: k === 'token' || k === 'password',
  })),
);

function fmt(t: string | null | undefined) {
  return t ? new Date(t).toLocaleString() : '—';
}

async function copy(text: string, label = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(label);
  } catch {
    ElMessage.error('复制失败');
  }
}

async function refresh() {
  busy.value = 'refresh';
  try {
    const r = await api.admin.cursorSell.refreshSale(props.sale.id);
    emit('changed', r);
    ElMessage.success(r.making ? '仍在开通中' : '凭据已刷新');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '刷新失败');
  } finally {
    busy.value = '';
  }
}

async function loadUsage() {
  busy.value = 'usage';
  try {
    usage.value = await api.admin.cursorSell.saleUsage(props.sale.id);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '查询失败');
  } finally {
    busy.value = '';
  }
}

async function approve() {
  if (!loginUrl.value.trim()) return ElMessage.warning('请粘贴 loginDeepControl 链接');
  busy.value = 'approve';
  try {
    const r = await api.admin.cursorSell.saleLoginApprove(props.sale.id, loginUrl.value.trim());
    if (r.approved) {
      ElMessage.success('授权登录成功');
      loginUrl.value = '';
      emit('changed', { ...props.sale, loginApprovedAt: new Date().toISOString() });
    } else {
      ElMessage.warning('上游未确认授权');
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '授权失败');
  } finally {
    busy.value = '';
  }
}

async function push() {
  if (pushDest.value === 'CARD_POOL' && !pushSkuId.value) return ElMessage.warning('请选择入库的本站规格');
  await ElMessageBox.confirm(
    pushDest.value === 'CARD_POOL' ? '确认把该账号写入所选规格的卡密池（可售状态）？' : '确认把该账号推入仓库（待分配）？',
    '入库确认',
    { type: 'warning' },
  );
  busy.value = 'push';
  try {
    await api.admin.cursorSell.pushSale(props.sale.id, {
      destination: pushDest.value,
      skuId: pushDest.value === 'CARD_POOL' ? pushSkuId.value! : undefined,
    });
    ElMessage.success('已入库');
    emit('changed', await api.admin.cursorSell.sale(props.sale.id));
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '入库失败');
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <div class="rounded-xl border border-ink-100 bg-white p-4 space-y-3">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap text-xs">
        <span class="px-2 py-0.5 rounded-md" :class="(kindLabel[sale.kind] || kindLabel.account).cls">
          {{ (kindLabel[sale.kind] || kindLabel.account).text }}
        </span>
        <span v-if="sale.making" class="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700">开通中</span>
        <span v-if="sale.kind === 'login'" class="px-2 py-0.5 rounded-md" :class="sale.loginApprovedAt ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'">
          {{ sale.loginApprovedAt ? `已授权 ${fmt(sale.loginApprovedAt)}` : '待授权登录' }}
        </span>
        <span v-if="sale.tier" class="text-ink-500 uppercase">{{ sale.tier }}</span>
        <span class="text-ink-400 font-mono">渠道单 #{{ sale.saleId ?? sale.extractCardId ?? '-' }}</span>
        <span v-if="sale.cardKeyId" class="text-ink-400 font-mono">卡密 #{{ sale.cardKeyId }}</span>
        <span v-else class="text-amber-600">未入库</span>
      </div>
      <div class="flex items-center gap-2">
        <BrandButton v-if="sale.saleId != null" variant="secondary" size="sm" :loading="busy === 'refresh'" @click="refresh">
          {{ sale.making ? '检查开通状态' : '重取凭据' }}
        </BrandButton>
        <BrandButton v-if="sale.saleId != null && !sale.making" variant="ghost" size="sm" :loading="busy === 'usage'" @click="loadUsage">
          查额度
        </BrandButton>
      </div>
    </div>

    <div v-if="credentialRows.length" class="space-y-1.5 text-sm">
      <div v-for="row in credentialRows" :key="row.key" class="flex items-start gap-2">
        <span class="text-xs text-ink-500 w-16 shrink-0 mt-0.5">{{ row.label }}</span>
        <code class="font-mono text-xs text-ink-800 break-all flex-1 leading-relaxed">
          {{ row.secret && !showToken ? row.value.slice(0, 10) + '…' + row.value.slice(-4) : row.value }}
        </code>
        <button v-if="row.secret" class="text-xs text-ink-400 hover:text-ink-700 shrink-0" @click="showToken = !showToken">
          {{ showToken ? '隐藏' : '显示' }}
        </button>
        <button class="text-xs text-brand-600 hover:underline shrink-0" @click="copy(row.value, `${row.label}已复制`)">复制</button>
      </div>
    </div>
    <div v-else class="text-xs text-ink-400">
      {{ sale.making ? '账号开通中，就绪后自动回填凭据（每分钟轮询）' : '暂无凭据字段' }}
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-ink-500">
      <div>成交：{{ fmt(sale.soldAt) }}</div>
      <div>质保至：{{ fmt(sale.warrantyUntil) }}</div>
      <div>订单：<span class="font-mono">{{ sale.orderNo || '—' }}</span></div>
      <div>额度查询：{{ fmt(sale.usageAt) }}</div>
    </div>

    <div v-if="usage" class="rounded-lg bg-ink-50 p-3">
      <div class="text-xs font-medium text-ink-700 mb-1">额度 / 用量</div>
      <pre class="text-[11px] text-ink-700 whitespace-pre-wrap break-all font-mono">{{ JSON.stringify(usage, null, 2) }}</pre>
    </div>

    <!-- 授权登录（代用户操作） -->
    <div v-if="sale.kind === 'login' && !sale.making" class="rounded-lg border border-sky-100 bg-sky-50/50 p-3 space-y-2">
      <div class="text-xs font-medium text-sky-900">代用户确认授权登录</div>
      <div class="flex gap-2">
        <input
          v-model="loginUrl"
          placeholder="https://cursor.com/loginDeepControl?challenge=…&uuid=…&mode=login"
          class="flex-1 px-3 py-1.5 border border-ink-200 rounded-lg text-xs font-mono"
        />
        <BrandButton variant="primary" size="sm" :loading="busy === 'approve'" @click="approve">确认登录</BrandButton>
      </div>
      <p class="text-[11px] text-sky-800">用户在 Cursor 客户端点登录后，把浏览器地址栏整段链接发给你，粘贴到这里即可。</p>
    </div>

    <!-- 未入库的成交：推到卡密池 / 仓库 -->
    <div v-if="!sale.cardKeyId && !sale.making" class="rounded-lg border border-ink-100 bg-ink-50/60 p-3 flex items-center gap-2 flex-wrap">
      <span class="text-xs text-ink-600">入库到</span>
      <select v-model="pushDest" class="px-2 py-1 border border-ink-200 rounded-md text-xs bg-white">
        <option value="CARD_POOL">卡密池（可直接售卖）</option>
        <option value="WAREHOUSE">仓库（待分配）</option>
      </select>
      <select v-if="pushDest === 'CARD_POOL'" v-model="pushSkuId" class="px-2 py-1 border border-ink-200 rounded-md text-xs bg-white max-w-[260px]">
        <option v-for="s in skuOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
      <BrandButton variant="subtle" size="sm" :loading="busy === 'push'" @click="push">入库</BrandButton>
    </div>
  </div>
</template>
