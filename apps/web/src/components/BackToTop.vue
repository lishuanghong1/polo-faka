<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

// 前台「回到顶部」悬浮按钮：滚动超过一屏后淡入。
const show = ref(false);

function onScroll() {
  show.value = window.scrollY > 480;
}
function toTop() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});
onUnmounted(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <Transition name="backtop-fade">
    <button
      v-show="show"
      class="back-to-top"
      aria-label="回到顶部"
      title="回到顶部"
      @click="toTop"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
        <path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </Transition>
</template>

<style scoped>
.back-to-top {
  position: fixed;
  right: 18px;
  bottom: 22px;
  z-index: 40;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: #047857;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid #e7e5e4;
  box-shadow: 0 4px 16px -4px rgba(15, 23, 42, 0.18);
  transition: transform 0.15s ease, box-shadow 0.2s ease, color 0.15s ease;
}
.back-to-top:hover {
  color: #059669;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px -6px rgba(5, 150, 105, 0.3);
}
.back-to-top:active {
  transform: translateY(0);
}
.backtop-fade-enter-active,
.backtop-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.backtop-fade-enter-from,
.backtop-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
@media (max-width: 640px) {
  .back-to-top {
    right: 14px;
    bottom: 16px;
    width: 38px;
    height: 38px;
  }
}
</style>
