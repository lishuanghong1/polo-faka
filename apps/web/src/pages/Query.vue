<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import BrandButton from '@/components/BrandButton.vue';

const router = useRouter();
const orderNo = ref('');
const contact = ref('');

function submit() {
  const no = orderNo.value.trim();
  if (!no) return ElMessage.warning('请输入订单号');
  const query = contact.value.trim() ? { contact: contact.value.trim() } : undefined;
  if (no.startsWith('F')) {
    router.push({ path: `/forge-order/${no}`, query });
  } else {
    router.push({ path: `/order/${no}`, query });
  }
}
</script>

<template>
  <div class="max-w-lg mx-auto px-4 py-12 md:py-20">
    <!-- 标题 + 图标 -->
    <div class="text-center mb-6">
      <div class="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 mx-auto mb-3 flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="w-7 h-7">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <h1 class="text-2xl font-semibold tracking-tight text-ink-900">订单查询</h1>
      <p class="text-sm text-ink-500 mt-1.5">输入订单号查看支付状态和发货内容</p>
    </div>

    <div class="card p-6 md:p-8">
      <div class="space-y-4">
        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1.5">
            订单号 <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="orderNo"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 font-mono transition placeholder:text-ink-300"
            placeholder="请输入订单号"
            autofocus
            @keydown.enter="submit"
          />
        </div>

        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1.5 flex items-center gap-1.5">
            联系方式
            <span class="text-[10px] font-normal text-ink-400">下单时填过才需要</span>
          </label>
          <input
            v-model="contact"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition placeholder:text-ink-300"
            placeholder="QQ / 邮箱 / 手机（可不填）"
            @keydown.enter="submit"
          />
        </div>

        <BrandButton variant="primary" size="md" block @click="submit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          查询订单
        </BrandButton>
      </div>

      <!-- 帮助卡 -->
      <div class="mt-5 pt-5 border-t border-ink-100">
        <div class="flex items-start gap-2 text-[11px] text-ink-400 leading-relaxed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5 mt-0.5 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>
            下单时若填写过联系方式，须输入相同联系方式才能查看发货内容；
            订单号可以在订单页或邮件中找到。
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
