<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

const router = useRouter();
const orderNo = ref('');

function submit() {
  if (!orderNo.value.trim()) {
    ElMessage.warning('请输入订单号');
    return;
  }
  router.push(`/order/${orderNo.value.trim()}`);
}
</script>

<template>
  <div class="max-w-lg mx-auto px-4 py-16">
    <div class="card p-8">
      <h1 class="text-xl font-semibold">卡密查询</h1>
      <p class="text-sm text-gray-500 mt-1">输入订单号查询对应的卡密信息</p>
      <input
        v-model="orderNo"
        class="mt-5 w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
        placeholder="请输入订单号"
        @keydown.enter="submit"
      />
      <button class="mt-4 w-full py-2.5 rounded-lg brand-gradient text-white" @click="submit">
        查询
      </button>
    </div>
  </div>
</template>
