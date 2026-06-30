<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';
import BrandButton from '@/components/BrandButton.vue';

const email = ref('');
const submitting = ref(false);
const result = ref<any>(null);

async function submit() {
  const value = email.value.trim();
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    ElMessage.warning('请输入正确的邮箱');
    return;
  }
  submitting.value = true;
  result.value = null;
  try {
    const r = await api.aizhpCode.userRefund({ email: value });
    result.value = r;
    ElMessage.success(r.message || '退款申请已提交');
  } catch {
    // 全局拦截器已 toast
  } finally {
    submitting.value = false;
  }
}

function reset() {
  result.value = null;
  email.value = '';
}
</script>

<template>
  <div class="max-w-xl mx-auto px-4 py-10 md:py-14">
    <div class="text-center mb-6">
      <div class="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 mx-auto mb-3 flex items-center justify-center shadow-sm">
        <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 00-14.7-3M4 15a8 8 0 0014.7 3" />
        </svg>
      </div>
      <h1 class="text-2xl font-semibold tracking-tight text-ink-900">账号退款申请</h1>
      <p class="text-sm text-ink-500 mt-1.5">输入购买的账号邮箱，系统自动识别档位并提交退款</p>
    </div>

    <div class="card p-6 md:p-8">
      <!-- 提交前：表单 -->
      <template v-if="!result">
        <div class="space-y-4">
          <div>
            <label class="text-xs font-medium text-ink-700 block mb-1.5">账号邮箱</label>
            <input
              v-model="email"
              type="email"
              class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition placeholder:text-ink-300"
              placeholder="购买时收到的邮箱地址"
              autocomplete="email"
              @keydown.enter="submit"
            />
          </div>
        </div>

        <div class="mt-5 p-3 rounded-lg bg-amber-50/60 border border-amber-200 text-xs text-amber-800 leading-relaxed">
          <p class="font-medium mb-1">注意事项：</p>
          <ul class="space-y-0.5 list-disc list-inside text-amber-700">
            <li>仅支持本站购买的 Aizhp 渠道账号申请退款</li>
            <li>退款后账号将失效，请确认不再使用</li>
          </ul>
        </div>

        <BrandButton
          class="mt-5"
          variant="primary"
          size="md"
          block
          :loading="submitting"
          @click="submit"
        >
          {{ submitting ? '提交中…' : '申请退款' }}
        </BrandButton>
      </template>

      <!-- 提交后：结果 -->
      <template v-else>
        <div class="text-center py-4">
          <div class="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 mx-auto mb-3 flex items-center justify-center">
            <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <h3 class="text-lg font-semibold text-ink-900">退款申请已提交</h3>
          <p class="mt-2 text-sm text-ink-500">{{ result.message || '我们会尽快为你处理' }}</p>

          <div v-if="result.refund_id" class="mt-4 p-3 bg-ink-50 rounded-lg text-sm text-ink-700">
            <div class="flex items-center justify-between">
              <span>退款编号</span>
              <code class="font-mono text-ink-900">#{{ result.refund_id }}</code>
            </div>
            <div class="flex items-center justify-between mt-1.5">
              <span>档位</span>
              <span class="text-ink-900">{{ result.plan }}</span>
            </div>
            <div v-if="result.remaining_quota" class="flex items-center justify-between mt-1.5">
              <span>剩余退款额度</span>
              <span class="text-ink-900">{{ result.remaining_quota }} 次</span>
            </div>
          </div>

          <BrandButton
            class="mt-5"
            variant="secondary"
            size="md"
            block
            @click="reset"
          >
            继续申请
          </BrandButton>
        </div>
      </template>
    </div>
  </div>
</template>
