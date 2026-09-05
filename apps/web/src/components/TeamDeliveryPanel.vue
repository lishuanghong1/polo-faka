<script setup lang="ts">
/**
 * 订单页：Team 售号渠道的交付面板。
 * 一个订单可能有多条成交（qty>1），每条按交付形态展示：
 *   - account：邮箱 / 密码 / Token 逐项复制
 *   - login：只有邮箱，需用户粘贴 Cursor 的 loginDeepControl 链接完成授权
 *   - card：卡密 + 说明
 *   - extract：XB- 提取码，去上游 /redeem 提取
 *   - making：开通中，可手动检查
 */
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api, { type CursorSellSale } from '@/api';
import BrandButton from '@/components/BrandButton.vue';
import { copyText, formatDateTime } from '@/utils/format';

const props = defineProps<{
  orderNo: string;
  contact?: string;
  sales: CursorSellSale[];
  orderStatus: string;
}>();
const emit = defineEmits<{ (e: 'updated', sale: CursorSellSale): void }>();

const busy = ref<Record<number, string>>({});
const loginUrl = ref<Record<number, string>>({});
const tutorial = ref<Record<number, string>>({});
const tutorialOpen = ref<Record<number, boolean>>({});
const usage = ref<Record<number, Record<string, unknown>>>({});
const revealed = ref<Record<number, boolean>>({});

