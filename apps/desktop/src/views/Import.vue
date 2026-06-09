<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type {
  AppSettings,
  CursorInfo,
  ImportResult,
  ParsedToken,
  UsageInfo,
} from '../types';
import UsageBar from '../components/UsageBar.vue';

const props = defineProps<{
  cursorInfo: CursorInfo | null;
  /** 来自 deep link 的预填内容 */
  prefill?: string | null;
  /** 默认选项（来自设置） */
  defaults?: AppSettings;
}>();

const emit = defineEmits<{
  (e: 'imported', result: ImportResult): void;
  (e: 'reload-info'): void;
  (e: 'reload-accounts'): void;
}>();

const rawInput = ref(props.prefill || '');
const parsed = ref<ParsedToken | null>(null);
const parseError = ref('');
const resetMachineId = ref(props.defaults?.defaultResetMachineId ?? true);
const killAndRelaunch = ref(props.defaults?.defaultRelaunch ?? true);
const submitting = ref(false);
const result = ref<ImportResult | null>(null);
const errorMsg = ref('');

const usage = ref<UsageInfo | null>(null);
const usageLoading = ref(false);
const usageError = ref('');

let parseDebounce: any;
function onInput() {
  parsed.value = null;
  parseError.value = '';
  usage.value = null;
  usageError.value = '';
  if (!rawInput.value.trim()) return;
  clearTimeout(parseDebounce);
  parseDebounce = setTimeout(async () => {
    try {
      parsed.value = await api.parseToken(rawInput.value);
      queryUsageOfPasted();
    } catch (e: any) {
      parseError.value = String(e?.message || e);
    }
  }, 250);
}

watch(
  () => props.prefill,
  (val) => {
    if (val && val !== rawInput.value) {
      rawInput.value = val;
      onInput();
    }
  },
);

watch(
  () => props.defaults,
  (val) => {
    if (val) {
      resetMachineId.value = val.defaultResetMachineId;
      killAndRelaunch.value = val.defaultRelaunch;
    }
  },
);

onMounted(() => {
  if (rawInput.value) onInput();
});

async function queryUsageOfPasted() {
  if (!parsed.value?.accessToken) return;
  usageLoading.value = true;
  usageError.value = '';
  try {
    usage.value = await api.queryUsage(parsed.value.accessToken);
  } catch (e: any) {
    usage.value = null;
    usageError.value = String(e?.message || e);
  } finally {
    usageLoading.value = false;
  }
}

const canSubmit = computed(
  () => !!parsed.value && !!props.cursorInfo?.installed && !submitting.value,
);

async function doImport() {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMsg.value = '';
  result.value = null;
  try {
    const r = await api.importAccount({
      raw: rawInput.value,
      resetMachineId: resetMachineId.value,
      killAndRelaunch: killAndRelaunch.value,
    });
    result.value = r;
    emit('imported', r);
    emit('reload-info');
    emit('reload-accounts');
  } catch (e: any) {
    errorMsg.value = String(e?.message || e);
  } finally {
    submitting.value = false;
  }
}

function maskToken(t: string | null | undefined) {
  if (!t) return '';
  if (t.length <= 16) return t;
  return `${t.slice(0, 8)}…${t.slice(-8)} · ${t.length} chars`;
}

function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}

