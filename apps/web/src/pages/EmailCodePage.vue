<script setup lang="ts">
import EmailCodeBox from '@/components/EmailCodeBox.vue';
</script>

<template>
  <section class="min-h-[calc(100vh-4rem-5rem)] flex items-start justify-center px-4 py-10">
    <div class="w-full max-w-xl">
      <div class="text-center mb-8">
        <div class="inline-flex items-center gap-2 text-xs text-ink-500 mb-3">
          <span class="w-1.5 h-1.5 rounded-full bg-brand-600"></span>
          在线接码 · 实时获取
        </div>
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-ink-900">在线接验证码</h1>
        <p class="mt-3 text-sm text-ink-500">
          输入账号邮箱，自动接收验证码<br />
          每 3 秒自动轮询，最长等待 2 分钟。
        </p>
      </div>

      <div class="card p-6 md:p-8 bg-white shadow-sm border border-ink-100 rounded-2xl">
        <EmailCodeBox />
      </div>
    </div>
  </section>
</template>
