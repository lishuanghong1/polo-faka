<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

// 路由切换顶部进度条（NProgress 风格，零依赖）。
// 在 App 顶层挂载一次，前台 / 后台路由切换都会显示。
const router = useRouter();
const visible = ref(false);
const progress = ref(0);

let tickTimer: number | undefined;
let safetyTimer: number | undefined;
let removeBefore: (() => void) | undefined;
let removeAfter: (() => void) | undefined;

function clearTimers() {
  if (tickTimer) { window.clearInterval(tickTimer); tickTimer = undefined; }
  if (safetyTimer) { window.clearTimeout(safetyTimer); safetyTimer = undefined; }
}

function start() {
  clearTimers();
  visible.value = true;
  progress.value = 8;
  // 逐步逼近 90%（但不到达），制造"加载中"观感
  tickTimer = window.setInterval(() => {
    const remain = 90 - progress.value;
    if (remain > 0) progress.value += Math.max(0.4, remain * 0.1);
  }, 180);
  // 兜底：极端情况下导航无 afterEach（被中止）也能收尾，避免进度条卡死
  safetyTimer = window.setTimeout(done, 10000);
}

function done() {
  clearTimers();
  if (!visible.value) return;
  progress.value = 100;
  window.setTimeout(() => {
    visible.value = false;
    progress.value = 0;
  }, 280);
}

onMounted(() => {
  removeBefore = router.beforeEach(() => {
    start();
    return true;
  });
  removeAfter = router.afterEach(() => done());
});

onUnmounted(() => {
  removeBefore?.();
  removeAfter?.();
  clearTimers();
});
</script>

<template>
  <Transition name="topbar-fade">
    <div
      v-show="visible"
      class="top-progress"
      :style="{ width: progress + '%' }"
      role="progressbar"
      aria-hidden="true"
    />
  </Transition>
</template>

<style scoped>
.top-progress {
  position: fixed;
  top: 0;
  left: 0;
  height: 2.5px;
  z-index: 9999;
  background: linear-gradient(90deg, #059669, #34d399);
  box-shadow: 0 0 8px rgba(5, 150, 105, 0.5), 0 0 4px rgba(5, 150, 105, 0.4);
  border-radius: 0 2px 2px 0;
  transition: width 0.2s ease;
  pointer-events: none;
}
.topbar-fade-leave-active {
  transition: opacity 0.3s ease;
}
.topbar-fade-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .top-progress {
    transition: none;
  }
}
</style>