function fmtPercent(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(1)}%`;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { hour12: false });
}

const usageProgress = computed(() => {
  const u = usage.value;
  if (!u) return null;
  if (u.totalPercent !== null) return u.totalPercent;
  if (u.limitUsd && u.includedSpendUsd !== null) {
    return u.limitUsd > 0 ? (u.includedSpendUsd / u.limitUsd) * 100 : 0;
  }
  return null;
});

const hasAnyUsageField = computed(() => {
  const u = usage.value;
  if (!u) return false;
  return (
    u.plan !== null ||
    u.totalSpendUsd !== null ||
    u.limitUsd !== null ||
    u.autoPercent !== null ||
    u.apiPercent !== null ||
    u.requestsUsed !== null
  );
});
</script>

<template>
  <div class="space-y-4">
    <!-- Cursor 状态 -->
    <section class="card p-4">
      <div class="flex items-center justify-between mb-2">
        <div class="text-sm font-medium text-ink-100">Cursor 状态</div>
        <span
          v-if="cursorInfo?.running"
          class="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30"
          title="导入前会自动关闭 Cursor"
        >运行中</span>
        <span
          v-else-if="cursorInfo?.installed"
          class="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
        >已安装·未运行</span>
        <span
          v-else
          class="text-[11px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30"
        >未检测到</span>
      </div>

      <div v-if="cursorInfo?.installed" class="text-xs text-ink-400 space-y-1">
        <div class="flex items-baseline gap-2">
          <span class="text-ink-500 shrink-0">当前账号</span>
          <span class="font-mono text-ink-200 truncate">
            {{ cursorInfo.currentEmail || '（未登录或未识别）' }}
          </span>
        </div>
        <div class="flex items-baseline gap-2">
          <span class="text-ink-500 shrink-0">设备 ID</span>
          <span class="font-mono text-ink-300 text-[11px] truncate">
            {{ cursorInfo.currentDeviceId || '（无）' }}
          </span>
        </div>
      </div>
      <div v-else class="text-xs text-ink-400 mt-1">
        没有在常见路径下找到 Cursor 配置目录，请先安装并打开过一次 Cursor。
      </div>
    </section>

    <!-- 粘贴 token -->
    <section class="card p-4">
      <div class="flex items-center justify-between mb-2">
        <div class="text-sm font-medium text-ink-100">粘贴账号信息</div>
        <div class="text-[11px] text-ink-500">
          支持 token / email----token / email----emailpwd----cursorpwd----token
        </div>
      </div>
      <textarea
        v-model="rawInput"
        rows="5"
        placeholder="粘贴你拿到的卡密内容，例如：&#10;abc@gmail.com----emailpwd----cursorpwd----eyJhbGciOi..."
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        class="w-full px-3 py-2 bg-ink-900/80 border border-ink-700 rounded-lg text-ink-100 font-mono text-xs leading-relaxed focus:outline-none focus:border-brand-500 placeholder:text-ink-600"
        @input="onInput"
      />

      <div v-if="parsed" class="mt-3 rounded-lg bg-ink-900/80 border border-emerald-500/30 p-3 text-xs space-y-1">
        <div class="flex items-center gap-2 text-emerald-300 font-medium">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          已识别
        </div>
        <div class="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 text-ink-300">
          <span class="text-ink-500">email</span>
          <span class="font-mono truncate">{{ parsed.email || '—' }}</span>
          <span class="text-ink-500">token</span>
          <span class="font-mono text-ink-200">{{ maskToken(parsed.accessToken) }}</span>
        </div>
      </div>
      <div v-else-if="parseError" class="mt-3 rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-200">
        {{ parseError }}
      </div>

      <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label class="flex items-start gap-2 cursor-pointer bg-ink-900/40 border border-ink-700 rounded-md px-3 py-2 hover:border-ink-500">
          <input v-model="resetMachineId" type="checkbox" class="mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm text-ink-100">重置机器码</div>
            <div class="text-[11px] text-ink-500 mt-0.5">避免新账号被旧设备数据污染</div>
          </div>
        </label>
        <label class="flex items-start gap-2 cursor-pointer bg-ink-900/40 border border-ink-700 rounded-md px-3 py-2 hover:border-ink-500">
          <input v-model="killAndRelaunch" type="checkbox" class="mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm text-ink-100">写入后自动重启 Cursor</div>
            <div class="text-[11px] text-ink-500 mt-0.5">关掉再打开，新账号立即生效</div>
          </div>
        </label>
      </div>

      <div class="mt-4 flex items-center gap-2">
        <button class="btn-primary" :disabled="!canSubmit" @click="doImport">
          {{ submitting ? '正在写入…' : '导入并切换账号' }}
        </button>
        <button
          v-if="parsed"
          class="btn-ghost text-xs"
          :disabled="usageLoading"
          @click="queryUsageOfPasted"
        >
          {{ usageLoading ? '查询中…' : '刷新用量' }}
        </button>
        <span v-if="cursorInfo?.running" class="text-[11px] text-amber-300 ml-auto">
          ⚠️ 检测到 Cursor 在运行，会先自动关闭
        </span>
      </div>
    </section>

    <!-- 用量 -->
    <section v-if="usage || usageLoading || usageError" class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-medium text-ink-100 flex items-center gap-2">
          账号用量
          <span v-if="usageLoading" class="text-[11px] text-ink-400">查询中…</span>
          <span v-else-if="usage?.plan" class="text-[11px] px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-300 border border-brand-500/30">
            {{ usage.plan }}
          </span>
        </div>
      </div>

      <div v-if="usageError && !usage" class="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-200">
        {{ usageError }}
      </div>

      <div v-else-if="usage && hasAnyUsageField" class="space-y-3">
        <UsageBar
          v-if="usageProgress !== null"
          :percent="usageProgress"
          :left-label="'本周期已用'"
          :right-label="usage.includedSpendUsd !== null && usage.limitUsd !== null
            ? `${fmtMoney(usage.includedSpendUsd)} / ${fmtMoney(usage.limitUsd)}`
            : fmtPercent(usageProgress)"
        />
        <div v-if="usageProgress !== null" class="text-[11px] text-ink-500 flex justify-between -mt-1">
          <span>剩余 {{ fmtMoney(usage.remainingUsd) }}</span>
          <span>{{ fmtPercent(usageProgress) }}</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-2">
            <div class="text-[11px] text-ink-500">Auto</div>
            <div class="text-sm text-ink-100 font-medium mt-0.5">{{ fmtPercent(usage.autoPercent) }}</div>
          </div>
          <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-2">
            <div class="text-[11px] text-ink-500">API</div>
            <div class="text-sm text-ink-100 font-medium mt-0.5">{{ fmtPercent(usage.apiPercent) }}</div>
          </div>
          <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-2">
            <div class="text-[11px] text-ink-500">总花费</div>
            <div class="text-sm text-ink-100 font-medium mt-0.5">{{ fmtMoney(usage.totalSpendUsd) }}</div>
          </div>
          <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-2">
            <div class="text-[11px] text-ink-500">赠送额度</div>
            <div class="text-sm text-ink-100 font-medium mt-0.5">{{ fmtMoney(usage.bonusSpendUsd) }}</div>
          </div>
        </div>

        <div
          v-if="usage.periodStart || usage.periodEnd"
          class="text-[11px] text-ink-500"
        >
          周期：{{ fmtDate(usage.periodStart) }} → {{ fmtDate(usage.periodEnd) }}
        </div>
      </div>

      <div v-else-if="usage && !hasAnyUsageField" class="text-xs text-ink-400">
        接口返回了响应，但没识别出可展示的字段。可能是免费账号或新版接口字段变了。
      </div>
    </section>

    <section v-if="result" class="card p-4 border-emerald-500/40">
      <div class="text-sm font-medium text-emerald-300 mb-2">导入成功</div>
      <div class="text-xs text-ink-300 space-y-1">
        <div>账号：<span class="font-mono text-ink-100">{{ result.email || '（未识别 email）' }}</span></div>
        <div v-if="result.resetMachineId">机器码已重置 · 新设备 ID <span class="font-mono text-ink-200 text-[11px]">{{ result.newDeviceId }}</span></div>
        <div v-if="result.relaunched">已重新拉起 Cursor</div>
        <div class="text-ink-500">原始数据已备份到：<span class="font-mono text-[11px]">{{ result.backupDir }}</span></div>
      </div>
    </section>

    <section v-if="errorMsg" class="card p-4 border-rose-500/40">
      <div class="text-sm font-medium text-rose-300 mb-1">操作失败</div>
      <div class="text-xs text-rose-200 whitespace-pre-wrap break-all">{{ errorMsg }}</div>
    </section>
  </div>
</template>