const kindMeta: Record<string, { text: string; cls: string }> = {
  account: { text: '账号凭据', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  login: { text: '授权登录账号', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  card: { text: '卡密', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  extract: { text: '提取卡', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const fieldLabels: Record<string, string> = {
  email: '邮箱',
  password: '密码',
  token: 'Token',
  rawLine: '原始行',
  card: '卡密',
  cardNote: '说明',
};

const anyMaking = computed(() => props.sales.some((s) => s.making));

function credentialRows(s: CursorSellSale) {
  const order = ['email', 'password', 'token', 'rawLine', 'card', 'cardNote'];
  return order
    .filter((k) => s.credentials?.[k])
    .map((k) => ({ key: k, label: fieldLabels[k] || k, value: s.credentials[k], secret: k === 'token' || k === 'password' }));
}

function copyAllOf(s: CursorSellSale) {
  const text = credentialRows(s).map((r) => `${r.label}: ${r.value}`).join('\n');
  copy(text, '账号信息已复制');
}

async function copy(text: string, label = '已复制') {
  if (!text) return;
  const ok = await copyText(text);
  if (ok) ElMessage.success(label);
  else ElMessage.error('复制失败，请手动选中复制');
}

function setBusy(id: number, v: string) {
  busy.value = { ...busy.value, [id]: v };
}

async function refresh(s: CursorSellSale) {
  setBusy(s.id, 'refresh');
  try {
    const r = await api.cursorSell.refresh(s.id, { orderNo: props.orderNo, contact: props.contact });
    emit('updated', r);
    ElMessage[r.making ? 'info' : 'success'](r.making ? '账号仍在开通中，请稍后再试' : '已更新');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '刷新失败');
  } finally {
    setBusy(s.id, '');
  }
}

async function loadTutorial(s: CursorSellSale) {
  if (tutorial.value[s.id]) {
    tutorialOpen.value = { ...tutorialOpen.value, [s.id]: !tutorialOpen.value[s.id] };
    return;
  }
  setBusy(s.id, 'tutorial');
  try {
    const r: any = await api.cursorSell.loginTutorial(s.id, { orderNo: props.orderNo, contact: props.contact });
    const text =
      typeof r === 'string'
        ? r
        : r?.content || r?.tutorial || r?.text || r?.markdown || r?.html || JSON.stringify(r, null, 2);
    tutorial.value = { ...tutorial.value, [s.id]: String(text) };
    tutorialOpen.value = { ...tutorialOpen.value, [s.id]: true };
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '教程加载失败');
  } finally {
    setBusy(s.id, '');
  }
}

async function approve(s: CursorSellSale) {
  const url = (loginUrl.value[s.id] || '').trim();
  if (!url) return ElMessage.warning('请先粘贴登录链接');
  if (!/loginDeepControl/i.test(url)) return ElMessage.warning('链接不对：需要是 cursor.com/loginDeepControl?… 开头的完整地址');
  setBusy(s.id, 'approve');
  try {
    const r = await api.cursorSell.loginApprove(s.id, { orderNo: props.orderNo, contact: props.contact, loginUrl: url });
    if (r.approved) {
      ElMessage.success('授权成功，回到 Cursor 客户端即已登录');
      loginUrl.value = { ...loginUrl.value, [s.id]: '' };
      emit('updated', { ...s, loginApprovedAt: new Date().toISOString() });
    } else {
      ElMessage.warning('渠道未确认授权，请重新在 Cursor 点登录后再试');
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '授权失败');
  } finally {
    setBusy(s.id, '');
  }
}

async function loadUsage(s: CursorSellSale) {
  setBusy(s.id, 'usage');
  try {
    const r = await api.cursorSell.usage(s.id, { orderNo: props.orderNo, contact: props.contact });
    usage.value = { ...usage.value, [s.id]: r };
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '额度查询失败');
  } finally {
    setBusy(s.id, '');
  }
}

function usageRows(u: Record<string, unknown>) {
  return Object.entries(u || {})
    .filter(([, v]) => v !== null && typeof v !== 'object')
    .map(([k, v]) => ({ k, v: String(v) }));
}

function warrantyState(s: CursorSellSale) {
  if (!s.warrantyUntil) return null;
  const left = new Date(s.warrantyUntil).getTime() - Date.now();
  if (left <= 0) return { text: `质保已于 ${formatDateTime(s.warrantyUntil)} 到期`, cls: 'text-ink-400' };
  const hours = Math.floor(left / 3600000);
  return {
    text: `质保至 ${formatDateTime(s.warrantyUntil)}（剩 ${hours >= 24 ? `${Math.floor(hours / 24)} 天` : `${hours} 小时`}）`,
    cls: hours < 12 ? 'text-amber-700' : 'text-ink-500',
  };
}
</script>

<template>
  <div class="card p-5 md:p-6 mb-4">
    <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
      <h3 class="text-sm font-semibold text-ink-900 flex items-center gap-2">
        <span class="w-1 h-4 bg-brand-600 rounded-full" />
        账号交付
        <span class="text-xs font-normal text-ink-400">共 {{ sales.length }} 个</span>
      </h3>
      <span v-if="anyMaking" class="text-xs text-sky-700 flex items-center gap-1.5">
        <span class="w-3 h-3 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
        部分账号正在开通，页面会自动刷新
      </span>
    </div>

    <ul class="space-y-3">
      <li v-for="(s, i) in sales" :key="s.id" class="p-4 bg-ink-50/70 rounded-xl space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap text-xs">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-ink-500">账号 #{{ i + 1 }}</span>
            <span class="px-2 py-0.5 rounded-md border" :class="(kindMeta[s.kind] || kindMeta.account).cls">
              {{ (kindMeta[s.kind] || kindMeta.account).text }}
            </span>
            <span v-if="s.tier" class="px-2 py-0.5 rounded-md bg-white border border-ink-200 text-ink-600 uppercase">{{ s.tier }}</span>
            <span v-if="s.making" class="px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-700">开通中</span>
            <span v-else-if="s.kind === 'login'" class="px-2 py-0.5 rounded-md border" :class="s.loginApprovedAt ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'">
              {{ s.loginApprovedAt ? '已授权登录' : '待授权登录' }}
            </span>
          </div>
          <span v-if="warrantyState(s)" :class="warrantyState(s)!.cls">{{ warrantyState(s)!.text }}</span>
        </div>

        <!-- 开通中 -->
        <div v-if="s.making" class="rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-900 flex items-center justify-between gap-3 flex-wrap">
          <span>该账号为现做 Team，渠道正在开通，通常几分钟内完成；就绪后凭据会自动显示在这里。</span>
          <BrandButton variant="secondary" size="sm" :loading="busy[s.id] === 'refresh'" @click="refresh(s)">立即检查</BrandButton>
        </div>

        <template v-else>
          <!-- 凭据 -->
          <div v-if="credentialRows(s).length" class="space-y-2">
            <div v-for="row in credentialRows(s)" :key="row.key" class="flex items-start gap-2.5">
              <div class="text-xs text-ink-500 w-14 shrink-0 mt-1">{{ row.label }}</div>
              <code class="text-xs text-ink-800 break-all flex-1 font-mono leading-relaxed">
                {{ row.secret && !revealed[s.id] ? row.value.slice(0, 12) + '…' + row.value.slice(-6) : row.value }}
              </code>
              <button
                v-if="row.secret"
                class="text-xs text-ink-400 hover:text-ink-700 px-1.5 py-1 shrink-0"
                @click="revealed = { ...revealed, [s.id]: !revealed[s.id] }"
              >{{ revealed[s.id] ? '隐藏' : '显示' }}</button>
              <button
                class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded shrink-0 transition"
                @click="copy(row.value, `${row.label}已复制`)"
              >复制</button>
            </div>
            <div class="pt-1 flex items-center gap-2 flex-wrap">
              <button class="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded transition" @click="copyAllOf(s)">复制该账号全部信息</button>
              <button
                v-if="s.saleId != null"
                class="text-xs text-ink-500 hover:text-ink-800 px-2 py-1 rounded transition"
                :disabled="busy[s.id] === 'usage'"
                @click="loadUsage(s)"
              >{{ busy[s.id] === 'usage' ? '查询中…' : '查看额度 / 用量' }}</button>
            </div>
          </div>

          <!-- 提取卡说明 -->
          <div v-if="s.kind === 'extract'" class="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 space-y-1.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span>提取码：</span>
              <code class="font-mono text-sm text-amber-950 break-all">{{ s.credentials.extractCode }}</code>
              <button class="text-brand-700 hover:underline" @click="copy(s.credentials.extractCode, '提取码已复制')">复制</button>
              <span v-if="s.credentials.totalCredits">· 可提取 {{ s.credentials.remainingCredits }}/{{ s.credentials.totalCredits }} 次</span>
            </div>
            <p>这是一张「次数票」：请打开渠道提取页 <a class="underline" href="https://cursor.zhangyuwang.cn/redeem" target="_blank" rel="noopener">cursor.zhangyuwang.cn/redeem</a>，输入提取码即可领取账号；每次提取消耗 1 次。</p>
          </div>

          <!-- 授权登录 -->
          <div v-if="s.kind === 'login'" class="rounded-lg border border-sky-200 bg-white p-3.5 space-y-2.5">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="text-sm font-medium text-sky-900">授权登录到你的 Cursor</div>
              <button class="text-xs text-brand-600 hover:underline" :disabled="busy[s.id] === 'tutorial'" @click="loadTutorial(s)">
                {{ busy[s.id] === 'tutorial' ? '加载中…' : tutorialOpen[s.id] ? '收起教程' : '查看图文教程' }}
              </button>
            </div>
            <ol class="text-xs text-ink-600 list-decimal pl-5 space-y-1 leading-relaxed">
              <li>打开 Cursor 客户端，点右上角「Sign in」，浏览器会打开一个登录页。</li>
              <li>复制浏览器地址栏里 <code class="font-mono bg-ink-50 px-1 rounded">cursor.com/loginDeepControl?…</code> 开头的<b>完整链接</b>。</li>
              <li>粘贴到下面并点「确认授权」，回到 Cursor 即完成登录（账号邮箱：<code class="font-mono">{{ s.credentials.email || s.email }}</code>）。</li>
            </ol>
            <div v-if="tutorialOpen[s.id] && tutorial[s.id]" class="rounded-lg bg-ink-50 p-3 text-xs text-ink-700 whitespace-pre-wrap break-words max-h-72 overflow-auto leading-relaxed">{{ tutorial[s.id] }}</div>
            <div class="flex gap-2 flex-col sm:flex-row">
              <input
                v-model="loginUrl[s.id]"
                placeholder="https://cursor.com/loginDeepControl?challenge=…&uuid=…&mode=login"
                class="flex-1 px-3 py-2 border border-ink-200 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-500"
                @keydown.enter="approve(s)"
              />
              <BrandButton variant="primary" size="md" :loading="busy[s.id] === 'approve'" @click="approve(s)">确认授权</BrandButton>
            </div>
            <p class="text-[11px] text-ink-400">每次重新登录 Cursor 都需要再做一次授权；链接只用于本次登录确认，不会保存。</p>
          </div>

          <!-- 额度 -->
          <div v-if="usage[s.id]" class="rounded-lg bg-white border border-ink-100 p-3">
            <div class="text-xs font-medium text-ink-700 mb-1.5">额度 / 用量</div>
            <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div v-for="row in usageRows(usage[s.id])" :key="row.k" class="flex justify-between gap-3">
                <dt class="text-ink-500 font-mono">{{ row.k }}</dt>
                <dd class="text-ink-800 text-right break-all">{{ row.v }}</dd>
              </div>
            </dl>
          </div>

          <div v-if="s.saleId != null && s.kind !== 'extract'" class="flex justify-end">
            <button class="text-[11px] text-ink-400 hover:text-ink-700" :disabled="busy[s.id] === 'refresh'" @click="refresh(s)">
              {{ busy[s.id] === 'refresh' ? '刷新中…' : '凭据不对？重新拉取' }}
            </button>
          </div>
        </template>
      </li>
    </ul>
  </div>
</template>
