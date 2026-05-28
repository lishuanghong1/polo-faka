<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

const router = useRouter();
const orderNo = ref('');
const contact = ref('');

/**
 * 订单号路由分发 + 可选 contact 透传：
 * 根据订单号前缀派发到对应详情页（用户不感知）。
 */
function submit() {
  const no = orderNo.value.trim();
  if (!no) {
    ElMessage.warning('请输入订单号');
    return;
  }
  const query = contact.value.trim() ? { contact: contact.value.trim() } : undefined;
  if (no.startsWith('F')) {
    router.push({ path: `/forge-order/${no}`, query });
  } else {
    router.push({ path: `/order/${no}`, query });
  }
}
</script>

<template>
  <div class="max-w-lg mx-auto px-4 py-16">
    <div class="card p-8">
      <h1 class="text-xl font-semibold text-ink-900">订单查询</h1>
      <p class="text-sm text-ink-500 mt-1">输入订单号查询订单状态和发货内容</p>

      <div class="mt-5 space-y-3">
        <div>
          <label class="text-xs text-ink-500 block mb-1">订单号</label>
          <input
            v-model="orderNo"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 font-mono"
            placeholder="P / F 开头的订单号"
            @keydown.enter="submit"
          />
        </div>

        <div>
          <label class="text-xs text-ink-500 block mb-1 flex items-center gap-2">
            联系方式
            <span class="text-[10px] text-ink-400 font-normal">下单时填过才需要</span>
          </label>
          <input
            v-model="contact"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
            placeholder="QQ / 邮箱 / 手机（可不填）"
            @keydown.enter="submit"
          />
        </div>
      </div>

      <button class="mt-5 w-full py-2.5 rounded-lg brand-gradient text-white" @click="submit">
        查询订单
      </button>

      <p class="mt-3 text-[11px] text-ink-400 leading-relaxed">
        下单时若填写过联系方式，需输入相同联系方式才能查看发货内容。
      </p>
    </div>
  </div>
</template>
