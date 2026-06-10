<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';

const email = ref('');
const invoiceNumber = ref('');
const submitting = ref(false);
const result = ref<Awaited<ReturnType<typeof api.recycle>> | null>(null);

async function submit() {
  const value = email.value.trim();
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    ElMessage.warning('请输入正确的账号邮箱');
    return;
  }
  const invoice = invoiceNumber.value.trim();
  if (!invoice) {
    ElMessage.warning('请填写账单号');
    return;
  }
  submitting.value = true;
  result.value = null;
  try {
    const r = await api.recycle(value, invoice);
    result.value = r;
    ElMessage.success('已提交回收申请');
  } catch {
    // 错误已由全局拦截器提示
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-10">
    <!-- 标题 -->
    <h1 class="text-3xl font-bold text-ink-900">回收</h1>
    <p class="text-ink-500 mt-2">选择要回收的账号邮箱，提交后我们将为你处理回收申请</p>

    <!-- 提示条 -->
    <div
      class="mt-6 flex items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-ink-700 leading-relaxed"
    >
      <span class="shrink-0 text-lg leading-none">💡</span>
      <span>
        无需手动填写订阅信息，只要输入已购买的账号邮箱并提交即可申请回收。提交后请留意账号邮箱的后续通知。
      </span>
    </div>

    <!-- 表单卡片 -->
    <div class="mt-6 rounded-2xl bg-white border border-ink-100 shadow-card p-6 sm:p-8">
      <label class="block text-base font-semibold text-ink-900 mb-3">
        账号邮箱 <span class="text-ink-400 font-normal">(Account Email)</span>
      </label>
      <div class="relative">
        <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        </span>
        <input
          v-model="email"
          type="email"
          inputmode="email"
          autocomplete="off"
          placeholder="输入账号邮箱"
          class="w-full pl-11 pr-4 py-3 rounded-xl border border-ink-200 text-ink-900
                 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100
                 focus:outline-none transition"
          @keyup.enter="submit"
        />
      </div>

      <label class="block text-base font-semibold text-ink-900 mt-5 mb-3">
        账单号 <span class="text-price">*</span>
        <span class="text-ink-400 font-normal">(Invoice Number)</span>
      </label>
      <div class="relative">
        <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 7h6M9 11h6M9 15h4" />
            <rect x="5" y="3" width="14" height="18" rx="2" />
          </svg>
        </span>
        <input
          v-model="invoiceNumber"
          type="text"
          autocomplete="off"
          placeholder="输入账单号（必填）"
          class="w-full pl-11 pr-4 py-3 rounded-xl border border-ink-200 text-ink-900
                 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100
                 focus:outline-none transition"
          @keyup.enter="submit"
        />
      </div>

      <button
        class="w-full mt-5 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold
               shadow-sm transition disabled:bg-ink-300 disabled:cursor-not-allowed"
        :disabled="submitting || !email.trim() || !invoiceNumber.trim()"
        @click="submit"
      >
        {{ submitting ? '提交中…' : '提交回收申请' }}
      </button>
    </div>

    <!-- 提交结果 -->
    <div v-if="result" class="mt-6 rounded-2xl bg-white border border-ink-100 shadow-card p-6">
      <div class="flex items-center gap-2 text-brand-700 font-medium">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        已提交回收申请
      </div>
      <p class="mt-2 text-sm text-ink-500">
        账号 <span class="text-ink-800 font-medium">{{ result.email }}</span>
        （账单号 <span class="text-ink-800 font-medium">{{ result.invoiceNumber }}</span>）的回收申请已提交，请留意账号邮箱后续通知。
      </p>
    </div>
  </div>
</template>
