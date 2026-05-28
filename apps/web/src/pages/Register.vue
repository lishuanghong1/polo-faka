<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';
import Captcha from '@/components/Captcha.vue';

const user = useUserStore();
const router = useRouter();

const form = ref({ username: '', password: '', email: '', nickname: '' });
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
    await user.register({
      username: form.value.username,
      password: form.value.password,
      email: form.value.email || undefined,
      nickname: form.value.nickname || undefined,
      captchaId: captcha.value.id,
      captchaCode: captcha.value.code,
    });
    ElMessage.success('注册成功');
    router.replace('/');
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
      <h1 class="text-xl font-semibold">注册</h1>
      <input
        v-model="form.username"
        placeholder="账号 (≥3 位)"
        class="mt-5 w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
        autocomplete="username"
      />
      <input
        v-model="form.password"
        type="password"
        placeholder="密码 (≥6 位)"
        class="mt-3 w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
        autocomplete="new-password"
      />
      <input
        v-model="form.email"
        placeholder="邮箱（可选）"
        class="mt-3 w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
        autocomplete="email"
      />
      <input
        v-model="form.nickname"
        placeholder="昵称（可选）"
        class="mt-3 w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
      />
      <div class="mt-3">
        <Captcha ref="captchaRef" v-model="captcha" :on-enter="submit" />
      </div>
      <button class="mt-5 w-full py-2.5 rounded-lg brand-gradient text-white" :disabled="loading" @click="submit">
        {{ loading ? '注册中...' : '注册' }}
      </button>
      <p class="text-xs text-gray-500 mt-4 text-center">
        已有账号？<router-link to="/login" class="text-brand-600 hover:underline">去登录</router-link>
      </p>
    </div>
  </div>
</template>
