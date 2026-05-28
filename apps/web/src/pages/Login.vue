<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';
import Captcha from '@/components/Captcha.vue';

const user = useUserStore();
const route = useRoute();
const router = useRouter();

const form = ref({ username: '', password: '' });
const captcha = ref({ id: '', code: '' });
const captchaRef = ref<InstanceType<typeof Captcha> | null>(null);
const loading = ref(false);

async function submit() {
  if (!form.value.username || !form.value.password) {
    ElMessage.warning('请填写账号和密码');
    return;
  }
  if (!captcha.value.id || !captcha.value.code) {
    ElMessage.warning('请输入图形验证码');
    return;
  }
  loading.value = true;
  try {
    await user.login({
      username: form.value.username,
      password: form.value.password,
      captchaId: captcha.value.id,
      captchaCode: captcha.value.code,
    });
    if (!user.profile) {
      await user.restore();
    }
    ElMessage.success('登录成功');
    const redirect = (route.query.redirect as string) || '/';
    const target = user.profile?.role === 'ADMIN' && redirect === '/' ? '/admin' : redirect;
    router.replace(target);
  } catch {
    captchaRef.value?.refresh();
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
        autocomplete="username"
      />
      <input
        v-model="form.password"
        type="password"
        class="mt-3 w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
        placeholder="密码"
        autocomplete="current-password"
        @keydown.enter="submit"
      />
      <div class="mt-3">
        <Captcha ref="captchaRef" v-model="captcha" :on-enter="submit" />
      </div>
      <button class="mt-5 w-full py-2.5 rounded-lg brand-gradient text-white" :disabled="loading" @click="submit">
        {{ loading ? '登录中...' : '登录' }}
      </button>
      <p class="text-xs text-gray-500 mt-4 text-center">
        没有账号？<router-link to="/register" class="text-brand-600 hover:underline">去注册</router-link>
      </p>
    </div>
  </div>
</template>
