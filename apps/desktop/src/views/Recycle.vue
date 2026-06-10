<script setup lang="ts">
import { computed, ref } from 'vue';
import { api } from '../api';
import type { Account, RecycleResult } from '../types';

const props = defineProps<{ accounts: Account[] }>();
const emit = defineEmits<{
  (e: 'toast', kind: 'warn' | 'critical' | 'info' | 'error', text: string): void;
}>();

const email = ref('');
const invoiceNumber = ref('');
const submitting = ref(false);
const result = ref<RecycleResult | null>(null);

/** 账号库里的邮箱，供「输入或选择」 */
const emailOptions = computed(() =>
  Array.from(
    new Set(props.accounts.map((a) => a.email).filter((e): e is string => !!e)),
  ),
);

async function submit() {
  const value = email.value.trim();
  if (!value) {
    emit('toast', 'warn', '请先选择或输入账号邮箱');
    return;
  }
  submitting.value = true;
  result.value = null;
  try {
    const r = await api.recycleAccount(value, invoiceNumber.value);
    result.value = r;
    emit('toast', 'info', `已提交回收申请：${r.email || value}`);
  } catch (e: any) {
    emit('toast', 'error', String(e?.message || e));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <!-- 标题 -->
    <h1 class="text-2xl font-bold text-ink-100">回收</h1>
    <p class="text-sm text-ink-500 mt-1">
      选择要回收的账号邮箱，提交后我们将为你处理回收申请
    </p>

    <!-- 提示条 -->
    <div
      class="mt-4 flex items-start gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-xs text-brand-100/90 leading-relaxed"
    >
      <span class="shrink-0">💡</span>
      <span>
        无需手动填写订阅信息，只要选择已购买的账号邮箱并提交即可申请回收。提交后请留意账号邮箱的后续通知。
      </span>
    </div>

    <!-- 表单卡片 -->
    <div class="card p-5 mt-4">
      <label class="block text-sm font-semibold text-ink-200 mb-2">
        账号邮箱 <span class="text-ink-500 font-normal">(Account Email)</span>
      </label>
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        </span>
        <input
          v-model="email"
          list="recycle-email-options"
          type="email"
          placeholder="输入或选择账号邮箱"
          autocomplete="off"
          class="w-full pl-9 pr-3 py-2.5 rounded-lg bg-ink-950/60 border border-ink-700 text-ink-100
                 placeholder:text-ink-600 focus:border-brand-500 focus:outline-none transition"
          @keyup.enter="submit"
        />
        <datalist id="recycle-email-options">
          <option v-for="opt in emailOptions" :key="opt" :value="opt" />
        </datalist>
      </div>

      <label class="block text-sm font-semibold text-ink-200 mb-2 mt-4">
        发票号 <span class="text-ink-500 font-normal">(Invoice Number · 选填)</span>
      </label>
      <input
        v-model="invoiceNumber"
        type="text"
        placeholder="可在 Cursor 账单门户复制，留空则不填写该行"
        autocomplete="off"
        class="w-full px-3 py-2.5 rounded-lg bg-ink-950/60 border border-ink-700 text-ink-100
               placeholder:text-ink-600 focus:border-brand-500 focus:outline-none transition"
        @keyup.enter="submit"
      />

      <button
        class="btn-primary w-full mt-4 py-2.5"
        :disabled="submitting || !email.trim()"
        @click="submit"
      >
        {{ submitting ? '提交中…' : '提交回收申请' }}
      </button>

      <p v-if="!emailOptions.length" class="text-[11px] text-ink-600 mt-2">
        账号库为空，请先在「账号库」导入账号后再回收。
      </p>
    </div>

    <!-- 提交结果 -->
    <div v-if="result" class="card p-5 mt-4 space-y-3">
      <div class="flex items-center gap-2 text-sm text-emerald-300">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        已提交回收申请
      </div>
      <dl class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt class="text-ink-500">账号邮箱</dt>
        <dd class="text-ink-200 break-all">{{ result.email || '—' }}</dd>
        <dt class="text-ink-500">购买日期</dt>
        <dd class="text-ink-200">{{ result.purchaseDate || '（未取到）' }}</dd>
        <dt class="text-ink-500">发票号</dt>
        <dd class="text-ink-200">{{ result.invoiceNumber || '（Cursor 未提供接口）' }}</dd>
      </dl>
      <details class="text-xs">
        <summary class="cursor-pointer text-ink-400 hover:text-ink-200">查看提交正文 / Cursor 返回</summary>
        <pre class="mt-2 whitespace-pre-wrap break-all rounded-lg bg-ink-950/60 border border-ink-800 p-3 text-ink-300">{{ result.message }}</pre>
        <pre class="mt-2 whitespace-pre-wrap break-all rounded-lg bg-ink-950/60 border border-ink-800 p-3 text-ink-400">{{ JSON.stringify(result.response, null, 2) }}</pre>
      </details>
    </div>
  </div>
</template>
