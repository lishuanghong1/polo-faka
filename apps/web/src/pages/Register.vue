<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';
import Captcha from '@/components/Captcha.vue';
import BrandButton from '@/components/BrandButton.vue';

const user = useUserStore();
const router = useRouter();

const form = ref({ username: '', password: '', email: '', nickname: '' });
const captcha = ref({ id: '', code: '' });
const captchaRef = ref<InstanceType<typeof Captcha> | null>(null);
const loading = ref(false);

async function submit() {
  if (!form.value.username || !form.value.password) return ElMessage.warning('请填写账号和密码');
  if (!captcha.value.id || !captcha.value.code) return ElMessage.warning('请输入图形验证码');
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
  <div class="max-w-md mx-auto px-4 py-12 md:py-16">
    <div class="text-center mb-6">
      <div class="w-14 h-14 rounded-2xl bg-brand-600 text-white mx-auto mb-3 flex items-center justify-center text-xl font-bold shadow-sm">P</div>
      <h1 class="text-2xl font-semibold tracking-tight text-ink-900">创建账号</h1>
      <p class="text-sm text-ink-500 mt-1.5">注册后享受订单同步、余额支付与一键接码</p>
    </div>

    <div class="card p-6 md:p-8">
      <div class="space-y-3">
        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1.5">
            账号 <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="form.username"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition placeholder:text-ink-300"
            placeholder="不少于 3 位字符"
            autocomplete="username"
            autofocus
          />
        </div>
        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1.5">
            密码 <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="form.password"
            type="password"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition placeholder:text-ink-300"
            placeholder="不少于 6 位字符"
            autocomplete="new-password"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1.5">
            邮箱 <span class="text-[10px] font-normal text-ink-400">可选</span>
          </label>
          <input
            v-model="form.email"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition placeholder:text-ink-300"
            placeholder="用于接收订单通知"
            autocomplete="email"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1.5">
            昵称 <span class="text-[10px] font-normal text-ink-400">可选</span>
          </label>
          <input
            v-model="form.nickname"
            class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition placeholder:text-ink-300"
            placeholder="如何称呼你"
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
        {{ loading ? '注册中…' : '完成注册' }}
      </BrandButton>

      <p class="text-xs text-ink-500 mt-4 text-center">
        已有账号？<router-link to="/login" class="text-brand-600 hover:text-brand-700 hover:underline">去登录</router-link>
      </p>
    </div>
  </div>
</template>
