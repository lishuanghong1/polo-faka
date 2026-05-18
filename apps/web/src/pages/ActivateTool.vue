<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';

const token = ref('');
const loading = ref(false);
const result = ref<any>(null);

async function activate() {
  if (!token.value.trim()) {
    ElMessage.warning('请输入 Token');
    return;
  }
  loading.value = true;
  result.value = null;
  try {
    result.value = await api.activate({ token: token.value.trim() });
    ElMessage.success(result.value.message || '激活成功');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-12">
    <div class="card p-8">
      <h1 class="text-xl font-semibold">Token 一键激活</h1>
      <p class="text-sm text-gray-500 mt-1">
        把你 Cursor 账号的 Token 粘进来，自动激活为 Ultra。
        <span class="text-rose-500">（仅演示，真实激活需后端对接 Cursor 内部接口）</span>
      </p>

      <textarea
        v-model="token"
        rows="4"
        placeholder="user_xxx::eyJhbG..."
        class="mt-4 w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
      />

      <button
        class="mt-4 w-full py-2.5 rounded-lg brand-gradient text-white"
        :disabled="loading"
        @click="activate"
      >
        {{ loading ? '激活中（10-30 秒）...' : '立即激活' }}
      </button>

      <div v-if="result" class="mt-4 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm">
        <pre>{{ JSON.stringify(result, null, 2) }}</pre>
      </div>

      <div class="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-500">
        <div class="p-3 bg-gray-50 rounded-lg">
          <div class="font-medium text-gray-700">1. 购买卡密</div>
          在商城购买"刷 Ultra"卡密
        </div>
        <div class="p-3 bg-gray-50 rounded-lg">
          <div class="font-medium text-gray-700">2. 获取 Token</div>
          从 Cursor Settings 复制 Token
        </div>
        <div class="p-3 bg-gray-50 rounded-lg">
          <div class="font-medium text-gray-700">3. 一键激活</div>
          填入信息点击激活，约 10-30 秒
        </div>
      </div>
    </div>
  </div>
</template>
