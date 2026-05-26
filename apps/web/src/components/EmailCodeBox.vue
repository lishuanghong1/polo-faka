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
const errorCode = ref<string>('');
const errorMsg = ref<string>('');
const upstreamMsg = ref<string>('');
const enabled = ref(true);

const MAX_RETRIES = 40; // 40 * 3s = 120s
const INTERVAL_MS = 3000;

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
  errorCode.value = '';
  errorMsg.value = '';
  upstreamMsg.value = '';
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
      lastStatus.value = r.status || '';
      if (r.found && r.verification_code) {
        code.value = r.verification_code;
        detail.value = r;
        stopPolling();
        return;
      }
    } catch (e: any) {
      const resp = e?.response?.data;
      const bizCode = resp?.error?.code || resp?.code || resp?.error || '';
      const bizMsg = resp?.error?.message || resp?.message || e?.message || '请求失败';
      const upstream = resp?.error?.upstream_message || resp?.upstream_message;
      if (
        typeof bizCode === 'string' &&
        (bizCode.startsWith('EMAIL_') || bizCode.startsWith('AUTH_') || bizCode === 'FORBIDDEN_SCOPE')
      ) {
        errorCode.value = bizCode;
        errorMsg.value = bizMsg;
        upstreamMsg.value = upstream || '';
        stopPolling();
        return;
      }
      lastStatus.value = bizMsg;
    }
    await new Promise((res) => {
      timer = window.setTimeout(res, INTERVAL_MS);
    });
  }
  if (!cancelled && !code.value) {
    errorMsg.value = '超时未收到验证码，请确认验证码已发送并重试';
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

      <div v-if="polling" class="mt-4 p-3 bg-brand-50/40 border border-brand-100 rounded-lg flex items-center gap-3">
        <div class="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin"></div>
        <div class="flex-1 text-sm text-ink-700">
          <div>正在轮询邮箱 <code class="font-mono text-ink-900 break-all">{{ email }}</code></div>
          <div class="text-xs text-ink-500 mt-0.5">
            已等待 {{ elapsedSec }}s
            <template v-if="lastStatus"> · {{ lastStatus }}</template>
          </div>
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

      <div v-if="errorMsg && !polling && !code" class="mt-4 p-3 bg-rose-50/60 border border-rose-200 rounded-lg">
        <div class="text-xs text-rose-700 mb-1">
          获取失败<template v-if="errorCode"> · {{ errorCode }}</template>
        </div>
        <div class="text-sm text-rose-900">{{ errorMsg }}</div>
        <div v-if="upstreamMsg && upstreamMsg !== errorMsg" class="text-xs text-rose-700 mt-2 font-mono break-all bg-white/60 rounded px-2 py-1">
          上游：{{ upstreamMsg }}
        </div>
      </div>
    </template>
  </div>
</template>
