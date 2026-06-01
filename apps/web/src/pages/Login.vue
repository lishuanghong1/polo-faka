<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';
import Captcha from '@/components/Captcha.vue';
import BrandButton from '@/components/BrandButton.vue';

const user = useUserStore();
const route = useRoute();
const router = useRouter();

const form = ref({ username: '', password: '' });
const captcha = ref({ id: '', code: '' });
const captchaRef = ref<InstanceType<typeof Captcha> | null>(null);
const loading = ref(false);

async function submit() {
  if (!form.value.username || !form.value.password) return ElMessage.warning('请填写账号和密码');
  if (!captcha.value.id || !captcha.value.code) return ElMessage.warning('请输入图形验证码');
  loading.value = true;
  try {
    await user.login({
      username: form.value.username,
      password: form.value.password,
      captchaId: captcha.value.id,
      captchaCode: captcha.value.code,
    });
    if (!user.profile) await user.restore();
    // 登录接口已通过，但用户资料没拉到 → token 已被清掉，视为登录未成功（避免假“登录成功”后被弹回）
    if (!user.profile) {
      ElMessage.error('登录态校验失败，请稍后重试或联系客服');
      captchaRef.value?.refresh();
      return;
    }
    ElMessage.success('登录成功');
    const redirect = (route.query.redirect as string) || '/';
    const target = user.profile?.role === 'ADMIN' && redirect === '/' ? '/admin' : redirect;
    router.replace(target);
  } catch {
    // api.login 的 HTTP 错误已由响应拦截器统一 toast，这里只需刷新验证码
    captchaRef.value?.refresh();
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-12 md:py-16">
    <div class="text-center mb-6">
      <div class="w-14 h-14 rounded-2xl bg-brand-600 text-white mx-auto mb-3 flex items-center justify-center text-xl font-bold shadow-sm">P</div>
      <h1 class="text-2xl font-semibold tracking-tight text-ink-900">欢迎回来</h1>
      <p class="text-sm text-ink-500 mt-1.5">登录后管理订单、查看余额、接收验证码</p>
    </div>

    <div class="card p-6 md:p-8">
      <div class="space-y-3">
        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1.5">账号</label>
          <input
            v-model="form.username"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition placeholder:text-ink-300"
            placeholder="账号 / 邮箱"
            autocomplete="username"
            autofocus
          />
        </div>
        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1.5">密码</label>
          <input
            v-model="form.password"
            type="password"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition placeholder:text-ink-300"
            placeholder="请输入密码"
            autocomplete="current-password"
            @keydown.enter="submit"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1.5">图形验证码</label>
          <Captcha ref="captchaRef" v-model="captcha" :on-enter="submit" />
        </div>
      </div>

      <BrandButton
        class="mt-5"
        variant="primary"
        size="md"
        block
        :loading="loading"
        @click="submit"
      >
        {{ loading ? '登录中…' : '登录' }}
      </BrandButton>

      <p class="text-xs text-ink-500 mt-4 text-center">
        没有账号？<router-link to="/register" class="text-brand-600 hover:text-brand-700 hover:underline">立即注册</router-link>
      </p>
    </div>
  </div>
</template>
