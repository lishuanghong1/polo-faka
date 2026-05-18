<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';

const route = useRoute();
const router = useRouter();
const orderNo = route.query.orderNo as string;

async function pay() {
  await api.mockPay(orderNo);
  ElMessage.success('支付成功，正在分配卡密...');
  router.replace(`/order/${orderNo}`);
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-16">
    <div class="card p-8 text-center">
      <div class="w-16 h-16 rounded-2xl brand-gradient mx-auto flex items-center justify-center text-white text-2xl font-bold">
        ¥
      </div>
      <h2 class="mt-4 text-lg font-semibold">Mock 支付</h2>
      <p class="text-sm text-gray-500 mt-1">
        这是开发用的支付模拟器。点击下方按钮即视为支付完成。<br />
        生产环境请替换为易支付 / 虎皮椒 / USDT 等真实通道。
      </p>
      <p class="mt-4 text-xs text-gray-400">订单号：{{ orderNo }}</p>
      <button class="mt-6 w-full py-2.5 rounded-lg brand-gradient text-white font-medium" @click="pay">
        确认支付
      </button>
      <router-link :to="`/order/${orderNo}`" class="block mt-3 text-sm text-gray-500 hover:text-brand-600">
        我已经付过了，去查看订单
      </router-link>
    </div>
  </div>
</template>
