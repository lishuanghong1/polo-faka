<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';

const props = withDefaults(
  defineProps<{
    /** 预填邮箱（如订单页传入交付邮箱） */
    modelValue?: string;
    /** 是否允许用户编辑邮箱输入框；默认允许 */
    editable?: boolean;
    /** 紧凑模式（订单详情页用） */
    compact?: boolean;
  }>(),
  {
    editable: true,
    compact: false,
  },
);

const email = ref(props.modelValue || '');
const polling = ref(false);
const elapsedSec = ref(0);
const lastStatus = ref<string>('');
const code = ref<string | null>(null);
const detail = ref<any>(null);
const errorMsg = ref<string>('');
const errorHint = ref<string>('');
const enabled = ref(true);

const MAX_RETRIES = 40; // 40 * 3s = 120s
const INTERVAL_MS = 3000;

// 终止类错误码：命中即停止轮询并提示（与后端 EMAIL_CODE_ERROR_MAP 对齐）
const TERMINAL_CODES = new Set([
  'EMAIL_INACTIVE',
  'EMAIL_EXPIRED',
  'EMAIL_NOT_OWNED',
  'EMAIL_CODE_NOT_ENABLED',
  'SERVICE_DISABLED',
  'AUTH_KEY_INVALID',
  'AUTH_AGENT_REVOKED',
  'AUTH_BAD_SIGNATURE',
  'FORBIDDEN_SCOPE',
]);

let cancelled = false;
let timer: number | undefined;
let elapsedTimer: number | undefined;

const isEditable = computed(() => props.editable !== false);

const isValidEmail = computed(() =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email.value || '').trim()),
);

watch(() => props.modelValue, (v) => {
  if (v !== undefined && v !== email.value) email.value = v;
});

onMounted(async () => {
  try {
    const r = await api.emailCode.enabled();
    enabled.value = !!r.enabled;
  } catch {
    enabled.value = false;
  }
});

onBeforeUnmount(() => {
  cancelled = true;
  if (timer) window.clearTimeout(timer);
  if (elapsedTimer) window.clearInterval(elapsedTimer);
});

function reset() {
  code.value = null;
  detail.value = null;
  errorMsg.value = '';
  errorHint.value = '';
  lastStatus.value = '';
  elapsedSec.value = 0;
}

async function start() {
  if (!isValidEmail.value) {
    ElMessage.warning('请输入正确的邮箱地址');
    return;
  }
  reset();
  cancelled = false;
  polling.value = true;
  elapsedSec.value = 0;
  elapsedTimer = window.setInterval(() => {
    elapsedSec.value += 1;
  }, 1000);

  for (let i = 0; i < MAX_RETRIES; i++) {
    if (cancelled) break;
    try {
      const r = await api.emailCode.fetch({
        email: email.value.trim(),
        clear_cache: i === 0,
        time_range: 300,
      });
      // 拿到验证码 → 完成
      if (r.found && r.verification_code) {
        code.value = r.verification_code;
        detail.value = r;
        stopPolling();
        return;
      }
      // 业务错误（已统一为 200 + 结构化结果）。
      // 双重判定：ok===false 或 code 非 OK 都视为错误；terminal 或已知终止码都立即停止。
      const isBizError = r.ok === false || (typeof r.code === 'string' && r.code !== 'OK');
      if (isBizError) {
        const terminal =
          r.terminal === true ||
          (typeof r.code === 'string' && TERMINAL_CODES.has(r.code));
        if (terminal) {
          errorMsg.value = r.message || '获取失败，请稍后重试';
          errorHint.value = r.hint || '';
          stopPolling();
          return;
        }
        // 可重试：把友好文案放到状态行，继续轮询
        lastStatus.value = r.message || '正在重试…';
      } else {
        lastStatus.value = r.status || '正在查收邮件…';
      }
    } catch (e: any) {
      // 走到这里说明是我方接口的真·HTTP 错误（如本机限流 429 / 参数 400）
      const resp = e?.response?.data;
      const bizMsg = resp?.error?.message || resp?.message || '网络异常，正在重试';
      lastStatus.value = bizMsg;
    }
    await new Promise((res) => {
      timer = window.setTimeout(res, INTERVAL_MS);
    });
  }
  if (!cancelled && !code.value) {
    errorMsg.value = '在规定时间内没有收到验证码';
    errorHint.value = '请确认验证码确实已发送到该邮箱，然后再次点击「获取验证码」重试。';
  }
  stopPolling();
}

