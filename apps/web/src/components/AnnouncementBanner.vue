<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useSiteStore } from '@/stores/site';
import RichContent from '@/components/RichContent.vue';

const site = useSiteStore();

const announcements = computed(() => site.announcements);
const hasAnnouncements = computed(() => announcements.value.length > 0);

// 当前展示的公告索引（轮播）
const currentIdx = ref(0);
const current = computed(() => announcements.value[currentIdx.value] || null);

// 是否展开内容
const expanded = ref(false);

// 自动轮播（多条公告时）
let timer: ReturnType<typeof setInterval> | null = null;

function startAutoPlay() {
  stopAutoPlay();
  if (announcements.value.length <= 1) return;
  timer = setInterval(() => {
    if (!expanded.value) {
      currentIdx.value = (currentIdx.value + 1) % announcements.value.length;
    }
  }, 5000);
}

function stopAutoPlay() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function prev() {
  currentIdx.value =
    (currentIdx.value - 1 + announcements.value.length) % announcements.value.length;
  startAutoPlay();
}

function next() {
  currentIdx.value = (currentIdx.value + 1) % announcements.value.length;
  startAutoPlay();
}

function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value) stopAutoPlay();
  else startAutoPlay();
}

onMounted(() => {
  startAutoPlay();
});

onUnmounted(() => {
  stopAutoPlay();
});
</script>

<template>
  <div v-if="hasAnnouncements" class="announcement-banner">
    <div class="max-w-7xl mx-auto px-4">
      <div
        class="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-emerald-50/40 overflow-hidden transition-all duration-300"
        :class="expanded ? 'shadow-sm' : ''"
      >
        <!-- 标题栏 -->
        <div
          class="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
          @click="toggle"
        >
          <!-- 喇叭图标 -->
          <div class="w-7 h-7 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>

          <!-- 公告标题（带动画切换） -->
          <div class="flex-1 min-w-0 overflow-hidden">
            <Transition name="ann-slide" mode="out-in">
              <div
                :key="current?.id"
                class="text-sm font-medium text-ink-800 truncate"
              >
                {{ current?.title || '' }}
              </div>
            </Transition>
          </div>

          <!-- 导航 & 展开按钮 -->
          <div class="flex items-center gap-2 shrink-0">
            <span
              v-if="announcements.length > 1"
              class="text-[11px] text-ink-400"
            >
              {{ currentIdx + 1 }}/{{ announcements.length }}
            </span>
            <button
              v-if="announcements.length > 1"
              class="w-6 h-6 rounded-md text-ink-400 hover:text-ink-700 hover:bg-ink-100/60 flex items-center justify-center transition"
              title="上一条"
              @click.stop="prev"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <button
              v-if="announcements.length > 1"
              class="w-6 h-6 rounded-md text-ink-400 hover:text-ink-700 hover:bg-ink-100/60 flex items-center justify-center transition"
              title="下一条"
              @click.stop="next"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <div class="w-px h-4 bg-ink-200 mx-0.5" />
            <button
              class="w-6 h-6 rounded-md text-ink-400 hover:text-ink-700 hover:bg-ink-100/60 flex items-center justify-center transition"
              :title="expanded ? '收起' : '展开详情'"
              @click.stop="toggle"
            >
              <svg
                class="w-3.5 h-3.5 transition-transform duration-200"
                :class="expanded ? 'rotate-180' : ''"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 展开的公告内容 -->
        <Transition name="ann-expand">
          <div v-if="expanded && current" class="px-4 pb-4">
            <div class="border-t border-brand-100 pt-3">
              <RichContent v-if="current.content" :html="current.content" />
              <p v-else class="text-sm text-ink-500">暂无详细内容</p>
            </div>

            <!-- 多条公告时展示列表 -->
            <div v-if="announcements.length > 1" class="mt-3 pt-3 border-t border-ink-100">
              <div class="text-[11px] text-ink-400 mb-2">全部公告（{{ announcements.length }}条）</div>
              <div class="space-y-1.5">
                <button
                  v-for="(ann, idx) in announcements"
                  :key="ann.id"
                  class="w-full text-left px-3 py-2 rounded-lg text-sm transition"
                  :class="idx === currentIdx
                    ? 'bg-brand-50 text-brand-700 font-medium'
                    : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'"
                  @click="currentIdx = idx"
                >
                  <div class="flex items-center gap-2">
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0"
                      :class="idx === currentIdx ? 'bg-brand-500' : 'bg-ink-300'"
                    />
                    <span class="truncate">{{ ann.title }}</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 标题切换动画 */
.ann-slide-enter-active,
.ann-slide-leave-active {
  transition: all 0.25s ease;
}
.ann-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.ann-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* 展开/收起动画 */
.ann-expand-enter-active,
.ann-expand-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}
.ann-expand-enter-from,
.ann-expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.ann-expand-enter-to,
.ann-expand-leave-from {
  opacity: 1;
  max-height: 600px;
}
</style>
