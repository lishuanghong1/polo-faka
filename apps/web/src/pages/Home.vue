<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useSiteStore } from '@/stores/site';
import EmailCodeBox from '@/components/EmailCodeBox.vue';

const site = useSiteStore();
const router = useRouter();

const banner = computed(() => ({
  title: site.settings.site_name || 'Polo 接码',
  tagline: site.settings.site_tagline || '在线接收账号验证码 · 安全 · 即时',
}));
</script>

<template>
  <section class="min-h-[calc(100vh-4rem-5rem)] flex items-start justify-center px-4 py-10">
    <div class="w-full max-w-xl">
      <div class="text-center mb-8">
        <div class="inline-flex items-center gap-2 text-xs text-ink-500 mb-3">
          <span class="w-1.5 h-1.5 rounded-full bg-brand-600"></span>
          在线接码 · 实时获取
        </div>
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-ink-900">
          {{ banner.title }}
        </h1>
        <p class="mt-3 text-sm text-ink-500">{{ banner.tagline }}</p>
      </div>

      <div class="card p-6 md:p-8 bg-white shadow-sm border border-ink-100 rounded-2xl">
        <EmailCodeBox />
      </div>

      <div class="mt-5 text-xs text-ink-500 leading-relaxed text-center">
        操作说明：先在目标网站触发发送验证码 → 这里输入对应账号邮箱 → 点击「获取验证码」<br />
        每 3 秒自动轮询，最长等待 2 分钟。
      </div>

      <!-- 入口：兑换码 -->
      <div class="mt-8 text-center">
        <button
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-ink-900 text-white text-sm font-medium hover:bg-ink-700 transition"
          @click="router.push('/forge-redeem')"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 12V8H4v8h16v-4M4 12h16M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          使用兑换码下单
        </button>
        <div class="text-xs text-ink-400 mt-2">输入兑换码即可下单获取账号</div>
      </div>
    </div>
  </section>
</template>
