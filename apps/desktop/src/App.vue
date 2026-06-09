<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from './api';
import type { CursorInfo, ParsedToken, ImportResult, UsageInfo } from './types';

const info = ref<CursorInfo | null>(null);
const detecting = ref(false);
const rawInput = ref('');
const parsed = ref<ParsedToken | null>(null);
const parseError = ref<string>('');
const resetMachineId = ref(true);
const killAndRelaunch = ref(true);
const submitting = ref(false);
const result = ref<ImportResult | null>(null);
const errorMsg = ref('');

// 用量
const usage = ref<UsageInfo | null>(null);
const usageLoading = ref(false);
const usageError = ref('');

async function detect() {
  detecting.value = true;
  errorMsg.value = '';
  try {
    info.value = await api.detectCursor();
  } catch (e: any) {
    errorMsg.value = String(e?.message || e);
  } finally {
    detecting.value = false;
  }
}

onMounted(detect);

// 即时解析（debounce 250ms） + 解析成功后自动查用量
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
      // 解析成功后异步查用量，失败不影响主流程
      queryUsageOfPasted();
    } catch (e: any) {
      parseError.value = String(e?.message || e);
    }
  }, 250);
}

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
  () => !!parsed.value && !!info.value?.installed && !submitting.value,
);

async function doImport() {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMsg.value = '';
  result.value = null;
  try {
    result.value = await api.importAccount({
      raw: rawInput.value,
      resetMachineId: resetMachineId.value,
      killAndRelaunch: killAndRelaunch.value,
    });
    info.value = await api.detectCursor();
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
  // 优先用 totalPercent，没有就用 includedSpend / limit 算
  if (u.totalPercent !== null) return Math.min(100, Math.max(0, u.totalPercent));
  if (u.limitUsd && u.includedSpendUsd !== null) {
    const limit = u.limitUsd;
    return limit > 0 ? Math.min(100, (u.includedSpendUsd! / limit) * 100) : 0;
  }
  return null;
});

