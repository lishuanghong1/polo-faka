<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';

const user = useUserStore();
const route = useRoute();
const router = useRouter();

const form = ref({ username: '', password: '' });
const loading = ref(false);

async function submit() {
  loading.value = true;
  try {
    await user.login(form.value.username, form.value.password);
    ElMessage.success('登录成功');
    const redirect = (route.query.redirect as string) || '/';
    router.replace(redirect);
  } catch {
    /* http interceptor handles err */
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-16">
    <div class="card p-8">
      <h1 class="text-xl font-semibold">登录</h1>
      <input
        v-model="form.username"
        class="mt-5 w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
        placeholder="账号 / 邮箱"
      />
      <input
        v-model="form.password"
        type="password"
        class="mt-3 w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
        placeholder="密码"
        @keydown.enter="submit"
      />
      <button class="mt-5 w-full py-2.5 rounded-lg brand-gradient text-white" :disabled="loading" @click="submit">
        {{ loading ? '登录中...' : '登录' }}
      </button>
      <p class="text-xs text-gray-500 mt-4 text-center">
        没有账号？<router-link to="/register" class="text-brand-600 hover:underline">去注册</router-link>
      </p>
    </div>
  </div>
</template>
