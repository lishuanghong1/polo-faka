<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';
import BrandButton from '@/components/BrandButton.vue';

type Mode = 'email' | 'token';
const mode = ref<Mode>('email');
const email = ref('');
const token = ref('');
const submitting = ref(false);
const result = ref<{ status: string; message: string } | null>(null);
let pollTimer: number | undefined;

function switchMode(m: Mode) {
  if (mode.value === m) return;
  mode.value = m;
  stopPoll();
  result.value = null;
}

const statusMeta = computed(() => {
  const s = result.value?.status;
  if (s === 'DONE') return { cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: '已退款' };
  if (s === 'SUBMITTED') return { cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: '已提交' };
  if (s === 'PROCESSING') return { cls: 'text-sky-700 bg-sky-50 border-sky-200', label: '处理中' };
  if (s === 'FAILED') return { cls: 'text-rose-700 bg-rose-50 border-rose-200', label: '失败' };
  return { cls: 'text-ink-600 bg-ink-50 border-ink-200', label: '可申请' };
});

function stopPoll() {
  if (pollTimer) { window.clearInterval(pollTimer); pollTimer = undefined; }
}
onBeforeUnmount(stopPoll);

function startPoll() {
  stopPoll();
  pollTimer = window.setInterval(async () => {
    if (!email.value.trim()) return stopPoll();
    try {
      const r = await api.customerRefund.status(email.value.trim());
      result.value = { status: r.status, message: r.message };
      if (r.status === 'DONE' || r.status === 'FAILED') stopPoll();
    } catch {
      stopPoll();
    }
  }, 4000);
}

async function submit() {
  return mode.value === 'token' ? submitByToken() : submitByEmail();
}

async function submitByEmail() {
  const e = email.value.trim();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    ElMessage.warning('请输入正确的账号邮箱');
    return;
  }
  submitting.value = true;
  result.value = null;
  try {
    const r = await api.customerRefund.apply(e);
    result.value = { status: r.status, message: r.message };
    if (r.status === 'PROCESSING') startPoll();
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message || err?.response?.data?.message || '申请失败';
    result.value = { status: 'NOT_ELIGIBLE', message: msg };
  } finally {
    submitting.value = false;
  }
}

async function submitByToken() {
  const t = token.value.trim();
  if (!t) {
    ElMessage.warning('请粘贴账号 token');
    return;
  }
  stopPoll();
  submitting.value = true;
  result.value = null;
  try {
    const r = await api.customerRefund.applyToken(t);
    result.value = { status: r.status || 'SUBMITTED', message: r.message || '提交成功，请耐心等待' };
    token.value = '';
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message || err?.response?.data?.message || '提交失败，请稍后重试';
    result.value = { status: 'FAILED', message: msg };
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="max-w-lg mx-auto px-4 py-12 md:py-16">
    <div class="text-center mb-6">
      <div class="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 mx-auto mb-3 flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="w-7 h-7">
          <path d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 00-14.7-3M4 15a8 8 0 0014.7 3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h1 class="text-2xl font-semibold tracking-tight text-ink-900">账号退款</h1>
      <p class="text-sm text-ink-500 mt-1.5">
        输入购买时的账号邮箱，或直接粘贴账号 token，自动为你办理退款
      </p>
    </div>

    <div class="card p-6 md:p-8">
      <!-- 退款方式切换 -->
      <div class="grid grid-cols-2 gap-1 p-1 bg-ink-50 rounded-lg mb-4">
        <button
          type="button"
          class="py-1.5 rounded-md text-sm font-medium transition"
          :class="mode === 'email' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'"
          @click="switchMode('email')"
        >
          邮箱退款
        </button>
        <button
          type="button"
          class="py-1.5 rounded-md text-sm font-medium transition"
          :class="mode === 'token' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'"
          @click="switchMode('token')"
        >
          Token 退款
        </button>
      </div>

      <template v-if="mode === 'email'">
        <label class="text-xs font-medium text-ink-700 block mb-1.5">
          账号邮箱 <span class="text-rose-500">*</span>
        </label>
        <input
          v-model="email"
          class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition"
          placeholder="购买时的账号邮箱"
          autofocus
          @keydown.enter="submit"
        />
      </template>

      <template v-else>
        <label class="text-xs font-medium text-ink-700 block mb-1.5">
          账号 Token <span class="text-rose-500">*</span>
        </label>
        <textarea
          v-model="token"
          rows="3"
          class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm font-mono break-all resize-none focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition"
          placeholder="粘贴账号 token（形如 user_xxx::eyJ...），无需在退款名单内"
        />
      </template>

      <BrandButton class="mt-4" variant="primary" size="md" block :loading="submitting" @click="submit">
        {{ submitting ? '提交中…' : '申请退款' }}
      </BrandButton>

      <div
        v-if="result"
        class="mt-5 rounded-xl border px-4 py-3 text-sm leading-relaxed"
        :class="statusMeta.cls"
      >
        <div class="font-medium">{{ statusMeta.label }}</div>
        <div class="mt-0.5">{{ result.message }}</div>
        <div v-if="result.status === 'PROCESSING'" class="mt-2 flex items-center gap-2 text-xs">
          <span class="w-3.5 h-3.5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          正在为你办理，本页会自动刷新状态…
        </div>
      </div>

      <div class="mt-5 pt-5 border-t border-ink-100 text-[11px] text-ink-400 leading-relaxed">
        <template v-if="mode === 'token'">
          <p>· 粘贴账号 token 可直接退款，无需在退款名单内。</p>
          <p>· 提交后由后台自动办理，可关闭页面；成功后账号恢复为免费版。</p>
        </template>
        <template v-else>
          <p>· 仅支持在本店购买、且符合退款条件的账号，输入对应邮箱即可申请。</p>
          <p>· 退款成功后账号会恢复为免费版；如遇失败可稍后重试或联系客服。</p>
        </template>
      </div>
    </div>
  </div>
</template>