function stop() {
  cancelled = true;
  stopPolling();
}

function stopPolling() {
  polling.value = false;
  if (timer) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  if (elapsedTimer) {
    window.clearInterval(elapsedTimer);
    elapsedTimer = undefined;
  }
}

async function copyCode() {
  if (!code.value) return;
  try {
    await navigator.clipboard.writeText(code.value);
    ElMessage.success('验证码已复制');
  } catch {
    ElMessage.error('复制失败，请手动选中复制');
  }
}

function formatTime(ts?: number) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString();
}
</script>

<template>
  <div>
    <div v-if="!enabled" class="text-center py-4 text-amber-700 bg-amber-50/60 border border-amber-200 rounded-lg text-sm">
      接码接口未启用，请联系管理员在后台配置。
    </div>

    <template v-else>
      <label class="block text-sm font-medium text-ink-700 mb-2" v-if="!compact">账号邮箱</label>
      <div class="flex gap-2">
        <input
          v-model="email"
          type="email"
          placeholder="your-account@outlook.com"
          autocomplete="email"
          :disabled="polling || !isEditable"
          class="flex-1 px-3.5 py-2.5 rounded-lg border border-ink-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none text-sm transition disabled:bg-ink-50"
          @keydown.enter="!polling && start()"
        />
        <button
          v-if="!polling"
          class="px-5 py-2.5 rounded-lg brand-gradient text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!isValidEmail"
          @click="start"
        >
          获取验证码
        </button>
        <button
          v-else
          class="px-5 py-2.5 rounded-lg border border-ink-200 text-ink-700 text-sm hover:bg-ink-50 transition"
          @click="stop"
        >
          停止
        </button>
      </div>

      <div v-if="polling" class="mt-4 p-3 bg-brand-50/40 border border-brand-100 rounded-lg">
        <div class="flex items-center gap-3">
          <div class="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin shrink-0"></div>
          <div class="flex-1 text-sm text-ink-700 min-w-0">
            <div class="truncate">正在轮询邮箱 <code class="font-mono text-ink-900">{{ email }}</code></div>
            <div class="text-xs text-ink-500 mt-0.5">
              <span class="font-medium">{{ elapsedSec }}s</span> / 120s
              <template v-if="lastStatus"> · {{ lastStatus }}</template>
            </div>
          </div>
        </div>
        <!-- 进度条 -->
        <div class="mt-2.5 h-1.5 bg-white/70 rounded-full overflow-hidden">
          <div
            class="h-full bg-brand-500 rounded-full transition-all duration-1000 ease-linear"
            :style="{ width: `${Math.min(100, (elapsedSec / 120) * 100)}%` }"
          ></div>
        </div>
      </div>

      <div v-if="code && !polling" class="mt-4">
        <div class="p-4 bg-emerald-50/60 border border-emerald-200 rounded-lg">
          <div class="text-xs text-emerald-700 mb-1">验证码已收到</div>
          <div class="flex items-center justify-between gap-3">
            <div class="text-2xl sm:text-3xl font-mono font-bold tracking-[0.3em] text-emerald-900">
              {{ code }}
            </div>
            <button
              class="px-3 py-1.5 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition shrink-0"
              @click="copyCode"
            >
              复制
            </button>
          </div>
        </div>
        <div v-if="detail" class="mt-2 text-xs text-ink-500 space-y-0.5">
          <div v-if="detail.type_name">商品类型：{{ detail.type_name }}</div>
          <div v-if="detail.mail_time">收件时间：{{ formatTime(detail.mail_time) }}</div>
          <div v-if="detail.expire_at">账号有效期至：{{ detail.expire_at }}</div>
        </div>
        <button
          class="mt-3 w-full px-4 py-2 rounded-lg border border-ink-200 text-sm text-ink-700 hover:bg-ink-50 transition"
          @click="reset"
        >
          再来一次
        </button>
      </div>

      <div v-if="errorMsg && !polling && !code" class="mt-4 p-3.5 bg-amber-50/70 border border-amber-200 rounded-lg flex items-start gap-2.5">
        <svg class="w-5 h-5 text-amber-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        </svg>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-amber-900">{{ errorMsg }}</div>
          <div v-if="errorHint" class="text-xs text-amber-700/90 mt-1 leading-relaxed">{{ errorHint }}</div>
          <button
            class="mt-2.5 text-xs px-3 py-1.5 rounded-md border border-amber-300 text-amber-800 hover:bg-amber-100/60 transition"
            @click="start"
          >
            重新获取
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