const progressColor = computed(() => {
  const p = usageProgress.value;
  if (p === null) return 'bg-ink-600';
  if (p < 60) return 'bg-emerald-500';
  if (p < 85) return 'bg-amber-500';
  return 'bg-rose-500';
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
  <main class="min-h-screen px-6 py-5 max-w-3xl mx-auto">
    <!-- 顶栏 -->
    <header class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-2">
        <div
          class="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold"
        >
          P
        </div>
        <div>
          <div class="text-base font-semibold text-ink-100 leading-tight">
            Polo 账号工具
          </div>
          <div class="text-[11px] text-ink-500">
            一键导入 Cursor 账号 · 查用量 · 本地处理，不上传任何数据
          </div>
        </div>
      </div>
      <button
        class="btn-ghost text-xs"
        :disabled="detecting"
        @click="detect"
      >
        {{ detecting ? '检测中…' : '重新检测' }}
      </button>
    </header>

    <!-- Cursor 状态 -->
    <section class="card p-4 mb-4">
      <div class="flex items-center justify-between mb-2">
        <div class="text-sm font-medium text-ink-100">Cursor 状态</div>
        <span
          v-if="info?.running"
          class="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30"
          title="导入前会自动关闭 Cursor"
        >
          运行中
        </span>
        <span
          v-else-if="info?.installed"
          class="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
        >
          已安装·未运行
        </span>
        <span
          v-else
          class="text-[11px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30"
        >
          未检测到
        </span>
      </div>

      <div v-if="info?.installed" class="text-xs text-ink-400 space-y-1">
        <div class="flex items-baseline gap-2">
          <span class="text-ink-500 shrink-0">当前账号</span>
          <span class="font-mono text-ink-200 truncate">
            {{ info.currentEmail || '（未登录或未识别）' }}
          </span>
        </div>
        <div class="flex items-baseline gap-2">
          <span class="text-ink-500 shrink-0">设备 ID</span>
          <span class="font-mono text-ink-300 text-[11px] truncate">
            {{ info.currentDeviceId || '（无）' }}
          </span>
        </div>
        <div class="flex items-baseline gap-2">
          <span class="text-ink-500 shrink-0">配置目录</span>
          <span class="font-mono text-ink-400 text-[11px] truncate">
            {{ info.configDir }}
          </span>
        </div>
      </div>
      <div v-else class="text-xs text-ink-400 mt-1">
        没有在常见路径下找到 Cursor 配置目录。请先安装并打开过一次 Cursor。
      </div>
    </section>

    <!-- 粘贴 token -->
    <section class="card p-4 mb-4">
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

      <!-- 解析结果反馈 -->
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
          <template v-if="parsed.refreshToken && parsed.refreshToken !== parsed.accessToken">
            <span class="text-ink-500">refresh</span>
            <span class="font-mono text-ink-200">{{ maskToken(parsed.refreshToken) }}</span>
          </template>
        </div>
      </div>
      <div v-else-if="parseError" class="mt-3 rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-200">
        {{ parseError }}
      </div>

      <!-- 选项 -->
      <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label class="flex items-start gap-2 cursor-pointer bg-ink-900/40 border border-ink-700 rounded-md px-3 py-2 hover:border-ink-500">
          <input v-model="resetMachineId" type="checkbox" class="mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm text-ink-100">重置机器码</div>
            <div class="text-[11px] text-ink-500 mt-0.5">
              生成新的设备指纹，避免新账号被旧设备数据污染
            </div>
          </div>
        </label>
        <label class="flex items-start gap-2 cursor-pointer bg-ink-900/40 border border-ink-700 rounded-md px-3 py-2 hover:border-ink-500">
          <input v-model="killAndRelaunch" type="checkbox" class="mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm text-ink-100">写入后自动重启 Cursor</div>
            <div class="text-[11px] text-ink-500 mt-0.5">
              关掉再打开，让新账号立即生效
            </div>
          </div>
        </label>
      </div>

      <!-- 操作按钮 -->
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
        <span v-if="info?.running" class="text-[11px] text-amber-300 ml-auto">
          ⚠️ 检测到 Cursor 在运行，会先自动关闭
        </span>
      </div>
    </section>

    <!-- 用量信息 -->
    <section
      v-if="usage || usageLoading || usageError"
      class="card p-4 mb-4"
    >
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-medium text-ink-100 flex items-center gap-2">
          账号用量
          <span v-if="usageLoading" class="text-[11px] text-ink-400">查询中…</span>
          <span
            v-else-if="usage?.plan"
            class="text-[11px] px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-300 border border-brand-500/30"
          >{{ usage.plan }}</span>
        </div>
        <span class="text-[11px] text-ink-500">
          {{ usage?.source === 'dashboard_rpc'
            ? '数据来源：Dashboard'
            : usage?.source === 'usage_summary'
            ? '数据来源：Summary'
            : usage?.source === 'auth_usage'
            ? '数据来源：Auth/Usage'
            : '' }}
        </span>
      </div>

      <div v-if="usageError && !usage" class="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-200">
        {{ usageError }}
      </div>

      <div v-else-if="usage && hasAnyUsageField" class="space-y-3">
        <!-- 总进度条 -->
        <div v-if="usageProgress !== null">
          <div class="flex items-baseline justify-between mb-1.5 text-xs">
            <span class="text-ink-400">本周期已用</span>
            <span class="text-ink-200 font-medium">
              <template v-if="usage.includedSpendUsd !== null && usage.limitUsd !== null">
                {{ fmtMoney(usage.includedSpendUsd) }} / {{ fmtMoney(usage.limitUsd) }}
              </template>
              <template v-else>
                {{ fmtPercent(usageProgress) }}
              </template>
            </span>
          </div>
          <div class="h-2 rounded-full bg-ink-800 overflow-hidden">
            <div
              class="h-full transition-all"
              :class="progressColor"
              :style="{ width: `${usageProgress}%` }"
            ></div>
          </div>
          <div class="flex items-baseline justify-between mt-1 text-[11px] text-ink-500">
            <span>剩余 {{ fmtMoney(usage.remainingUsd) }}</span>
            <span>{{ fmtPercent(usageProgress) }}</span>
          </div>
        </div>

        <!-- Enterprise 请求数 -->
        <div v-if="usage.requestsUsed !== null">
          <div class="flex items-baseline justify-between mb-1.5 text-xs">
            <span class="text-ink-400">请求数（按计数计）</span>
            <span class="text-ink-200 font-medium">
              {{ usage.requestsUsed }}
              <span v-if="usage.requestsLimit" class="text-ink-500"> / {{ usage.requestsLimit }}</span>
            </span>
          </div>
        </div>

        <!-- 细项栅格 -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-2">
            <div class="text-[11px] text-ink-500">Auto 模型</div>
            <div class="text-sm text-ink-100 font-medium mt-0.5">
              {{ fmtPercent(usage.autoPercent) }}
            </div>
          </div>
          <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-2">
            <div class="text-[11px] text-ink-500">API 模型</div>
            <div class="text-sm text-ink-100 font-medium mt-0.5">
              {{ fmtPercent(usage.apiPercent) }}
            </div>
          </div>
          <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-2">
            <div class="text-[11px] text-ink-500">总花费</div>
            <div class="text-sm text-ink-100 font-medium mt-0.5">
              {{ fmtMoney(usage.totalSpendUsd) }}
            </div>
          </div>
          <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-2">
            <div class="text-[11px] text-ink-500">赠送额度</div>
            <div class="text-sm text-ink-100 font-medium mt-0.5">
              {{ fmtMoney(usage.bonusSpendUsd) }}
            </div>
          </div>
        </div>

        <!-- 按需付费 -->
        <div
          v-if="usage.individualLimitUsd !== null"
          class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-2 text-xs"
        >
          <div class="flex items-baseline justify-between">
            <span class="text-ink-400">按需付费上限</span>
            <span class="text-ink-100 font-medium">
              {{ fmtMoney(usage.individualUsedUsd) }} / {{ fmtMoney(usage.individualLimitUsd) }}
            </span>
          </div>
        </div>

        <!-- 周期 -->
        <div
          v-if="usage.periodStart || usage.periodEnd"
          class="text-[11px] text-ink-500 flex items-center gap-3"
        >
          <span>周期：{{ fmtDate(usage.periodStart) }} → {{ fmtDate(usage.periodEnd) }}</span>
        </div>
      </div>

      <div v-else-if="usage && !hasAnyUsageField" class="text-xs text-ink-400">
        接口返回了响应，但没识别出可展示的字段。可能是免费账号或新版接口字段变了。
      </div>
    </section>

    <!-- 结果 / 错误 -->
    <section v-if="result" class="card p-4 mb-4 border-emerald-500/40">
      <div class="text-sm font-medium text-emerald-300 mb-2">导入成功</div>
      <div class="text-xs text-ink-300 space-y-1">
        <div>账号：<span class="font-mono text-ink-100">{{ result.email || '（未识别 email）' }}</span></div>
        <div v-if="result.resetMachineId">
          机器码已重置 · 新设备 ID
          <span class="font-mono text-ink-200 text-[11px]">{{ result.newDeviceId }}</span>
        </div>
        <div v-if="result.relaunched">已重新拉起 Cursor</div>
        <div class="text-ink-500">
          原始数据已备份到：<span class="font-mono text-[11px]">{{ result.backupDir }}</span>
        </div>
      </div>
    </section>

    <section v-if="errorMsg" class="card p-4 mb-4 border-rose-500/40">
      <div class="text-sm font-medium text-rose-300 mb-1">操作失败</div>
      <div class="text-xs text-rose-200 whitespace-pre-wrap break-all">{{ errorMsg }}</div>
    </section>

    <!-- 安全提示 -->
    <footer class="text-[11px] text-ink-600 leading-relaxed mt-4 px-1">
      · 工具仅修改本机 Cursor 配置文件 + 调用 Cursor 自有 dashboard 接口查用量，不向我们的服务器发送你的 token<br />
      · token 等同于账号密码，请勿随意公开<br />
      · 写入前会自动备份当前 storage.json / state.vscdb 到工具数据目录，可手动还原
    </footer>
  </main>
</template>
